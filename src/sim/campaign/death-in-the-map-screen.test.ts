import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { defaultRunMode } from '../../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { parseSectorString, type Sector, sameSector, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { Direction, WORLD_COLS } from '../../content/world/grid.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import { tacticalContentRoots } from '../../server/session-snapshot.ts';
import type { SimEvent } from '../events.ts';
import { snapshotJson, snapshotTactical } from '../snapshot/session.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { helicopterVehicle, heliState, setUpHelicopterForPlayer } from '../strategic/forces/helicopter.ts';
import { killAllInVehicle } from '../strategic/forces/vehicles.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { isTimeBeingCompressed } from '../strategic/time/world-clock.ts';
import { animName } from '../tactical/anim-states.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { Quote } from './contracts/quotes.ts';
import { campaignProfile } from './profiles.ts';
import type { RosterMerc } from './roster.ts';
import { sectorKey } from './sector-diff.ts';
import { createUnloadedWorld } from './turn-world.ts';

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
const ROUTE_SLICE_SECONDS = 3600;
const ROUTE_BUDGET = 24;
const LINE_TICKS = { ticks: 3000 };
const ONE_TICK = { ticks: 1 };
const LAST_LIFE_POINT = 1;
const BLOOD_LOSS_LIFE = 1;
const BLOOD_LOSS_BREATH = 100;
const KEY_ID = 1;
const KEY_POSITION = 3;
const KEYS_ON_RING = 2;
const OFF_THE_VISIBLE_MAP = [0, 0] as const;
const BODY_AT = [80, 80] as const;
const FLYBACK = 3;
const COLLAPSED_LIFE = 5;
const COLLAPSE_TICKS = { ticks: 400 };
const KILLING_BLOW = 100;
const CIVILIAN_DISTANCE = 4 * WORLD_COLS;
const DROPPED = 80;
const ZEROED_CORPSE_PROFILE = 0;
const DEAD_NPC = 135;
const BUDDY_NPC = 136;
const HOVER = 'A10';
const FLIGHT_SLICE_SECONDS = 300;
const FLIGHT_BUDGET = 24;

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
  const c = { session, live: new ReloadingSession('death-in-the-map-screen', session) };
  await order(c, { type: 'compressTime', mode: 2 });
  await order(c, { type: 'enterSector', sector: LANDING });
  c.live.advance({ idle: true });
  return c;
}

function merc(c: Campaign, profile: number): RosterMerc {
  return c.session.campaign.battle?.roster.all().find((m) => m.profile === profile) ?? never(`merc with profile ${profile}`);
}

function turnWorld(c: Campaign): TacticalState {
  return c.session.campaign.turnWorld()?.state ?? never('turn world');
}

async function routeKestrel(c: Campaign, to: string, until: (m: RosterMerc) => boolean): Promise<void> {
  const kestrel = merc(c, KESTREL).id;
  await order(c, { type: 'route', soldier: kestrel, to });
  for (let k = 0; k < ROUTE_BUDGET && !until(merc(c, KESTREL)); k++) c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  if (!until(merc(c, KESTREL))) throw new Error(`Kestrel never got there on his way to ${to}`);
}

const arrivedIn = (name: string) => (m: RosterMerc) => sameSector(m.sector, parseSectorString(name)) && !m.betweenSectors;

async function kestrelInB9OnTheMap(seed: number): Promise<Campaign> {
  const c = await landedInA9(seed);
  await order(c, { type: 'mapScreen' });
  await order(c, { type: 'assignSquad', soldier: merc(c, KESTREL).id, squad: 'new' });
  await routeKestrel(c, ELSEWHERE, arrivedIn(ELSEWHERE));
  return c;
}

async function compressing(c: Campaign): Promise<void> {
  await order(c, { type: 'compressTime', mode: CompressMode.MIN5 });
  expect(isTimeBeingCompressed(c.session.campaign.state.clock)).toBe(true);
}

function keysOnTheRing(m: RosterMerc): void {
  const ring = m.soldier.keyRing ?? never('key ring');
  ring[KEY_POSITION] = { keyId: KEY_ID, count: KEYS_ON_RING };
}

function scriptTheMainStream(c: Campaign, values: readonly number[]): ScriptedStream {
  const scripted = new ScriptedStream(values);
  vi.spyOn(c.session.campaign.state.rng, 'int').mockImplementation((n) => scripted.int(n));
  return scripted;
}

function bleedToDeath(t: TacticalState, s: Soldier): void {
  s.life = LAST_LIFE_POINT;
  soldierTakeDamage(t, s, BLOOD_LOSS_LIFE, BLOOD_LOSS_BREATH, DamageReason.BLOODLOSS, null);
}

function bleedTheLastPoint(t: TacticalState, m: RosterMerc): void {
  bleedToDeath(t, m.soldier);
}

function records(c: Campaign, sector: Sector) {
  return c.session.campaign.state.sectorDiffs.get(sectorKey(sector)) ?? null;
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

const gridNoOf = ([x, y]: readonly [number, number]) => y * WORLD_COLS + x;

describe('a merc of ours dying while the map screen is up (Strategic.cc HandleStrategicDeath, its fInMapMode branch)', () => {
  it('leaves his body, every item and his keys in his sector at a random tile, buddies anywhere comment, and compression stops (quirk)', async () => {
    const c = await kestrelInB9OnTheMap(41);
    await compressing(c);
    const kestrel = merc(c, KESTREL);
    keysOnTheRing(kestrel);
    const carried = kestrel.soldier.inv.filter((o) => o.item !== 0).map((o) => o.item);
    expect(carried.length).toBeGreaterThan(0);
    const draws = scriptTheMainStream(c, [...OFF_THE_VISIBLE_MAP, ...BODY_AT, FLYBACK]);
    bleedTheLastPoint(turnWorld(c), kestrel);
    vi.restoreAllMocks();
    expect(draws.requested).toEqual([160, 160, 160, 160, 4]);
    const b9 = records(c, parseSectorString(ELSEWHERE)) ?? never('B9 records');
    const body = gridNoOf(BODY_AT);
    expect(b9.corpses).toMatchObject([
      { gridNo: body, level: 0, findSweetSpot: true, bodyType: kestrel.soldier.bodyType, profile: ZEROED_CORPSE_PROFILE },
    ]);
    const dropped = (b9.items ?? []).filter((wi) => wi.exists && wi.gridNo === body).map((wi) => wi.object);
    const key = c.session.campaign.battle?.content.items.byName.get('KEY_1')?.index;
    expect(dropped.map((o) => o.item)).toEqual([...carried, key]);
    expect(dropped.at(-1)).toMatchObject({ keyId: KEY_ID, count: KEYS_ON_RING });
    expect(kestrel.soldier.keyRing?.[KEY_POSITION]?.count).toBe(0);
    const report = c.live.advance(ONE_TICK);
    const lines = c.live.advance(LINE_TICKS);
    const events = [...report.events, ...lines.events];
    expect(ofType(events, 'compressionStopped')).toMatchObject([{ reason: 'mercDied' }]);
    expect(ofType(events, 'mercQuote').filter((e) => e.soldier === merc(c, VANT).id && e.id === Quote.BUDDY_ONE_KILLED)).toHaveLength(1);
    expect(merc(c, KESTREL).assignment).toBe(Assignment.ASSIGNMENT_DEAD);
  });

  it('of a merc between sectors with no sector loaded leaves his body in the sector he left, through the unloaded world', async () => {
    const c = await landedInA9(43);
    await order(c, { type: 'mapScreen' });
    await routeKestrel(c, ELSEWHERE, (m) => m.betweenSectors);
    expect(c.session.campaign.tactical).toBeNull();
    const kestrel = merc(c, KESTREL);
    expect(sameSector(kestrel.sector, parseSectorString(LANDING))).toBe(true);
    bleedTheLastPoint(turnWorld(c), kestrel);
    const events = c.live.advance(ONE_TICK).events;
    expect(ofType(events, 'mercDied')).toMatchObject([{ soldier: kestrel.id, sector: LANDING, mapScreen: true }]);
    expect(records(c, parseSectorString(LANDING))?.corpses).toMatchObject([{ bodyType: kestrel.soldier.bodyType }]);
    expect(records(c, parseSectorString(ELSEWHERE))?.corpses ?? []).toEqual([]);
  });
});

function collapse(c: Campaign, profile: number): void {
  const wounded = merc(c, profile).soldier;
  soldierTakeDamage(turnWorld(c), wounded, wounded.life - COLLAPSED_LIFE, 0, DamageReason.BLOODLOSS, null);
  c.live.advance(COLLAPSE_TICKS);
  expect([merc(c, profile).soldier.collapsed, merc(c, profile).soldier.life]).toEqual([true, COLLAPSED_LIFE]);
}

describe('a merc of the loaded sector dying while the map screen is up (Soldier_Control.cc HandleTakeDamageDeath, both branches)', () => {
  it('lying collapsed, starts his death animation and leaves his body and gear in the loaded sector records, which the unload then overwrites (quirk)', async () => {
    const c = await landedInA9(35);
    collapse(c, VANT);
    await order(c, { type: 'mapScreen' });
    const t = turnWorld(c);
    const vant = merc(c, VANT);
    const corpses = t.corpses.length;
    bleedTheLastPoint(t, vant);
    expect(animName(t.content, vant.soldier.state)).toMatch(/_DEATH$/);
    expect(t.corpses).toHaveLength(corpses);
    const a9 = parseSectorString(LANDING);
    expect(records(c, a9)?.corpses).toMatchObject([{ bodyType: vant.soldier.bodyType }]);
    const body = records(c, a9)?.corpses?.[0]?.gridNo ?? never('the body');
    const mapBranchItems = (records(c, a9)?.items ?? []).filter((wi) => wi.exists).length;
    expect(mapBranchItems).toBeGreaterThan(0);
    expect(merc(c, VANT).assignment).toBe(Assignment.ASSIGNMENT_DEAD);
    await routeKestrel(c, ELSEWHERE, (m) => m.betweenSectors);
    expect(c.session.campaign.tactical).toBeNull();
    expect((records(c, a9)?.corpses ?? []).filter((x) => x.gridNo === body)).toEqual([]);
  });

  it('standing, dies at once in tactical terms, his gear dropped on the live map, and the map branch is skipped (quirk)', async () => {
    const c = await landedInA9(36);
    await order(c, { type: 'mapScreen' });
    const t = turnWorld(c);
    const vant = merc(c, VANT);
    const deaths = c.session.campaign.state.status.mercDeaths;
    const carried = vant.soldier.inv.filter((o) => o.item !== 0).length;
    const onTheMap = t.worldItems.length;
    soldierTakeDamage(t, vant.soldier, KILLING_BLOW, KILLING_BLOW, DamageReason.BLOODLOSS, null);
    expect([vant.soldier.life, vant.soldier.dead]).toEqual([0, true]);
    expect(t.worldItems.length - onTheMap).toBe(carried);
    const events = c.session.campaign.drainEvents();
    expect(ofType(events, 'mercDied')).toEqual([]);
    expect(c.session.campaign.state.status.mercDeaths).toBe(deaths);
    expect(merc(c, VANT).assignment).not.toBe(Assignment.ASSIGNMENT_DEAD);
    expect(records(c, parseSectorString(LANDING))?.corpses ?? []).toEqual([]);
  });
});

function civilianBeside(c: Campaign, profile: number, options: { readonly profile?: number; readonly step?: number } = {}): Soldier {
  const sim = c.session.campaign.tactical ?? never('loaded sector');
  let id = TEAM_FIRST_ID[Team.CIV];
  while (sim.state.soldiers[id]) id++;
  const at = merc(c, profile).soldier.gridNo + CIVILIAN_DISTANCE + (options.step ?? 0);
  const civilian = spawnSoldier(sim, id, Team.CIV, at, Direction.NORTH, options.profile === undefined ? {} : { profile: options.profile });
  civilian.neutral = true;
  return civilian;
}

function collapseCivilian(c: Campaign, civilian: Soldier): void {
  soldierTakeDamage(turnWorld(c), civilian, civilian.life - COLLAPSED_LIFE, 0, DamageReason.BLOODLOSS, null);
  c.live.advance(COLLAPSE_TICKS);
  expect([civilian.collapsed, civilian.life]).toEqual([true, COLLAPSED_LIFE]);
}

describe('a soldier of another team of the loaded sector dying while the map screen is up (Soldier_Control.cc:5400, no team check)', () => {
  it("goes through our team's strategic death: a merc death, our morale and reputation, his body and dropped gear in the sector records, the compression stop (quirk)", async () => {
    const c = await landedInA9(34);
    const civilian = civilianBeside(c, KESTREL);
    collapseCivilian(c, civilian);
    await order(c, { type: 'mapScreen' });
    await compressing(c);
    const campaign = c.session.campaign;
    const status = campaign.state.status;
    const [deaths, reputation] = [status.mercDeaths, status.badReputation];
    const morale = [KESTREL, VANT].map((p) => merc(c, p).soldier.strategicMoraleMod + merc(c, p).soldier.tacticalMoraleMod);
    const t = turnWorld(c);
    const corpses = t.corpses.length;
    const draws = scriptTheMainStream(c, [...BODY_AT, DROPPED, FLYBACK]);
    const tile = civilian.gridNo;
    bleedToDeath(t, civilian);
    vi.restoreAllMocks();
    expect(draws.requested).toEqual([160, 160, 100, 4]);
    expect([civilian.dead, civilian.breath, t.corpses.length]).toEqual([true, 0, corpses]);
    expect(animName(t.content, civilian.state)).toMatch(/_DEATH$/);
    expect(status.mercDeaths).toBe(deaths + 1);
    expect(status.badReputation).toBeGreaterThan(reputation);
    const after = [KESTREL, VANT].map((p) => merc(c, p).soldier.strategicMoraleMod + merc(c, p).soldier.tacticalMoraleMod);
    expect(after.every((m, k) => m < (morale[k] ?? 0))).toBe(true);
    const a9 = records(c, parseSectorString(LANDING)) ?? never('A9 records');
    expect(a9.corpses).toMatchObject([{ gridNo: gridNoOf(BODY_AT), profile: ZEROED_CORPSE_PROFILE }]);
    expect((a9.items ?? []).filter((wi) => wi.exists).map((wi) => wi.object.item)).toEqual([civilian.inv[InvSlot.HAND]?.item]);
    const report = c.live.advance(ONE_TICK);
    expect(ofType(report.events, 'mercDied')).toMatchObject([
      { soldier: civilian.id, sector: LANDING, mapScreen: true, cry: { team: civilian.team, gridNo: tile } },
    ]);
    expect(ofType(report.events, 'compressionStopped')).toMatchObject([{ reason: 'mercDied' }]);
  });

  it('queues the buddy line of a civilian of his own team, never said: ExecuteCharacterDialogue wants a speaker of ours (quirk)', async () => {
    const c = await landedInA9(35);
    const dead = civilianBeside(c, KESTREL, { profile: DEAD_NPC });
    civilianBeside(c, KESTREL, { profile: BUDDY_NPC, step: 2 });
    const content = c.session.campaign.battle?.content ?? never('tactical content');
    const progress = campaignProfile({ profiles: c.session.campaign.state.profiles, content }, BUDDY_NPC) ?? never('buddy profile');
    progress.buddies[0] = DEAD_NPC;
    collapseCivilian(c, dead);
    await order(c, { type: 'mapScreen' });
    bleedToDeath(turnWorld(c), dead);
    expect(c.session.campaign.talk?.talk.queue).toMatchObject([
      { kind: 'quote', speaker: BUDDY_NPC, quote: Quote.BUDDY_ONE_KILLED, fromSoldier: true, subject: DEAD_NPC },
    ]);
    const lines = c.live.advance(LINE_TICKS).events;
    expect(ofType(lines, 'mercQuote')).toEqual([]);
    expect(c.session.campaign.talk?.talk.queue).toEqual([]);
  });
});

function flyingOver(c: Campaign, name: string): boolean {
  const ctx = c.session.campaign.strategic ?? never('strategic layer');
  const heli = helicopterVehicle(ctx);
  return heli !== null && sameSector(heli.sector, parseSectorString(name)) && heliState(ctx).hovering;
}

async function aboardOverA10(seed: number, passengers: readonly number[], walker: number | null = null): Promise<Campaign> {
  const c = await landedInA9(seed);
  const campaign = c.session.campaign;
  const ctx = campaign.strategic ?? never('strategic layer');
  const landing = parseSectorString(LANDING);
  const element = campaign.state.map.elements[strategicIndex(landing)] ?? never('A9 element');
  element.enemyControlled = false;
  setUpHelicopterForPlayer(ctx, landing);
  await order(c, { type: 'mapScreen' });
  for (const profile of passengers) await order(c, { type: 'boardVehicle', soldier: merc(c, profile).id, vehicle: 'helicopter' });
  if (walker !== null) await order(c, { type: 'route', soldier: merc(c, walker).id, to: ELSEWHERE });
  await order(c, { type: 'heliRoute', to: HOVER });
  c.live.advance({ idle: true });
  await compressing(c);
  for (let k = 0; k < FLIGHT_BUDGET && !flyingOver(c, HOVER); k++) c.live.advance({ worldSeconds: FLIGHT_SLICE_SECONDS });
  if (!flyingOver(c, HOVER)) throw new Error(`the helicopter never hovered over ${HOVER}`);
  c.live.advance({ idle: true });
  return c;
}

function shootDown(c: Campaign): void {
  const ctx = c.session.campaign.strategic ?? never('strategic layer');
  killAllInVehicle(ctx, helicopterVehicle(ctx) ?? never('helicopter'));
}

function unloadedWorldSnapshot(c: Campaign, world: TacticalSim): string {
  const content = c.session.campaign.battle?.content ?? never('tactical content');
  return snapshotJson(snapshotTactical(world, tacticalContentRoots(content)));
}

describe('the helicopter shot down while the map screen is up (Vehicles.cc KillAllInVehicle, Map_Screen_Helicopter.cc SkyriderDestroyed)', () => {
  it('kills its passengers through SoldierTakeDamage on the unloaded world, their bodies in its sector', async () => {
    const c = await aboardOverA10(31, [KESTREL, VANT]);
    expect(c.session.campaign.tactical).toBeNull();
    await compressing(c);
    shootDown(c);
    const report = c.live.advance(ONE_TICK);
    const passengers = [KESTREL, VANT].map((p) => merc(c, p).id);
    expect(ofType(report.events, 'mercDied')).toMatchObject(passengers.map((soldier) => ({ soldier, sector: HOVER, mapScreen: true })));
    expect(ofType(report.events, 'compressionStopped')).toMatchObject([{ reason: 'mercDied' }]);
    const bodies = records(c, parseSectorString(HOVER))?.corpses ?? [];
    expect(bodies.map((x) => x.bodyType)).toEqual([KESTREL, VANT].map((p) => merc(c, p).soldier.bodyType));
    expect(ofType(report.events, 'damageFeedback').map((e) => e.soldier)).toEqual(passengers);
  });

  it('leaves the unloaded world empty, the same as one built afresh, across a compressed stretch', async () => {
    const c = await aboardOverA10(38, [KESTREL], VANT);
    expect(c.session.campaign.tactical).toBeNull();
    await compressing(c);
    c.live.advance({ worldSeconds: FLIGHT_SLICE_SECONDS });
    shootDown(c);
    const shot = c.session.campaign.turnWorld() ?? never('turn world');
    c.live.advance(ONE_TICK);
    expect(merc(c, KESTREL).soldier.dead).toBe(true);
    const used = c.session.campaign.turnWorld() ?? never('turn world');
    expect(used === shot).toBe(defaultRunMode() === null);
    expect([used.state.soldiers, used.state.worldItems, used.state.corpses, used.state.events]).toEqual([[], [], [], []]);
    expect(unloadedWorldSnapshot(c, used)).toBe(unloadedWorldSnapshot(c, createUnloadedWorld(c.session.campaign, used.state.content)));
    c.live.advance({ idle: true });
    await compressing(c);
    c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
    const later = c.session.campaign.turnWorld() ?? never('turn world');
    expect(later.state.events).toEqual([]);
    expect(unloadedWorldSnapshot(c, later)).toBe(unloadedWorldSnapshot(c, createUnloadedWorld(c.session.campaign, later.state.content)));
  });
});
