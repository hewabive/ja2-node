import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId } from '../../../tests/support/explosives.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { parseSectorString, type Sector } from '../../content/strategic/sector-ids.ts';
import { Direction, WORLD_COLS } from '../../content/world/grid.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { isTimeBeingCompressed } from '../strategic/time/world-clock.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import { newSmokeEffect } from '../tactical/explosions/smoke.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import { Personality, type Soldier, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const KESTREL = 0;
const VANT = 1;
const LANDING = 'A9';
const ELSEWHERE = 'B9';
const BASEMENT: Sector = { x: 10, y: 1, z: 1 };
const TICKS_PER_POLL = 4;
const POLLS = 100;
const POLLED = { ticks: POLLS * TICKS_PER_POLL };
const A_REAL_SECOND = { ticks: 200 };
const TWO_REAL_SECONDS = { ticks: 400 };
const FOUR_REAL_SECONDS = { ticks: 800 };
const DECAY_CHECK_AT_5_MINUTES = 5 * 300;
const FIVE_POLLS = { ticks: 5 * TICKS_PER_POLL };
const LINE_TICKS = { ticks: 3000 };
const AN_HOUR = { worldSeconds: 3600 };
const TURN_COUNTER = 250;
const SLICE_SECONDS = 60;
const SECONDS_PER_MINUTE = 60;
const REAL_SECONDS_POLLED = 2;
const SLOWEST_TO_FASTEST_BLEEDING = 12;
const SPEEDS = [
  [CompressMode.MIN5, 300],
  [CompressMode.MIN30, 1800],
  [CompressMode.MIN60, 3600],
] as const;
const WOUNDED = { lifeMax: 80, life: 60, bleeding: 20, nextBleed: 0.5, warnedAboutBleeding: true };
const BLEEDING = { lifeMax: 80, life: 60, bleeding: 20, nextBleed: 0.5, warnedAboutBleeding: false };
const LAST_LIFE_POINT = { lifeMax: 80, life: 1, bleeding: 20, nextBleed: 0.5 };
const BLEEDING_CIVILIAN = { lifeMax: 60, life: 50, bleeding: 30, nextBleed: 0.5 };
const COLLAPSED_LIFE = 5;
const COLLAPSE_TICKS = { ticks: 400 };
const CIVILIAN_DISTANCE = 4 * WORLD_COLS;
const CLAUSTROPHOBE_DIE = 5;
const ROUTE_SLICE_SECONDS = 3600;
const ROUTE_BUDGET = 24;

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
  for (const name of [LANDING, ELSEWHERE])
    Object.assign(sectorInfo(map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = session.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

async function landedInA9(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL, VANT], land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  quiet(session);
  const c = { session, live: new ReloadingSession('map-screen-turns', session) };
  await order(c, { type: 'compressTime', mode: CompressMode.MIN5 });
  await order(c, { type: 'skipHelicopterDrop' });
  await order(c, { type: 'enterSector', sector: LANDING });
  c.live.advance({ idle: true });
  return c;
}

async function onTheMap(seed: number): Promise<Campaign> {
  const c = await landedInA9(seed);
  await order(c, { type: 'mapScreen' });
  return c;
}

async function travellingWithNoSectorLoaded(seed: number): Promise<Campaign> {
  const c = await onTheMap(seed);
  await order(c, { type: 'route', soldier: merc(c, KESTREL).id, to: ELSEWHERE });
  for (let k = 0; k < ROUTE_BUDGET && !merc(c, KESTREL).betweenSectors; k++) c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  expect([merc(c, KESTREL).betweenSectors, merc(c, VANT).betweenSectors, c.session.campaign.tactical]).toEqual([true, true, null]);
  return c;
}

async function compressing(c: Campaign, mode: number): Promise<void> {
  await order(c, { type: 'compressTime', mode });
  expect(isTimeBeingCompressed(c.session.campaign.state.clock)).toBe(true);
}

function merc(c: Campaign, profile: number): RosterMerc {
  return c.session.campaign.battle?.roster.all().find((m) => m.profile === profile) ?? never(`merc with profile ${profile}`);
}

function loaded(c: Campaign): TacticalState {
  return c.session.campaign.tactical?.state ?? never('loaded sector');
}

function worldSeconds(c: Campaign): number {
  return c.session.campaign.state.clock.seconds;
}

function startCountingTurns(c: Campaign, profile: number): void {
  merc(c, profile).soldier.ai.underFire = TURN_COUNTER;
}

function turnsCounted(c: Campaign, profile: number): number {
  return TURN_COUNTER - merc(c, profile).soldier.ai.underFire;
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function civilianBeside(c: Campaign, profile: number): Soldier {
  const sim = c.session.campaign.tactical ?? never('loaded sector');
  let id = TEAM_FIRST_ID[Team.CIV];
  while (sim.state.soldiers[id]) id++;
  const civilian = spawnSoldier(sim, id, Team.CIV, merc(c, profile).soldier.gridNo + CIVILIAN_DISTANCE, Direction.NORTH);
  civilian.neutral = true;
  return civilian;
}

function liveClouds(t: TacticalState): number {
  return t.explosives.smokeClouds.filter((cloud) => cloud !== null).length;
}

function recordDraws(c: Campaign): number[] {
  const draws: number[] = [];
  const rng = c.session.campaign.state.rng;
  const int = rng.int.bind(rng);
  vi.spyOn(rng, 'int').mockImplementation((n) => {
    draws.push(n);
    return int(n);
  });
  return draws;
}

describe('the map screen polls the real-time turn while time is compressed (MapScreen.cc MapScreenHandle, Strategic_Turns.cc HandleStrategicTurn)', () => {
  it('every 20 ms, a turn at each poll at 5, 30 and 60 min/s, so 10, 1⅔ and ⅚ turns a world minute (quirk)', async () => {
    const c = await onTheMap(81);
    for (const [mode, speed] of SPEEDS) {
      await compressing(c, mode);
      c.live.advance(A_REAL_SECOND);
      startCountingTurns(c, KESTREL);
      const before = worldSeconds(c);
      c.live.advance(POLLED);
      expect(turnsCounted(c, KESTREL)).toBe(POLLS);
      const elapsed = worldSeconds(c) - before;
      expect(Math.abs(elapsed - REAL_SECONDS_POLLED * speed)).toBeLessThanOrEqual(SLICE_SECONDS);
    }
  });

  it('so a wounded merc bleeds as much in the same real time at 5 and at 60 min/s: twelve times more per world minute at 5 (quirk)', async () => {
    const c = await onTheMap(82);
    const bleed = async (mode: number) => {
      await compressing(c, mode);
      c.live.advance(A_REAL_SECOND);
      Object.assign(merc(c, VANT).soldier, WOUNDED);
      const before = worldSeconds(c);
      c.live.advance(POLLED);
      return { lost: WOUNDED.life - merc(c, VANT).soldier.life, minutes: (worldSeconds(c) - before) / SECONDS_PER_MINUTE };
    };
    const fast = await bleed(CompressMode.MIN5);
    const slow = await bleed(CompressMode.MIN60);
    expect(fast.lost).toBeGreaterThan(0);
    expect(slow.lost).toBe(fast.lost);
    expect(Math.round(slow.minutes / fast.minutes)).toBe(SLOWEST_TO_FASTEST_BLEEDING);
  });

  it("runs none at X0 or under the player's pause, its 20 ms counter running on", async () => {
    const c = await onTheMap(83);
    startCountingTurns(c, KESTREL);
    c.live.advance(POLLED);
    expect(turnsCounted(c, KESTREL)).toBe(0);
    await compressing(c, CompressMode.MIN30);
    Object.assign(c.session.campaign.state.clock, { paused: true, playerPause: true });
    c.live.advance(POLLED);
    expect(turnsCounted(c, KESTREL)).toBe(0);
    const s = c.session.campaign.state;
    expect(s.realMs - s.sectorFlow.realtimeClock.lastOverheadMs).toBeLessThan(TICKS_PER_POLL * 5);
  });

  it('waits while the bleeding warning it brought pauses the map, and goes on after it', async () => {
    const c = await onTheMap(84);
    await compressing(c, CompressMode.MIN5);
    Object.assign(merc(c, VANT).soldier, BLEEDING);
    startCountingTurns(c, KESTREL);
    const warned = c.live.advance({ ticks: A_REAL_SECOND.ticks, events: ['mercQuote'] });
    expect(ofType(warned.events, 'mercQuote').map((e) => e.id)).toEqual([MercQuote.STARTING_TO_BLEED]);
    const atTheWarning = turnsCounted(c, KESTREL);
    expect(c.session.campaign.state.clock.paused).toBe(true);
    c.live.advance(FIVE_POLLS);
    expect(turnsCounted(c, KESTREL)).toBe(atTheWarning);
    c.live.advance(LINE_TICKS);
    expect(turnsCounted(c, KESTREL)).toBeGreaterThan(atTheWarning);
  });
});

describe('the map screen turn with no sector loaded (TrashWorld: the first pass on an empty world)', () => {
  it('bleeds a travelling merc through the unloaded world, which stays empty', async () => {
    const c = await travellingWithNoSectorLoaded(85);
    await compressing(c, CompressMode.MIN5);
    Object.assign(merc(c, KESTREL).soldier, WOUNDED);
    const report = c.live.advance(POLLED);
    expect(merc(c, KESTREL).soldier.life).toBeLessThan(WOUNDED.life);
    expect(ofType(report.events, 'damageFeedback').map((e) => e.soldier)).toContain(merc(c, KESTREL).id);
    const world = c.session.campaign.turnWorld()?.state ?? never('turn world');
    expect([world.soldiers, world.corpses, world.events]).toEqual([[], [], []]);
  });

  it('ends an advance at the death of a merc who bleeds out, with compressionStopped mercDied', async () => {
    const c = await travellingWithNoSectorLoaded(86);
    Object.assign(merc(c, KESTREL).soldier, LAST_LIFE_POINT);
    const report = c.live.advance(AN_HOUR);
    expect(report.reason).toBe('event');
    expect(ofType(report.events, 'mercDied')).toMatchObject([{ soldier: merc(c, KESTREL).id, sector: LANDING, mapScreen: true }]);
    expect(ofType(report.events, 'compressionStopped')).toMatchObject([{ reason: 'mercDied' }]);
  });
});

describe('the map screen turn against the loaded sector (Tactical_Turns.cc HandleTacticalEndTurn, both passes)', () => {
  it("bleeds the sector's civilians and ages its smoke, their events coming out at once with the campaign's tick", async () => {
    const c = await landedInA9(87);
    const civilian = civilianBeside(c, KESTREL);
    Object.assign(civilian, BLEEDING_CIVILIAN);
    const t = loaded(c);
    newSmokeEffect(t, merc(c, KESTREL).soldier.gridNo + 2 * CIVILIAN_DISTANCE, itemId(t, 'SMOKE_GRENADE'), 0, null);
    expect(liveClouds(t)).toBe(1);
    await order(c, { type: 'mapScreen' });
    await compressing(c, CompressMode.MIN5);
    const frozenTick = loaded(c).tick;
    const start = c.session.campaign.tick;
    const report = c.live.advance(POLLED);
    expect(loaded(c).soldiers[civilian.id]?.life).toBeLessThan(BLEEDING_CIVILIAN.life);
    expect(liveClouds(loaded(c))).toBe(0);
    expect(loaded(c).tick).toBe(frozenTick);
    const lost = ofType(report.events, 'lifeLost').filter((e) => e.soldier === civilian.id);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((e) => e.tick > start && e.tick <= c.session.campaign.tick)).toBe(true);
  });

  it("bleeds a collapsed civilian to death there, into our team's strategic death and its compression stop (quirk)", async () => {
    const c = await landedInA9(88);
    const civilian = civilianBeside(c, KESTREL);
    soldierTakeDamage(loaded(c), civilian, civilian.life - COLLAPSED_LIFE, 0, DamageReason.BLOODLOSS, null);
    c.live.advance(COLLAPSE_TICKS);
    const lying = loaded(c).soldiers[civilian.id] ?? never('civilian');
    expect(lying.collapsed).toBe(true);
    Object.assign(lying, { life: 1, bleeding: BLEEDING_CIVILIAN.bleeding, nextBleed: 0.5 });
    await order(c, { type: 'mapScreen' });
    const deaths = c.session.campaign.state.status.mercDeaths;
    const report = c.live.advance(AN_HOUR);
    expect(ofType(report.events, 'mercDied')).toMatchObject([{ soldier: civilian.id, sector: LANDING, mapScreen: true }]);
    expect(ofType(report.events, 'compressionStopped')).toMatchObject([{ reason: 'mercDied' }]);
    expect(c.session.campaign.state.status.mercDeaths).toBe(deaths + 1);
  });

  it('decays its blood and smells only every 5 real seconds of compressed time (Smell.cc DecayBloodAndSmells)', async () => {
    const c = await onTheMap(90);
    await compressing(c, CompressMode.MIN5);
    c.live.advance(A_REAL_SECOND);
    const stamped = worldSeconds(c);
    loaded(c).smell.lastDecaySeconds = stamped;
    c.live.advance(FOUR_REAL_SECONDS);
    expect(loaded(c).smell.lastDecaySeconds).toBe(stamped);
    c.live.advance(TWO_REAL_SECONDS);
    expect(loaded(c).smell.lastDecaySeconds).toBeGreaterThan(stamped + DECAY_CHECK_AT_5_MINUTES);
  });

  it('rolls each claustrophobe of an underground sector at every poll (quirk)', async () => {
    const c = await landedInA9(89);
    for (const m of c.session.campaign.battle?.roster.all() ?? []) m.sector = { ...BASEMENT };
    const flow = c.session.campaign.sectors ?? never('sector flow');
    await c.session.prepareMaps([flow.mapPathOf(BASEMENT)]);
    expect(flow.setCurrentWorldSector(BASEMENT)).toBe(true);
    await order(c, { type: 'mapScreen' });
    merc(c, KESTREL).soldier.personalityTrait = Personality.CLAUSTROPHOBIC;
    merc(c, VANT).soldier.personalityTrait = Personality.NONE;
    await compressing(c, CompressMode.MIN60);
    startCountingTurns(c, VANT);
    const draws = recordDraws(c);
    c.live.advance(POLLED);
    expect(turnsCounted(c, VANT)).toBeGreaterThan(0);
    expect(draws.filter((n) => n === CLAUSTROPHOBE_DIE)).toHaveLength(turnsCounted(c, VANT));
  });
});
