import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, ScriptedRolls, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorId, parseSectorString, type Sector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Direction } from '../../../content/world/grid.ts';
import { CampaignSim } from '../../campaign/campaign-sim.ts';
import { initStrategicMovementCosts } from '../map/init.ts';
import { getSectorFlagStatus, sectorInfo } from '../map/sectors.ts';
import { getSectorMvtTimeForGroup } from '../map/travel.ts';
import { createStrategicState } from '../state.ts';
import { CompressMode, EventKind, NUM_SEC_IN_DAY, NUM_SEC_IN_HOUR } from '../time/constants.ts';
import { isTimeBeingCompressed } from '../time/world-clock.ts';
import { GroupFlag, InsertionCode, MoveType, SectorFlag } from './constants.ts';
import { addPlayerToGroup, createNewEnemyGroupDepartingFromSector, createNewPlayerGroupDepartingFromSector, type Group } from './groups.ts';
import {
  addWaypointToPGroup,
  calculateNextMoveIntention,
  groupArrivedAtSector,
  nowMinutes,
  rebuildWayPointsForGroupPath,
  retreatGroupToPreviousSector,
} from './movement.ts';
import { type StrategicContext, TravelStat } from './ports.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const S = (name: string): Sector => parseSectorString(name);
const route = (...names: string[]) => names.map((n) => strategicIndex(S(n)));
const NOON = NUM_SEC_IN_DAY + 12 * NUM_SEC_IN_HOUR;
const LATE_EVENING = NUM_SEC_IN_DAY + 22 * NUM_SEC_IN_HOUR;

function squadContext(options: { worldSeconds?: number; random?: ScriptedRolls; world?: Parameters<typeof testContext>[0]['world'] } = {}) {
  const mercs = new FakeMercs();
  const ctx = testContext({
    content,
    mercs,
    state: createStrategicState({ worldSeconds: options.worldSeconds ?? NOON }),
    ...(options.random ? { random: options.random } : {}),
    ...(options.world ? { world: options.world } : {}),
  });
  initStrategicMovementCosts(ctx);
  return { ctx, mercs };
}

function squadAt(ctx: StrategicContext, mercs: FakeMercs, sector: Sector, ids: readonly number[]): Group {
  const g = createNewPlayerGroupDepartingFromSector(ctx, sector);
  for (const id of ids) {
    mercs.add({ id, sector, lifeMax: 80, strength: 90 });
    addPlayerToGroup(ctx, g, id);
  }
  return g;
}

function giveRoute(ctx: StrategicContext, mercs: FakeMercs, g: Group, path: number[]): void {
  for (const id of g.members) {
    const m = mercs.get(id);
    if (m) m.path = [...path];
  }
  rebuildWayPointsForGroupPath(ctx, path, g);
}

const events = (ctx: StrategicContext) => ctx.state.queue.events.map((e) => [e.kind, e.stamp / 60, e.param]);

describe('departure', () => {
  it('posts the arrival and the about-to-arrive event and takes the members off the map', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0, 1]);
    const now = nowMinutes(ctx);
    giveRoute(ctx, mercs, g, route('A9', 'B9', 'C9'));
    expect(g).toMatchObject({ betweenSectors: true, next: S('B9'), traverseTime: 89, arrivalTime: now + 89 });
    expect(g.waypoints).toEqual([{ ...S('C9') }]);
    expect(events(ctx)).toEqual([
      [EventKind.GROUP_ABOUT_TO_ARRIVE, now + 84, g.id],
      [EventKind.GROUP_ARRIVAL, now + 89, g.id],
    ]);
    expect(mercs.get(0)?.betweenSectors).toBe(true);
    expect(mercs.removedFromSector).toEqual([0, 1]);
  });

  it('posts the about-to-arrive event only when it is strictly ahead', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    const now = nowMinutes(ctx);
    giveRoute(ctx, mercs, g, route('A9', 'A10'));
    expect(g.traverseTime).toBe(5);
    expect(events(ctx)).toEqual([[EventKind.GROUP_ARRIVAL, now + 5, g.id]]);
  });

  it('keeps only the pivots of the path as waypoints', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    giveRoute(ctx, mercs, g, route('A9', 'B9', 'C9', 'C10', 'C11', 'D11'));
    expect(g.waypoints).toEqual([S('C9'), S('C11'), S('D11')]);
  });

  it('lets enemies sleep only between 21:00 and 04:59, with one chance roll and one duration roll', () => {
    const day = squadContext({ random: new ScriptedRolls() });
    const patrol = createNewEnemyGroupDepartingFromSector(day.ctx, parseSectorId('B9'), 0, 2, 0);
    patrol.moveType = MoveType.ONE_WAY;
    addWaypointToPGroup(day.ctx, patrol, S('C9'));
    expect((day.ctx.random as ScriptedRolls).ranges).toEqual([]);
    const traverse = patrol.traverseTime;
    const rolls = new ScriptedRolls([10, 50]);
    const night = squadContext({ worldSeconds: LATE_EVENING, random: rolls });
    const sleeper = createNewEnemyGroupDepartingFromSector(night.ctx, parseSectorId('B9'), 0, 2, 0);
    addWaypointToPGroup(night.ctx, sleeper, S('C9'));
    expect(rolls.ranges).toEqual([100, 121]);
    expect(sleeper.traverseTime).toBe(traverse + 360 + 50);
    const awake = squadContext({ worldSeconds: LATE_EVENING, random: new ScriptedRolls([90]) });
    const guard = createNewEnemyGroupDepartingFromSector(awake.ctx, parseSectorId('B9'), 0, 2, 0);
    addWaypointToPGroup(awake.ctx, guard, S('C9'));
    expect(guard.traverseTime).toBe(traverse);
  });

  it('delays an enemy group that would pass the player group head-on', () => {
    const rolls = new ScriptedRolls([4]);
    const { ctx, mercs } = squadContext({ random: rolls });
    const enemy = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('B9'), 0, 2, 0);
    enemy.next = S('A9');
    enemy.betweenSectors = true;
    enemy.arrivalTime = nowMinutes(ctx) + 10;
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    giveRoute(ctx, mercs, g, route('A9', 'B9'));
    expect(enemy.arrivalTime).toBe(g.arrivalTime + 1 + 4);
  });
});

describe('arrival', () => {
  it('walks a squad along its route through the event queue and stops compression at the destination', () => {
    const mercs = new FakeMercs();
    const state = createStrategicState({ worldSeconds: NOON });
    state.atLeastOneMercHired = true;
    const campaign = new CampaignSim(state, null, { strategic: { content, mercs } });
    const ctx = campaign.strategic as StrategicContext;
    initStrategicMovementCosts(ctx);
    for (const e of ctx.state.map.elements) e.enemyControlled = true;
    const g = squadAt(ctx, mercs, S('A9'), [0, 1]);
    giveRoute(ctx, mercs, g, route('A9', 'B9', 'C9'));
    const legTwo = getSectorMvtTimeForGroup(ctx, parseSectorId('B9'), 2, g);
    const start = nowMinutes(ctx);
    expect(campaign.dispatch({ type: 'compressTime', mode: CompressMode.MIN60 })).toEqual({ ok: true });
    for (let k = 0; k < 20000 && isTimeBeingCompressed(state.clock); k++) campaign.step();
    expect(isTimeBeingCompressed(state.clock)).toBe(false);
    expect(g).toMatchObject({ sector: S('C9'), prev: S('B9'), betweenSectors: false, waypoints: [] });
    expect(nowMinutes(ctx) - start).toBeLessThanOrEqual(89 + legTwo + 1);
    expect(mercs.get(0)).toMatchObject({
      sector: S('C9'),
      insertionCode: InsertionCode.NORTH,
      insertionDirection: Direction.SOUTHEAST,
      path: [],
    });
    expect(getSectorFlagStatus(ctx.state.map, S('B9'), SectorFlag.ALREADY_VISITED)).toBe(true);
    expect(ctx.state.map.elements[strategicIndex(S('B9'))]?.enemyControlled).toBe(false);
    expect(mercs.experience.filter((e) => e.id === 0).map((e) => e.points)).toEqual([4, Math.trunc(legTwo / 22)]);
  });

  it('chooses the insertion code from the travel direction and keeps edge-index codes', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('B10'), [0, 1]);
    const keeper = mercs.get(1);
    if (keeper) keeper.insertionCode = InsertionCode.PRIMARY_EDGEINDEX;
    g.next = S('B9');
    g.betweenSectors = true;
    groupArrivedAtSector(ctx, g, false, false);
    expect(mercs.get(0)).toMatchObject({ insertionCode: InsertionCode.EAST, insertionDirection: Direction.SOUTHWEST });
    expect(mercs.get(1)?.insertionCode).toBe(InsertionCode.PRIMARY_EDGEINDEX);
  });

  it('forgets an edge-index entry once the group gets a new waypoint, leaving code 0 (north) until it arrives from the west', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    const traveller = mercs.get(0);
    if (traveller) traveller.insertionCode = InsertionCode.PRIMARY_EDGEINDEX;
    giveRoute(ctx, mercs, g, route('A9', 'A10'));
    expect(traveller?.insertionCode).toBe(InsertionCode.NORTH);
    groupArrivedAtSector(ctx, g, false, false);
    expect(traveller?.insertionCode).toBe(InsertionCode.WEST);
  });

  it('asks for a strength gain even when the leg earns zero points, while health needs at least one', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    mercs.encumbrance.set(0, 60);
    giveRoute(ctx, mercs, g, route('A9', 'A10'));
    groupArrivedAtSector(ctx, g, false, false);
    expect(mercs.experience).toEqual([{ id: 0, stat: TravelStat.STRENGTH, points: 0 }]);
  });

  it('delays the arrival by 3 to 5 minutes while another battle runs', () => {
    const rolls = new ScriptedRolls([2]);
    const { ctx, mercs } = squadContext({ random: rolls, world: { enemyInSector: () => true } });
    squadAt(ctx, mercs, S('A10'), [5]);
    ctx.state.worldSector = S('A10');
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    giveRoute(ctx, mercs, g, route('A9', 'B9'));
    const arrival = g.arrivalTime;
    ctx.state.queue.events.length = 0;
    groupArrivedAtSector(ctx, g, true, false);
    expect(g).toMatchObject({ arrivalTime: arrival + 5, sector: S('A9'), betweenSectors: true });
    expect(events(ctx)).toEqual([
      [EventKind.GROUP_ABOUT_TO_ARRIVE, arrival, g.id],
      [EventKind.GROUP_ARRIVAL, arrival + 5, g.id],
    ]);
  });
});

describe("the queen's alert (Strategic_Movement.cc GroupArrivedAtSector)", () => {
  it('takes one battle off the alert when an arriving group meets enemies', () => {
    const { ctx, mercs } = squadContext();
    ctx.state.queen.awareBattles = 2;
    sectorInfo(ctx.state.map, S('B9')).numTroops = 3;
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    giveRoute(ctx, mercs, g, route('A9', 'B9'));
    groupArrivedAtSector(ctx, g, true, false);
    expect(ctx.state.encounter.preBattle?.battleGroupId).toBe(g.id);
    expect(ctx.state.queen.awareBattles).toBe(1);
  });

  it('also takes one off for an arrival nobody checks for a battle, as every group pulled into a battle arrives', () => {
    const { ctx, mercs } = squadContext();
    ctx.state.queen.awareBattles = 2;
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    giveRoute(ctx, mercs, g, route('A9', 'B9'));
    groupArrivedAtSector(ctx, g, false, false);
    expect(g).toMatchObject({ sector: S('B9'), betweenSectors: false });
    expect(ctx.state.queen.awareBattles).toBe(1);
  });
});

describe('arrivals during a boxing match', () => {
  const enemyReaching = (boxing: boolean, rolls: number[]) => {
    const { ctx } = squadContext({ random: new ScriptedRolls(rolls), world: { boxing: () => boxing } });
    const g = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('D6'), 0, 2, 0);
    g.next = S('D5');
    g.betweenSectors = true;
    g.arrivalTime = nowMinutes(ctx);
    ctx.state.queue.events.length = 0;
    groupArrivedAtSector(ctx, g, true, false);
    return { ctx, g };
  };

  it('queues an enemy group reaching San Mona while a match runs, for 3 to 5 minutes', () => {
    const { ctx, g } = enemyReaching(true, [1]);
    expect(g).toMatchObject({ sector: S('D6'), betweenSectors: true, arrivalTime: nowMinutes(ctx) + 4 });
  });

  it('lets the same group in when nobody boxes', () => {
    const { g } = enemyReaching(false, []);
    expect(g).toMatchObject({ sector: S('D5'), betweenSectors: false });
  });
});

describe('reversal', () => {
  it('returns a cancelled group in the time it already travelled', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    const t0 = nowMinutes(ctx);
    giveRoute(ctx, mercs, g, route('A9', 'B9'));
    ctx.state.clock.seconds += 30 * 60;
    rebuildWayPointsForGroupPath(ctx, null, g);
    expect(g).toMatchObject({ sector: S('B9'), next: S('A9'), prev: S('B9'), traverseTime: 89, arrivalTime: t0 + 60 });
    expect(events(ctx).filter((e) => e[0] === EventKind.GROUP_ARRIVAL)).toEqual([[EventKind.GROUP_ARRIVAL, t0 + 60, g.id]]);
    expect(mercs.get(0)?.sector).toEqual(S('B9'));
  });

  it('treats a 90° replan as a reversal and puts the new current sector in front of the path', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    giveRoute(ctx, mercs, g, route('A9', 'B9'));
    ctx.state.clock.seconds += 10 * 60;
    removeWaypoints(g);
    expect(addWaypointToPGroup(ctx, g, S('A10'))).toBe(true);
    expect(g).toMatchObject({ sector: S('B9'), next: S('A9') });
    expect(mercs.get(0)?.path[0]).toBe(strategicIndex(S('B9')));
  });

  it('arrives without experience when the group turns back before leaving', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    giveRoute(ctx, mercs, g, route('A9', 'B9'));
    rebuildWayPointsForGroupPath(ctx, null, g);
    expect(g).toMatchObject({ sector: S('A9'), betweenSectors: false });
    expect(mercs.experience).toEqual([]);
  });
});

describe('enemy routes and retreat', () => {
  it('cycles a circular patrol through its waypoints', () => {
    const { ctx } = squadContext();
    const g = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('B9'), 0, 2, 0);
    g.waypoints = [S('B9'), S('C9')];
    g.nextWaypointId = 1;
    g.sector = S('C9');
    calculateNextMoveIntention(ctx, g);
    expect(g).toMatchObject({ nextWaypointId: 0, next: S('B9'), betweenSectors: true });
  });

  it('retreats to the previous sector and marks the group', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('B9'), [0]);
    g.prev = S('A9');
    retreatGroupToPreviousSector(ctx, g);
    expect(g).toMatchObject({ next: S('A9'), betweenSectors: true, traverseTime: 89 });
    expect(g.flags & GroupFlag.JUST_RETREATED_FROM_BATTLE).toBeTruthy();
  });

  it('picks the first passable side when the group has no previous sector', () => {
    const { ctx, mercs } = squadContext();
    const g = squadAt(ctx, mercs, S('A9'), [0]);
    expect(g.prev).toEqual({ x: 16, y: 16, z: 0 });
    retreatGroupToPreviousSector(ctx, g);
    expect(g.next).toEqual(S('A10'));
    expect(mercs.get(0)?.prevSectorId).toBe(parseSectorId('A10'));
    expect(sectorInfo(ctx.state.map, S('A9')).traversability[1]).toBe(0);
  });
});

function removeWaypoints(g: Group): void {
  g.waypoints = [];
  g.nextWaypointId = 0;
}
