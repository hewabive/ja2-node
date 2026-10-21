import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withQueries } from '../../tests/support/hints.ts';
import { RELOAD_TEST_TIMEOUT_MS } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString, type Sector, strategicIndex } from '../content/strategic/sector-ids.ts';
import type { StrategicMercView, StrategicView } from '../protocol/view.ts';
import { Assignment } from '../sim/strategic/economy/constants.ts';
import { SectorFlag } from '../sim/strategic/forces/constants.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../sim/strategic/forces/helicopter.ts';
import { findUndergroundSector, sectorInfo, setSectorFlag } from '../sim/strategic/map/sectors.ts';
import { progressFromProfile } from '../sim/tactical/profiles.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const DRASSEN = ['B13', 'C13', 'D13'];
const DRASSEN_TOWN = 2;
const OMERTA_TOWN = 1;
const GREEN = 0;
const REGULAR = 1;
const STEP_SECONDS = 600;
const STEPS = 200;
const MINE_STATUS = new Set(['producing', 'runningOut', 'shutDown', 'abandoned']);

interface Campaign {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
}

async function landedCampaign(seed: number, mercs: number, quiet: readonly string[]): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  for (const name of ['A9', ...quiet])
    Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const live = withQueries(new ReloadingSession('map-screen', session), {
    read: kit.read,
    exists: (p) => kit.worlds.exists(p),
    world: (p) => kit.worlds.world(p),
  }) as ReloadingSession;
  return { session, live };
}

function strategic(c: Campaign): StrategicView {
  const s = c.session.view().strategic;
  if (!s) throw new Error('no strategic view');
  return s;
}

function mercs(c: Campaign): readonly StrategicMercView[] {
  return strategic(c).mercs;
}

function merc(c: Campaign, id: number): StrategicMercView {
  const m = mercs(c).find((x) => x.id === id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

function teleportSquad(c: Campaign, sector: Sector): void {
  const campaign = c.session.campaign;
  const ctx = campaign.strategic;
  if (!ctx || !campaign.battle) throw new Error('no strategic layer');
  for (const m of campaign.battle.roster.all()) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { ...sector };
  }
}

function liberateDrassen(c: Campaign): void {
  const state = c.session.campaign.state;
  for (const name of DRASSEN) {
    const s = parseSectorString(name);
    Object.assign(sectorInfo(state.map, s), { numAdmins: 0, numTroops: 0, numElites: 0 });
    const element = state.map.elements[strategicIndex(s)];
    if (element) element.enemyControlled = false;
  }
  const town = state.economy.towns[DRASSEN_TOWN];
  if (town) Object.assign(town, { started: true, rating: 50 });
}

function setMilitia(c: Campaign, name: string, militia: readonly number[]): void {
  sectorInfo(c.session.campaign.state.map, parseSectorString(name)).militia = [...militia];
}

function militiaOf(c: Campaign, name: string): readonly number[] {
  return strategic(c).sectors.find((s) => s.sector === name)?.militia ?? [];
}

function withHelicopter(c: Campaign, at: string): void {
  const campaign = c.session.campaign;
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const skyrider = kit.content.profiles[SKYRIDER];
  if (skyrider) campaign.state.profiles.set(SKYRIDER, progressFromProfile(skyrider));
  const sector = campaign.state.map.elements[strategicIndex(parseSectorString(at))];
  if (sector) sector.enemyControlled = false;
  setUpHelicopterForPlayer(ctx, parseSectorString(at));
}

describe('map screen view fields and commands in a stub campaign', { timeout: RELOAD_TEST_TIMEOUT_MS }, () => {
  it('shows the clock, the mercs, the towns, the mines and the sectors the map screen prints', async () => {
    const c = await landedCampaign(81, 3, ['A10', 'B9', 'B10']);
    const view = c.session.view();
    expect(view.clock).toMatchObject({ paused: false, playerPaused: false, pauseLocked: false, canCompress: true });
    expect(view.clock?.compressRefusal).toBeUndefined();
    const first = mercs(c)[0];
    if (!first) throw new Error('no merc');
    expect(first).toMatchObject({ idle: false, canChangeSleep: true, bleeding: 0, collapsed: false });
    expect(first.contract?.type).toBe('aim');
    if (first.contract?.type === 'aim') {
      expect(first.salary).toBe(first.contract.dailyRate);
      expect(first.contract.minutesLeft).toBeGreaterThan(0);
      expect(first.contract.endMinutes).toBeGreaterThan(first.contract.minutesLeft ?? 0);
    }
    const s = strategic(c);
    expect(s.townControl?.find((t) => t.town === DRASSEN_TOWN)).toEqual({ town: DRASSEN_TOWN, control: 0 });
    expect(s.townControl?.find((t) => t.town === OMERTA_TOWN)?.control).toBeGreaterThanOrEqual(0);
    expect(s.mines?.length).toBeGreaterThan(0);
    for (const mine of s.mines ?? []) {
      expect(MINE_STATUS.has(mine.status)).toBe(true);
      expect(['silver', 'gold']).toContain(mine.ore);
      expect(mine.playerControls).toBe(false);
      expect(mine.predictedDailyIncome).toBe(0);
    }
    expect(s.projectedDailyIncome).toBe(0);
    expect(Array.isArray(s.secretsFound)).toBe(true);
    expect(s.underground).toEqual([]);
    const b13 = s.sectors.find((x) => x.sector === 'B13');
    expect(b13).toMatchObject({ playerControlled: false, militiaTraining: 0 });
    expect(s.sectors.find((x) => x.sector === 'A9')).toMatchObject({ enemiesKnown: true, enemies: null });

    expect(c.live.dispatch({ type: 'compressTime', mode: 3 })).toEqual({ ok: true });
    expect(c.session.view().clock).toMatchObject({ mode: 3, compressing: true });
    expect(c.live.dispatch({ type: 'stopTime' })).toEqual({ ok: true });
    c.session.campaign.state.clock.pauseLocked = true;
    expect(c.session.view().clock).toMatchObject({ pauseLocked: true, canCompress: false, compressRefusal: 'pauseLocked' });
    c.session.campaign.state.clock.pauseLocked = false;

    expect(c.live.dispatch({ type: 'assign', soldiers: [first.id], to: { kind: 'trainSelf', stat: 2 } })).toMatchObject({ ok: true });
    expect(merc(c, first.id)).toMatchObject({ assignment: Assignment.TRAIN_SELF, trainStat: 2 });
    const crew = c.session.campaign.economy?.crew.get(first.id);
    if (crew) crew.nothingToDo = true;
    expect(merc(c, first.id).idle).toBe(true);

    const a10b1 = parseSectorString('A10', 1);
    const map = c.session.campaign.state.map;
    if (findUndergroundSector(map, a10b1)) {
      setSectorFlag(map, a10b1, SectorFlag.ALREADY_VISITED, 1);
      const u = findUndergroundSector(map, a10b1);
      if (u) u.visibleItems = 4;
      expect(strategic(c).underground).toContainEqual({ sector: 'A10-1', items: 4 });
    }
  });

  it('plots routes through legs, previews them alike, shortens them and moves part of a squad', async () => {
    const c = await landedCampaign(82, 4, ['A10', 'A11', 'B9', 'B10', 'B11', 'C10']);
    const [m1, m2, m3, m4] = mercs(c).map((m) => m.id);
    if (m1 === undefined || m2 === undefined || m3 === undefined || m4 === undefined) throw new Error('four mercs needed');
    expect(c.live.dispatch({ type: 'route', soldier: m1, to: 'Z99' })).toMatchObject({ data: { refusal: 'badSector' } });
    expect(c.live.dispatch({ type: 'route', soldier: m1, to: 'B10', via: 'A10' })).toMatchObject({ data: { refusal: 'badSector' } });

    const routed = c.live.dispatch({ type: 'route', soldier: m1, to: 'B10', via: ['A10'] });
    expect(routed).toMatchObject({ ok: true, data: { path: ['A9', 'A10', 'B10'] } });
    expect(merc(c, m4).sector).toBe('A9');
    const preview = await c.live.query({ type: 'previewRoute', soldier: m1, to: 'C10', extend: true });
    expect(preview).toMatchObject({ ok: true, data: { path: ['A9', 'A10', 'B10'], temp: ['B10', 'C10'] } });
    const fresh = await c.live.query({ type: 'previewRoute', soldier: m1, to: 'C10' });
    expect((fresh.data as { path: string[] }).path).toEqual([]);
    expect(c.live.dispatch({ type: 'route', soldier: m1, to: 'C10', extend: true })).toMatchObject({
      ok: true,
      data: { path: ['A9', 'A10', 'B10', 'C10'] },
    });
    expect(strategic(c).groups.find((g) => g.members.includes(m2))?.path).toEqual(['A9', 'A10', 'B10', 'C10']);

    expect(c.live.dispatch({ type: 'shortenRoute', soldier: m1, at: 'A10' })).toMatchObject({
      ok: true,
      data: { path: ['A9', 'A10'], edit: 'shortened' },
    });
    expect(c.live.dispatch({ type: 'shortenRoute', soldier: m1, at: 'B10' })).toMatchObject({ data: { refusal: 'noRoute' } });
    expect(c.live.dispatch({ type: 'shortenRoute', soldier: m1, at: 'A9' })).toMatchObject({
      ok: true,
      data: { path: [], edit: 'cleared' },
    });

    const split = c.live.dispatch({ type: 'routeGroup', soldiers: [m1, m2], to: 'A10' });
    expect(split).toMatchObject({ ok: true });
    const data = split.data as { groups: { squad?: number; path: string[] }[]; regrouped: { soldier: number; squad: number }[] };
    expect(data.regrouped.map((r) => r.soldier).sort()).toEqual([m1, m2].sort());
    const movers = new Set(data.regrouped.map((r) => r.squad));
    expect(movers.size).toBe(1);
    expect(data.groups).toEqual([expect.objectContaining({ path: ['A9', 'A10'] })]);
    expect(merc(c, m1).squad).toBe(merc(c, m2).squad);
    expect(merc(c, m3).squad).toBe(0);
    expect(strategic(c).groups.find((g) => g.members.includes(m3))?.path).toEqual([]);

    for (let k = 0; k < STEPS && merc(c, m1).sector !== 'A10'; k++) c.live.advance({ worldSeconds: STEP_SECONDS });
    expect(merc(c, m1)).toMatchObject({ sector: 'A10', betweenSectors: false });
    const whole = c.live.dispatch({ type: 'routeGroup', soldiers: [m3], squads: [0], to: 'B9' });
    expect(whole).toMatchObject({ ok: true, data: { groups: [expect.objectContaining({ squad: 0, path: ['A9', 'B9'] })] } });
    const stayer = (whole.data as { regrouped: { soldier: number; squad: number }[] }).regrouped;
    expect(stayer).toEqual([{ soldier: m4, squad: expect.any(Number) }]);
    expect(merc(c, m4).squad).not.toBe(0);
    expect(c.live.dispatch({ type: 'routeGroup', soldiers: [m3], squads: [], to: 'B9' })).toMatchObject({
      data: { refusal: 'reassignOnTheMove' },
    });
    expect(c.live.dispatch({ type: 'routeGroup', soldiers: [], to: 'B9' })).toMatchObject({ data: { refusal: 'badSoldiers' } });
  });

  it('moves and distributes town militia with the original refusals', async () => {
    const c = await landedCampaign(83, 3, []);
    liberateDrassen(c);
    teleportSquad(c, parseSectorString('C13'));
    setMilitia(c, 'B13', [4, 1, 0]);
    setMilitia(c, 'C13', [0, 0, 0]);
    setMilitia(c, 'D13', [19, 0, 0]);
    expect(c.live.dispatch({ type: 'moveMilitia', from: 'B13', to: 'C13', rank: 'green', count: 3 })).toEqual({ ok: true });
    expect(militiaOf(c, 'B13')).toEqual([1, 1, 0]);
    expect(militiaOf(c, 'C13')).toEqual([3, 0, 0]);
    expect(c.live.dispatch({ type: 'moveMilitia', from: 'B13', to: 'C13', rank: 'green', count: 2 })).toMatchObject({
      data: { refusal: 'notEnoughMilitia' },
    });
    expect(c.live.dispatch({ type: 'moveMilitia', from: 'C13', to: 'D13', rank: 'green', count: 2 })).toMatchObject({
      data: { refusal: 'sectorFull' },
    });
    expect(c.live.dispatch({ type: 'moveMilitia', from: 'C13', to: 'A9', rank: 'green', count: 1 })).toMatchObject({
      data: { refusal: 'otherTown' },
    });
    expect(c.live.dispatch({ type: 'moveMilitia', from: 'A9', to: 'A10', rank: 'green', count: 1 })).toMatchObject({
      data: { refusal: 'noMilitiaAllowed' },
    });
    expect(c.live.dispatch({ type: 'moveMilitia', from: 'C13', to: 'D13', rank: 'veteran', count: 1 })).toMatchObject({
      data: { refusal: 'badRank' },
    });
    expect(c.live.dispatch({ type: 'distributeMilitia', town: DRASSEN_TOWN })).toEqual({ ok: true });
    const totals = DRASSEN.map((name) => militiaOf(c, name));
    expect(totals.map((m) => m[GREEN])).toEqual([8, 8, 7]);
    expect(totals.map((m) => m[REGULAR])).toEqual([1, 0, 0]);
    expect(c.live.dispatch({ type: 'distributeMilitia', town: OMERTA_TOWN })).toMatchObject({ data: { refusal: 'noMilitiaAllowed' } });
  });

  it('trashes an item on the map screen only', async () => {
    const c = await landedCampaign(84, 2, []);
    const id = mercs(c)[0]?.id ?? -1;
    const before = merc(c, id).inventory ?? [];
    const slot = before.find((i) => i.item !== '')?.slot;
    if (slot === undefined) throw new Error('the merc carries nothing');
    const discarded = c.live.dispatch({ type: 'discardItem', soldier: id, slot });
    expect(discarded).toMatchObject({ ok: true, data: { count: expect.any(Number) } });
    expect((merc(c, id).inventory ?? []).some((i) => i.slot === slot)).toBe(false);
    expect(c.live.dispatch({ type: 'discardItem', soldier: id, slot })).toMatchObject({ data: { refusal: 'emptySlot' } });
    expect(c.live.dispatch({ type: 'discardItem', soldier: id, slot: 'nowhere' })).toMatchObject({ data: { refusal: 'badSlot' } });
    const enter = { type: 'enterSector', sector: 'A9' };
    await c.session.prepare(enter);
    expect(c.live.dispatch(enter)).toMatchObject({ ok: true });
    expect(c.live.dispatch({ type: 'discardItem', soldier: id, slot: 'hand' })).toMatchObject({ data: { refusal: 'mapScreenOnly' } });
  });

  it('asks Skyrider when the helicopter is clicked, hints once at an empty helicopter and flies a plotted route', async () => {
    const c = await landedCampaign(86, 2, ['A10', 'A11', 'B9', 'B10', 'B11']);
    withHelicopter(c, 'A9');
    expect(c.live.dispatch({ type: 'heliPlot' })).toMatchObject({ ok: false, data: { refusal: 'emptyHelicopterHint' } });
    expect(c.live.dispatch({ type: 'heliPlot' })).toMatchObject({ ok: true });
    const [pilotless] = mercs(c).map((m) => m.id);
    expect(c.live.dispatch({ type: 'boardVehicle', soldier: pilotless, vehicle: 'helicopter' })).toMatchObject({ ok: true });
    const flown = c.live.dispatch({ type: 'heliRoute', to: 'A11', plotted: true });
    expect(flown).toMatchObject({ ok: true, data: { path: ['A9', 'A10', 'A11'] } });
  });

  it('flies the helicopter through legs, shows its progress and shortens its route', async () => {
    const c = await landedCampaign(85, 2, ['A10', 'A11', 'B9', 'B10', 'B11']);
    withHelicopter(c, 'A9');
    const [m1, m2] = mercs(c).map((m) => m.id);
    for (const soldier of [m1, m2])
      expect(c.live.dispatch({ type: 'boardVehicle', soldier, vehicle: 'helicopter' })).toMatchObject({ ok: true });
    const flown = c.live.dispatch({ type: 'heliRoute', to: 'B11', via: ['A11'] });
    expect(flown).toMatchObject({ ok: true, data: { path: ['A9', 'A10', 'A11', 'B11'] } });
    const extended = c.live.dispatch({ type: 'heliRoute', to: 'B10', extend: true });
    expect(extended).toMatchObject({ ok: true, data: { path: ['A9', 'A10', 'A11', 'B11', 'B10'] } });
    expect(c.live.dispatch({ type: 'shortenHeliRoute', at: 'A11' })).toMatchObject({
      ok: true,
      data: { path: ['A9', 'A10', 'A11'], edit: 'shortened' },
    });
    expect(c.live.dispatch({ type: 'compressTime', mode: 2 })).toEqual({ ok: true });
    let progress: number | undefined;
    for (let k = 0; k < STEPS && progress === undefined; k++) {
      c.live.advance({ worldSeconds: STEP_SECONDS / 10 });
      const heli = strategic(c).helicopter;
      if (heli && 'next' in heli && heli.next !== null && (heli.progress ?? 0) > 0) progress = heli.progress;
    }
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThanOrEqual(1);
    const flying = strategic(c).groups.find((g) => g.members.includes(m1 ?? -1));
    expect(flying?.traverseMinutes ?? strategic(c).vehicles?.[0]?.traverseMinutes).toBeGreaterThan(0);
    const arrivals: unknown[] = [];
    for (let k = 0; k < STEPS && !arrivals.some((e) => (e as { final?: boolean }).final); k++)
      arrivals.push(...c.live.advance({ worldSeconds: STEP_SECONDS }).events.filter((e) => e.type === 'groupArrived'));
    expect(arrivals).toContainEqual(
      expect.objectContaining({ sector: 'A11', final: true, who: expect.objectContaining({ kind: 'vehicle' }) }),
    );
    expect(strategic(c).helicopter).toMatchObject({ next: null, progress: 0 });
  });
});
