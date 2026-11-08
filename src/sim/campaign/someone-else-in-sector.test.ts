import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { MercType } from '../../content/strategic/economy-content.ts';
import { parseSectorString, sameSector } from '../../content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import { tacticalCharacterDialogue } from '../narrative/dialogue-queue.ts';
import { dialogueActive } from '../narrative/talk-state.ts';
import { type BattleState, PromptKind } from '../strategic/forces/battle-state.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
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
const WILDERNESS = 'B9';
const TICK_MS = 5;
const FIRST_LOOK_MS = 3000;
const LOOK_AGAIN_MS = 2000;
const ROUTE_SLICE_SECONDS = 3600;
const ROUTE_BUDGET = 24;
const OUT_OF_SIGHT = gridNo(20, 80);
const KILLING_BLOW = 100;
const PAST_THE_FIRST_LOOK = { ticks: 2 * (FIRST_LOOK_MS / TICK_MS) };
const ONE_TICK = { ticks: 1 };
const SPOKEN_TO = 1;
const LINE_LEAD_MS = 500;

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
  for (const name of [LANDING, WILDERNESS])
    Object.assign(sectorInfo(map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = session.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

function merc(c: Campaign, profile: number): RosterMerc {
  return c.session.campaign.battle?.roster.all().find((m) => m.profile === profile) ?? never(`merc with profile ${profile}`);
}

function tactical(c: Campaign): TacticalState {
  return c.session.campaign.tactical?.state ?? never('loaded sector');
}

function battle(c: Campaign): BattleState {
  return c.session.campaign.state.battle;
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function npcProfile(c: Campaign): number {
  const types = c.session.campaign.economy?.economy.mercTypes ?? never('merc types');
  const npc = [...types].find(([, type]) => type === MercType.NPC) ?? never('NPC profile');
  return npc[0];
}

function npcStandsIn(c: Campaign, sectorName: string, lastDateSpokenTo = 0): void {
  const sector = parseSectorString(sectorName);
  const p = c.session.campaign.narrative.profile(npcProfile(c)) ?? never('NPC progress');
  Object.assign(p, { sectorX: sector.x, sectorY: sector.y, sectorZ: 0, lastDateSpokenTo });
}

async function vantInTheWilderness(seed: number, lastDateSpokenTo = 0): Promise<Campaign> {
  const profiles = [KESTREL, VANT, MORAGA];
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  quiet(session);
  const c = { session, live: new ReloadingSession('someone-else-in-sector', session) };
  await order(c, { type: 'compressTime', mode: 2 });
  await order(c, { type: 'enterSector', sector: LANDING });
  c.live.advance({ idle: true });
  await order(c, { type: 'mapScreen' });
  const vant = merc(c, VANT).id;
  await order(c, { type: 'assignSquad', soldier: vant, squad: 'new' });
  await order(c, { type: 'route', soldier: vant, to: WILDERNESS });
  const arrived = () => {
    const m = merc(c, VANT);
    return sameSector(m.sector, parseSectorString(WILDERNESS)) && !m.betweenSectors;
  };
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  if (!arrived()) throw new Error(`Vant did not reach ${WILDERNESS}`);
  npcStandsIn(c, WILDERNESS, lastDateSpokenTo);
  await order(c, { type: 'enterSector', sector: WILDERNESS });
  c.live.advance({ idle: true });
  return c;
}

function enemyOutOfSight(c: Campaign): Soldier {
  const sim = c.session.campaign.tactical ?? never('loaded sector');
  let id = TEAM_FIRST_ID[Team.ENEMY];
  while (sim.state.soldiers[id]) id++;
  return spawnSoldier(sim, id, Team.ENEMY, OUT_OF_SIGHT, Direction.NORTH);
}

interface Victory {
  readonly wonAt: number;
  readonly events: readonly SimEvent[];
}

function winTheBattle(c: Campaign, fought: boolean): Victory {
  const enemy = enemyOutOfSight(c);
  const t = tactical(c);
  t.turn.enemyInSector = true;
  if (fought) t.turn.numFoughtInBattle[Team.ENEMY] = 1;
  soldierTakeDamage(t, t.soldiers[enemy.id] ?? never('enemy'), KILLING_BLOW, KILLING_BLOW, DamageReason.BLOODLOSS, null);
  const report = c.live.advance({ events: ['combatEnded'] });
  expect(ofType(report.events, 'combatEnded')).toMatchObject([{ reason: 'won' }]);
  return { wonAt: tactical(c).clockMs - TICK_MS, events: report.events };
}

function talking(c: Campaign): boolean {
  return dialogueActive(c.session.campaign.state.talk.dialogue);
}

function promptKind(c: Campaign): string | null {
  return battle(c).prompt?.kind ?? null;
}

function ticksUntil(c: Campaign, ms: number): { readonly ticks: number } {
  return { ticks: (ms - tactical(c).clockMs) / TICK_MS };
}

describe('someone else in the sector after a won battle (Overhead.cc HandleThePlayerBeNotifiedOfSomeoneElseInSector)', () => {
  it('opens an OK box three seconds after a battle won in a wilderness sector whose NPC nobody has met', async () => {
    const c = await vantInTheWilderness(61);
    const { wonAt } = winTheBattle(c, false);
    expect(battle(c).someoneElseLookAtMs).toBe(wonAt + FIRST_LOOK_MS);
    expect(c.live.advance(ticksUntil(c, wonAt + FIRST_LOOK_MS)).reason).toBe('ticks');
    expect(promptKind(c)).toBeNull();
    expect(c.live.advance(ONE_TICK).reason).toBe('decision');
    expect(c.session.view().prompt).toMatchObject({ kind: 'someoneElseInSector', sector: WILDERNESS, choices: ['ok'] });
    expect(battle(c).someoneElseLookAtMs).toBeNull();
  });

  it('holds the game until answered with ok', async () => {
    const c = await vantInTheWilderness(62);
    const { wonAt } = winTheBattle(c, false);
    c.live.advance(ticksUntil(c, wonAt + FIRST_LOOK_MS + TICK_MS));
    const prompt = battle(c).prompt ?? never('box');
    const stoppedAt = tactical(c).clockMs;
    expect(c.live.advance(ONE_TICK).reason).toBe('decision');
    expect(tactical(c).clockMs).toBe(stoppedAt);
    const move = { type: 'move', soldier: merc(c, VANT).id, to: merc(c, VANT).soldier.gridNo + 1 };
    await c.session.prepare(move);
    expect(c.session.dispatch(move)).toMatchObject({ ok: false, data: { refusal: 'promptOpen' } });
    expect(c.session.dispatch({ type: 'answer', prompt: prompt.id, choice: 'stop' })).toMatchObject({ ok: false });
    await order(c, { type: 'answer', prompt: prompt.id, choice: 'ok' });
    expect(promptKind(c)).toBeNull();
    expect(c.live.advance(ONE_TICK).reason).toBe('ticks');
  });

  it('looks again two seconds later while a line plays, and tells once it is over', async () => {
    const c = await vantInTheWilderness(63);
    const { wonAt } = winTheBattle(c, false);
    c.live.advance(ticksUntil(c, wonAt + FIRST_LOOK_MS - LINE_LEAD_MS));
    const host = c.session.campaign.talk?.host ?? never('narrative host');
    expect(tacticalCharacterDialogue(host, merc(c, VANT).soldier, MercQuote.SECTOR_SAFE)).toBe(true);
    expect(c.live.advance(ticksUntil(c, wonAt + FIRST_LOOK_MS + TICK_MS)).reason).toBe('ticks');
    expect(talking(c)).toBe(true);
    expect([promptKind(c), battle(c).someoneElseLookAtMs]).toEqual([null, wonAt + FIRST_LOOK_MS + LOOK_AGAIN_MS]);
    expect(c.live.advance(ticksUntil(c, wonAt + FIRST_LOOK_MS + LOOK_AGAIN_MS)).reason).toBe('ticks');
    expect([talking(c), promptKind(c)]).toEqual([false, null]);
    expect(c.live.advance(ONE_TICK).reason).toBe('decision');
    expect(promptKind(c)).toBe(PromptKind.SOMEONE_ELSE_IN_SECTOR);
  });

  it('keeps advance idle running until the box opens', async () => {
    const c = await vantInTheWilderness(67);
    const { wonAt } = winTheBattle(c, false);
    expect(c.live.advance({ idle: true }).reason).toBe('decision');
    expect(promptKind(c)).toBe(PromptKind.SOMEONE_ELSE_IN_SECTOR);
    expect(tactical(c).clockMs).toBe(wonAt + FIRST_LOOK_MS + TICK_MS);
  });

  it('lets advance idle stop before a look that will tell nothing', async () => {
    const c = await vantInTheWilderness(69, SPOKEN_TO);
    const { wonAt } = winTheBattle(c, false);
    expect(c.live.advance({ idle: true }).reason).toBe('idle');
    expect(battle(c).someoneElseLookAtMs).toBe(wonAt + FIRST_LOOK_MS);
  });

  it('tells nothing once someone has spoken with the NPC', async () => {
    const c = await vantInTheWilderness(65, SPOKEN_TO);
    winTheBattle(c, false);
    expect(c.live.advance(PAST_THE_FIRST_LOOK).reason).toBe('ticks');
    expect([promptKind(c), battle(c).someoneElseLookAtMs]).toEqual([null, null]);
  });

  it('is dropped when the map screen opens before the look, so the way back tells nothing', async () => {
    const c = await vantInTheWilderness(66);
    winTheBattle(c, false);
    await order(c, { type: 'mapScreen' });
    expect(battle(c).someoneElseLookAtMs).toBeNull();
    await order(c, { type: 'tacticalScreen' });
    expect(c.live.advance(PAST_THE_FIRST_LOOK).reason).toBe('ticks');
    expect(promptKind(c)).toBeNull();
  });
});
