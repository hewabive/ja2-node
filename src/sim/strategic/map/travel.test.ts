import { beforeAll, describe, expect, it } from 'vitest';
import {
  FakeMercs,
  loadStrategicTestContent,
  testContext,
  uniformMovementCosts,
  withMovementCosts,
} from '../../../../tests/support/strategic.ts';
import { TransportMask } from '../../../content/strategic/policy.ts';
import { parseSectorId, parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Assignment } from '../forces/constants.ts';
import { addPlayerToGroup, createNewEnemyGroupDepartingFromSector, createNewPlayerGroupDepartingFromSector } from '../forces/groups.ts';
import { initStrategicMovementCosts } from './init.ts';
import { Traversability } from './sectors.ts';
import {
  calculateTravelTimeOfGroup,
  findTravelTimeBetweenWaypoints,
  sectorMovementTime,
  TRAVERSE_TIME_IMPOSSIBLE,
  type TravelInputs,
} from './travel.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const T = Traversability;
const X = TRAVERSE_TIME_IMPOSSIBLE;
const TABLE: readonly (readonly [number, number, number, number, number, number])[] = [
  [T.TOWN, 5, 5, 5, 5, 10],
  [T.ROAD, 89, 30, 32, 46, 10],
  [T.PLAINS, 104, X, 42, 46, 10],
  [T.SAND, 178, X, X, 65, 10],
  [T.SPARSE, 127, X, 53, 76, 10],
  [T.DENSE, 148, X, X, X, 10],
  [T.SWAMP, 254, X, X, X, 10],
  [T.WATER, 356, X, X, 460, 10],
  [T.HILLS, 178, X, 64, 76, 10],
  [T.GROUNDBARRIER, X, X, X, X, 10],
  [T.NS_RIVER, 356, X, X, 230, 10],
  [T.EW_RIVER, 356, X, X, 230, 10],
  [T.EDGEOFWORLD, X, X, X, X, X],
];
const MASKS = [TransportMask.FOOT, TransportMask.CAR, TransportMask.TRUCK, TransportMask.TRACKED, TransportMask.AIR];

function inputs(
  terrain: number,
  encumbrance: Readonly<Record<number, number>> = {},
  assignments: Readonly<Record<number, number>> = {},
): TravelInputs {
  return {
    table: content.travel,
    traversability: () => terrain,
    memberAssignment: (id) => assignments[id] ?? Assignment.SQUAD_1,
    encumbrance: (id) => encumbrance[id] ?? 0,
  };
}

describe('GetSectorMvtTimeForGroup', () => {
  it('reproduces the minutes of every transport on every edge type', () => {
    for (const [terrain, ...minutes] of TABLE) {
      const ours = MASKS.map((mask) => sectorMovementTime(inputs(terrain), 0, 0, { player: false, transportMask: mask, members: [] }));
      expect(ours, `terrain ${terrain}`).toEqual(minutes);
    }
  });

  it('slows a walking player group by its most encumbered walker, never below 100%, with integer division', () => {
    const group = { player: true, transportMask: TransportMask.FOOT, members: [1, 2, 3] };
    expect(sectorMovementTime(inputs(T.ROAD, { 1: 40, 2: 90 }), 0, 0, group)).toBe(89);
    expect(sectorMovementTime(inputs(T.ROAD, { 1: 40, 2: 123, 3: 110 }), 0, 0, group)).toBe(Math.trunc((89 * 123) / 100));
    expect(sectorMovementTime(inputs(T.PLAINS, { 2: 150 }, { 2: Assignment.VEHICLE }), 0, 0, group)).toBe(104);
    expect(sectorMovementTime(inputs(T.TOWN, { 1: 300 }), 0, 0, group)).toBe(5);
    expect(sectorMovementTime(inputs(T.ROAD, { 1: 300 }), 0, 0, { ...group, player: false })).toBe(89);
  });

  it('makes a mixed mask impossible as soon as one transport cannot cross the terrain', () => {
    const group = { player: false, transportMask: TransportMask.FOOT | TransportMask.CAR, members: [] };
    expect(sectorMovementTime(inputs(T.PLAINS), 0, 0, group)).toBe(X);
    expect(sectorMovementTime(inputs(T.ROAD), 0, 0, group)).toBe(30);
  });
});

describe('travel time along waypoints', () => {
  it('sums edge times between aligned sectors and ignores the current waypoint index', () => {
    const ctx = testContext({ content: withMovementCosts(content, uniformMovementCosts(T.ROAD)) });
    initStrategicMovementCosts(ctx);
    const g = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('C3'), 0, 2, 0);
    expect(findTravelTimeBetweenWaypoints(ctx, parseSectorString('C3'), parseSectorString('C7'), g)).toBe(4 * 89);
    expect(findTravelTimeBetweenWaypoints(ctx, parseSectorString('C3'), parseSectorString('F3'), g)).toBe(3 * 89);
    expect(findTravelTimeBetweenWaypoints(ctx, parseSectorString('F3'), parseSectorString('C3'), g)).toBe(3 * 89);
    g.next = parseSectorString('C4');
    g.betweenSectors = true;
    g.arrivalTime = Math.trunc(ctx.state.clock.seconds / 60) + 30;
    g.waypoints = [
      { x: 6, y: 3, z: 0 },
      { x: 6, y: 5, z: 0 },
    ];
    g.nextWaypointId = 1;
    expect(calculateTravelTimeOfGroup(ctx, g)).toBe(30 + 2 * 89 + 2 * 89);
  });

  it('counts an impossible edge as −1 minute like the original INT32 sum', () => {
    const ctx = testContext({ content: withMovementCosts(content, uniformMovementCosts(T.EDGEOFWORLD)) });
    initStrategicMovementCosts(ctx);
    const g = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('C3'), 0, 2, 0);
    expect(findTravelTimeBetweenWaypoints(ctx, parseSectorString('C3'), parseSectorString('C5'), g)).toBe(-2);
  });

  it('uses the encumbrance of player group members', () => {
    const mercs = new FakeMercs();
    const ctx = testContext({ content: withMovementCosts(content, uniformMovementCosts(T.ROAD)), mercs });
    initStrategicMovementCosts(ctx);
    mercs.add({ id: 3, sector: parseSectorString('C3'), encumbrance: 150 });
    const g = createNewPlayerGroupDepartingFromSector(ctx, parseSectorString('C3'));
    addPlayerToGroup(ctx, g, 3);
    expect(findTravelTimeBetweenWaypoints(ctx, parseSectorString('C3'), parseSectorString('C4'), g)).toBe(133);
  });
});
