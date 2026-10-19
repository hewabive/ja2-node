import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RELOAD_TEST_TIMEOUT_MS } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { LoadingScreen } from '../content/strategic/loading-screens.ts';
import { parseSectorString, type Sector } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import type { Session } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const ROUTE_BUDGET = 20;
const ROUTE_SLICE_SECONDS = 2 * 3600;
const TOWN_PICTURES = new Set<number>([LoadingScreen.DAYTOWN1, LoadingScreen.DAYTOWN2, LoadingScreen.NIGHTTOWN1, LoadingScreen.NIGHTTOWN2]);

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function landedCampaign(seed: number, quiet: readonly string[]): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 3, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  for (const name of ['A9', ...quiet])
    Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  return { session, live: new ReloadingSession('hud', session) };
}

function teleportSquad(session: CampaignSession, sector: Sector): void {
  const c = session.campaign;
  const ctx = c.strategic;
  if (!ctx || !c.battle) throw new Error('no strategic layer');
  for (const m of c.battle.roster.all()) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { ...sector };
  }
}

function firstMerc(session: CampaignSession): number {
  const merc = session.view().strategic?.mercs[0];
  if (!merc) throw new Error('no merc');
  return merc.id;
}

function routeSquadTo(c: Campaign, name: string): SimEvent[] {
  expect(c.session.dispatch({ type: 'route', soldier: firstMerc(c.session), to: name })).toMatchObject({ ok: true });
  const events: SimEvent[] = [];
  const there = () => c.session.view().strategic?.mercs.every((m) => m.sector === name && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !there(); k++) events.push(...c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS }).events);
  expect(there()).toBe(true);
  return events;
}

describe('strategic HUD events and refusals in a stub campaign', { timeout: RELOAD_TEST_TIMEOUT_MS }, () => {
  it('reports the arrival, draws the town loading screen on entry and refuses with tokens', async () => {
    const c = await landedCampaign(71, ['B13', 'C13', 'D13']);
    const merc = firstMerc(c.session);
    expect(c.session.dispatch({ type: 'sleep', soldier: merc })).toEqual({ ok: false, reason: 'notTired', data: { refusal: 'notTired' } });
    expect(c.session.dispatch({ type: 'enterSector', sector: 'Z99' })).toMatchObject({ data: { refusal: 'badSector' } });
    expect(c.session.dispatch({ type: 'enterSector', sector: 'P16' })).toMatchObject({ data: { refusal: 'noMercThere' } });
    expect(c.session.dispatch({ type: 'assignSquad', soldier: merc, squad: 'x' })).toMatchObject({ data: { refusal: 'badSquad' } });
    teleportSquad(c.session, parseSectorString('C13'));
    const events = routeSquadTo(c, 'D13');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'groupArrived', sector: 'D13', final: true, who: { kind: 'squad', squad: 0 } }),
    );
    const entered = { type: 'enterSector', sector: 'D13' };
    await c.session.prepare(entered);
    expect(c.session.dispatch(entered)).toMatchObject({ ok: true });
    const report = c.live.advance({ ticks: 1 });
    const loaded = report.events.find((e) => e.type === 'sectorLoaded');
    expect(loaded).toMatchObject({ sector: 'D13' });
    const screen = loaded?.type === 'sectorLoaded' ? loaded.loadScreen : undefined;
    expect(TOWN_PICTURES.has(screen?.id ?? -1)).toBe(true);
    expect(screen?.path).toMatch(/^loadscreens\/ls_(day|night)town[12]\.sti$/);
    expect(c.session.dispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ data: { refusal: 'mapScreenOnly' } });
    const own = c.session.view().soldiers.find((s) => s.team === 0);
    expect(own).toMatchObject({ asleep: false, squad: 0, vehicle: null });
  });

  it('gives own-merc barks their text key, length and sector', async () => {
    const c = await landedCampaign(72, []);
    const enter = { type: 'enterSector', sector: 'A9' };
    await c.session.prepare(enter);
    expect(c.session.dispatch(enter)).toMatchObject({ ok: true });
    c.live.advance({ idle: true });
    const [talker, target] = c.session.view().soldiers.filter((s) => s.team === 0);
    if (!talker || !target) throw new Error('two mercs needed');
    const bark = c.session.dispatch({ type: 'talk', soldier: talker.id, target: target.id });
    expect(bark).toMatchObject({ ok: true });
    const quote = c.live.advance({ ticks: 1 }).events.find((e) => e.type === 'mercQuote');
    expect(quote).toMatchObject({ soldier: target.id, sector: 'A9', textKey: { file: expect.any(String) }, chars: expect.any(Number) });
  });
});
