import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemId } from '../../../tests/support/explosives.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { parseSectorString } from '../../content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import { createItem } from '../items/object.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import type { WorldClock } from '../strategic/time/world-clock.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import type { TacticalState } from '../tactical/state.ts';
import { addItemToPool, Visibility } from '../tactical/world-items.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const VANT = 1;
const MORAGA = 2;
const LANDING = 'A9';
const TICK_MS = 5;
const WORLD_SECOND_MS = 1000;
const HALF_A_SECOND = { ticks: WORLD_SECOND_MS / 2 / TICK_MS };
const ONE_TICK = { ticks: 1 };
const LAST_TICK_BEFORE_THE_SECOND = { ticks: WORLD_SECOND_MS / TICK_MS - 1 };
const WOUNDED = { life: 60, bleeding: 8 };
const FULL_STATUS = 100;
const UNTRAPPED = 0;
const EASY_TRAP = 1;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
}

function never(what: string): never {
  throw new Error(`no ${what}`);
}

async function order(c: Campaign, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void> {
  await c.session.prepare(cmd);
  expect(c.session.dispatch(cmd)).toMatchObject({ ok: true });
}

function quiet(session: CampaignSession): void {
  const map = session.campaign.state.map;
  Object.assign(sectorInfo(map, parseSectorString(LANDING)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = session.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

async function landedInA9(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, {
    profiles: [KESTREL, VANT, MORAGA],
    land: false,
  });
  const session = drivenSession(created, stubSessionSources(kit));
  quiet(session);
  const c = { session, live: new ReloadingSession('tactical-box-clock', session) };
  await order(c, { type: 'compressTime', mode: 2 });
  await order(c, { type: 'skipHelicopterDrop' });
  await order(c, { type: 'enterSector', sector: LANDING });
  c.live.advance({ idle: true });
  return c;
}

function merc(c: Campaign, profile: number): RosterMerc {
  return c.session.campaign.battle?.roster.all().find((m) => m.profile === profile) ?? never(`merc with profile ${profile}`);
}

function tactical(c: Campaign): TacticalState {
  return c.session.campaign.tactical?.state ?? never('loaded sector');
}

function clock(c: Campaign): WorldClock {
  return c.session.campaign.state.clock;
}

function promptId(c: Campaign): string {
  return tactical(c).prompt?.id ?? never('box');
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function msToTheNextWorldSecond(c: Campaign): number {
  const from = tactical(c).clockMs;
  expect(c.live.advance({ worldSeconds: 1 }).reason).toBe('worldTime');
  return tactical(c).clockMs - from;
}

function halfASecondIn(c: Campaign): void {
  msToTheNextWorldSecond(c);
  c.live.advance(HALF_A_SECOND);
}

function lay(c: Campaign, g: number, name: string, trap = UNTRAPPED): void {
  const t = tactical(c);
  const o = createItem(t.content.items, itemId(t, name), FULL_STATUS);
  o.trap = trap;
  addItemToPool(t, g, o, Visibility.VISIBLE, 0);
}

function askAboutAutoBandageNextTick(c: Campaign): void {
  c.session.campaign.state.sectorFlow.autoBandage.pending = true;
}

describe("the world clock's second behind a box on the tactical screen (MessageBoxScreen.cc DoMessageBox's PauseGame, Strategic/Game_Clock.cc UpdateClock)", () => {
  it('runs on without a box, and restarts at a box an order opens, so the next world second comes a full second after it', async () => {
    const c = await landedInA9(61);
    Object.assign(merc(c, VANT).soldier, WOUNDED);
    halfASecondIn(c);
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS / 2);
    halfASecondIn(c);
    await order(c, { type: 'autoBandage' });
    await order(c, { type: 'answer', prompt: promptId(c), choice: 'no' });
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS);
  });

  it('restarts in the tick a box opens in, so the second due in that tick never comes', async () => {
    const c = await landedInA9(62);
    Object.assign(merc(c, VANT).soldier, WOUNDED);
    msToTheNextWorldSecond(c);
    c.live.advance(LAST_TICK_BEFORE_THE_SECOND);
    const seconds = clock(c).seconds;
    askAboutAutoBandageNextTick(c);
    expect(c.live.advance(ONE_TICK).reason).toBe('decision');
    expect([tactical(c).prompt?.kind, clock(c).seconds]).toEqual(['beginAutoBandage', seconds]);
    await order(c, { type: 'answer', prompt: promptId(c), choice: 'no' });
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS);
  });

  it('restarts behind an OK box the sim answers at once, the refusal of a pending question', async () => {
    const c = await landedInA9(63);
    msToTheNextWorldSecond(c);
    c.live.advance(LAST_TICK_BEFORE_THE_SECOND);
    const seconds = clock(c).seconds;
    askAboutAutoBandageNextTick(c);
    const refused = c.live.advance(ONE_TICK);
    expect(ofType(refused.events, 'autoBandageRefused')).toMatchObject([{ refusal: 'nobodyToBandage' }]);
    expect(clock(c).seconds).toBe(seconds);
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS);
  });

  it('restarts behind a box the end of a stop-time quote opens, the disarm box of a booby trap a merc spotted (Handle_Items.cc BoobyTrapDialogueCallBack)', async () => {
    const c = await landedInA9(65);
    const kestrel = merc(c, KESTREL).soldier;
    lay(c, kestrel.gridNo, 'CANTEEN', EASY_TRAP);
    halfASecondIn(c);
    await order(c, { type: 'pickUp', soldier: kestrel.id });
    const spotted = c.live.advance({ idle: true });
    expect([spotted.reason, tactical(c).prompt?.kind]).toEqual(['decision', 'disarmTrap']);
    expect(ofType(spotted.events, 'mercQuote').map((e) => e.id)).toContain(MercQuote.BOOBYTRAP_ITEM);
    await order(c, { type: 'answer', prompt: promptId(c), choice: 'no' });
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS);
  });

  it('restarts behind the pickup menu as behind a box (Tactical/Interface_Items.cc InitializeItemPickupMenu PauseGame)', async () => {
    const c = await landedInA9(64);
    const kestrel = merc(c, KESTREL).soldier;
    for (const name of ['CANTEEN', 'CROWBAR']) lay(c, kestrel.gridNo, name);
    halfASecondIn(c);
    await order(c, { type: 'pickUp', soldier: kestrel.id });
    expect(c.live.advance({ idle: true }).reason).toBe('decision');
    expect(tactical(c).prompt?.kind).toBe('pickupMenu');
    await order(c, { type: 'answer', prompt: promptId(c), choice: 'cancel' });
    expect(msToTheNextWorldSecond(c)).toBe(WORLD_SECOND_MS);
  });
});
