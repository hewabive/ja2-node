import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { gridNo } from '../content/world/grid.ts';
import type { RosterMerc } from '../sim/campaign/roster.ts';
import { removeGroup } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { saveRefusal } from './save-rules.ts';

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
const WOUNDED = { life: 60, bleeding: 8 };
const FAR_FROM_THE_SQUAD = gridNo(120, 80);
const A_MINUTE = 60;
const ONE_TICK = { ticks: 1 };

interface Campaign {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
}

type Command = { readonly type: string; readonly [key: string]: unknown };

function never(what: string): never {
  throw new Error(`no ${what}`);
}

async function order(c: Campaign, cmd: Command): Promise<unknown> {
  await c.session.prepare(cmd);
  const result = c.session.dispatch(cmd);
  expect(result).toMatchObject({ ok: true });
  return result.ok ? result.data : null;
}

async function landedInA9(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, {
    profiles: [KESTREL, VANT, MORAGA],
    land: false,
  });
  const session = drivenSession(created, stubSessionSources(kit));
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(LANDING)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = session.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
  const c = { session, live: new ReloadingSession('auto-bandage view', session) };
  await order(c, { type: 'compressTime', mode: 2 });
  await order(c, { type: 'skipHelicopterDrop' });
  await order(c, { type: 'enterSector', sector: LANDING });
  c.live.advance({ idle: true });
  return c;
}

function merc(c: Campaign, profile: number): RosterMerc {
  return c.session.campaign.battle?.roster.all().find((m) => m.profile === profile) ?? never(`merc with profile ${profile}`);
}

async function woundedFarAway(c: Campaign): Promise<number> {
  const vant = merc(c, VANT);
  await order(c, { type: 'move', soldier: vant.id, to: FAR_FROM_THE_SQUAD, mode: 'run' });
  c.live.advance({ idle: true });
  Object.assign(merc(c, VANT).soldier, WOUNDED);
  return vant.id;
}

describe('auto-bandage through the session (the box, the save and the world clock)', () => {
  it('shows the box of medics and patients while the mode runs, completes it, and drops it at the end', async () => {
    const c = await landedInA9(65);
    const patient = await woundedFarAway(c);
    const asked = (await order(c, { type: 'autoBandage' })) as { prompt: string };
    expect(c.session.view().prompt).toEqual({ id: asked.prompt, kind: 'beginAutoBandage', choices: ['yes', 'no'] });
    expect(c.session.view().autoBandage).toBeUndefined();
    await order(c, { type: 'answer', choice: 'yes' });
    const box = c.session.view().autoBandage ?? never('auto-bandage box');
    expect([box.complete, box.patients, box.medics.length > 0]).toEqual([false, [patient], true]);
    expect(c.live.advance({ idle: true }).reason).toBe('idle');
    expect(c.session.view().autoBandage).toMatchObject({ complete: true, patients: [patient] });
    expect(await order(c, { type: 'endAutoBandage' })).toEqual({ ending: true });
    c.live.advance(ONE_TICK);
    expect(c.session.view().autoBandage).toBeUndefined();
  });

  it('refuses a save and a world-time target while the mode runs, as no key reaches the game and the clock stands', async () => {
    const c = await landedInA9(66);
    await woundedFarAway(c);
    await order(c, { type: 'autoBandage' });
    await order(c, { type: 'answer', choice: 'yes' });
    expect(saveRefusal(c.session)).toBe('autoBandaging');
    const held = c.live.advance({ worldSeconds: A_MINUTE });
    expect([held.reason, held.refusal?.startsWith('autoBandaging:')]).toEqual(['refused', true]);
    await order(c, { type: 'endAutoBandage' });
    c.live.advance(ONE_TICK);
    expect(saveRefusal(c.session)).toBeNull();
    expect(c.live.advance({ worldSeconds: A_MINUTE }).reason).toBe('worldTime');
  });
});
