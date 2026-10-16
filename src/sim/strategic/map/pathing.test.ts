import { beforeAll, describe, expect, it } from 'vitest';
import { loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import { TransportMask } from '../../../content/strategic/policy.ts';
import {
  parseSectorId,
  parseSectorString,
  sectorFromId,
  sectorFromStrategicIndex,
  sectorShortString,
  strategicIndex,
} from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Direction } from '../../../content/world/grid.ts';
import { createNewEnemyGroupDepartingFromSector, createNewPlayerGroupDepartingFromSector } from '../forces/groups.ts';
import { buildAStrategicPath, rebuildWayPointsForGroupPath } from '../forces/movement.ts';
import { initStrategicLayerMap } from './init.ts';
import {
  appendStrategicPath,
  buildStrategicPath,
  clearStrategicPathAfterSector,
  findStratPath,
  MAX_PATH_LIST_SIZE,
  type StratPathRules,
} from './pathing.ts';
import { Traversability } from './sectors.ts';
import { calculateTravelTimeOfGroup, TRAVERSE_TIME_IMPOSSIBLE } from './travel.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const at = (x: number, y: number) => strategicIndex({ x, y });
const uniform = (cost: number): StratPathRules => ({ edgeCost: () => cost });
const idOf = (x: number, y: number) => (y - 1) * 16 + x - 1;
const names = (path: readonly number[] | null) => (path ?? []).map((i) => sectorShortString(sectorFromStrategicIndex(i)));

describe('FindStratPath on synthetic costs', () => {
  it('prefers the quickest route over the shortest one', () => {
    const expensiveRow = (from: number, move: number) => (move === StrategicMove.EAST && sectorFromId(from).y === 2 ? 100 : 10);
    expect(findStratPath(at(2, 2), at(4, 2), { edgeCost: expensiveRow })).toEqual([
      Direction.SOUTH,
      Direction.EAST,
      Direction.EAST,
      Direction.NORTH,
    ]);
  });

  it('breaks equal totals by insertion order (south before east on a uniform grid)', () => {
    expect(findStratPath(at(2, 2), at(3, 3), uniform(10))).toEqual([Direction.SOUTH, Direction.EAST]);
    expect(findStratPath(at(5, 5), at(3, 3), uniform(10))).toEqual([Direction.WEST, Direction.WEST, Direction.NORTH, Direction.NORTH]);
  });

  it('skips impossible edges and returns nothing for an unreachable or identical destination', () => {
    expect(findStratPath(at(2, 2), at(4, 2), uniform(TRAVERSE_TIME_IMPOSSIBLE))).toEqual([]);
    expect(findStratPath(at(2, 2), at(2, 2), uniform(10))).toEqual([]);
  });

  it('forces the first step of a tactical traversal unless it crosses a ground barrier', () => {
    const slowDirect = (from: number, move: number) => (from === idOf(2, 2) && move === StrategicMove.EAST ? 500 : 10);
    const rules = { edgeCost: slowDirect, traversability: () => Traversability.PLAINS, groundBarrier: Traversability.GROUNDBARRIER };
    expect(findStratPath(at(2, 2), at(3, 2), rules)).toHaveLength(3);
    expect(findStratPath(at(2, 2), at(3, 2), { ...rules, tacticalTraversal: true })).toEqual([Direction.EAST]);
    const barrier = { ...rules, tacticalTraversal: true, traversability: () => Traversability.GROUNDBARRIER };
    expect(findStratPath(at(2, 2), at(3, 2), barrier)).toHaveLength(3);
  });

  it('flattens every edge to 60 minutes in direct mode, overriding the helicopter costs', () => {
    const slowDirect = (from: number, move: number) => (from === idOf(2, 2) && move === StrategicMove.EAST ? 500 : 10);
    expect(findStratPath(at(2, 2), at(4, 2), { edgeCost: slowDirect, direct: true, flatTravelTime: 60 })).toEqual([
      Direction.EAST,
      Direction.EAST,
    ]);
    const heli = { edgeCost: () => 10, helicopterCost: (from: number) => (from === at(3, 2) ? 1000 : 100) };
    expect(findStratPath(at(2, 2), at(4, 2), heli)).toHaveLength(4);
    expect(findStratPath(at(2, 2), at(4, 2), { ...heli, direct: true, flatTravelTime: 60 })).toEqual([Direction.EAST, Direction.EAST]);
  });

  it('keeps only the first 30 directions of a longer route', () => {
    const serpentine = (from: number, move: number) => {
      const { x, y } = sectorFromId(from);
      const east = y % 2 === 1;
      if (move === StrategicMove.EAST && east && x < 16) return 10;
      if (move === StrategicMove.WEST && !east && x > 1) return 10;
      if (move === StrategicMove.SOUTH && x === (east ? 16 : 1)) return 10;
      return TRAVERSE_TIME_IMPOSSIBLE;
    };
    const directions = findStratPath(at(1, 1), at(1, 3), { edgeCost: serpentine });
    expect(directions).toHaveLength(MAX_PATH_LIST_SIZE);
    const path = buildStrategicPath(at(1, 1), at(1, 3), { edgeCost: serpentine });
    expect(path).toHaveLength(MAX_PATH_LIST_SIZE + 1);
    expect(path?.at(-1)).not.toBe(at(1, 3));
  });

  it('builds the node list from the start and refuses destinations in the top border row', () => {
    expect(buildStrategicPath(at(2, 2), at(3, 3), uniform(10))).toEqual([at(2, 2), at(2, 3), at(3, 3)]);
    expect(buildStrategicPath(at(2, 2), 16, uniform(10))).toBeNull();
  });
});

describe('path list helpers', () => {
  it('appends without repeating the joint and cuts after the last occurrence', () => {
    expect(appendStrategicPath([5, 6], [3, 4, 5])).toEqual([3, 4, 5, 6]);
    expect(appendStrategicPath([7, 8], [3, 4])).toEqual([3, 4, 7, 8]);
    expect(appendStrategicPath(null, [3])).toEqual([3]);
    expect(clearStrategicPathAfterSector([1, 2, 3, 2, 4], 2)).toEqual([1, 2, 3, 2]);
    expect(clearStrategicPathAfterSector([1, 2, 3], 9)).toEqual([1, 2, 3]);
  });
});

describe('routes on the shipped movement costs (matches the oracle)', () => {
  const ROUTES: readonly (readonly [number, string, number, string])[] = [
    [TransportMask.FOOT, 'F9 F8 H8 H7 I7 I6 M6 M5 N5 N3 P3', 1326, 'A9 B9 C9 D9 E9 F9 F8 G8 H8 H7 I7 I6 J6 K6 L6 M6 M5 N5 N4 N3 O3 P3'],
    [TransportMask.CAR, 'F9 F8 G8 G6 M6 M5 N5 N3 P3', 480, 'A9 B9 C9 D9 E9 F9 F8 G8 G7 G6 H6 I6 J6 K6 L6 M6 M5 N5 N4 N3 O3 P3'],
    [TransportMask.TRUCK, 'F9 F8 G8 G6 M6 M5 N5 N3 P3', 510, 'A9 B9 C9 D9 E9 F9 F8 G8 G7 G6 H6 I6 J6 K6 L6 M6 M5 N5 N4 N3 O3 P3'],
    [TransportMask.TRACKED, 'F9 F8 H8 H7 I7 I6 N6 N3 P3', 679, 'A9 B9 C9 D9 E9 F9 F8 G8 H8 H7 I7 I6 J6 K6 L6 M6 N6 N5 N4 N3 O3 P3'],
    [TransportMask.AIR, 'A6 B6 B5 N5 N4 O4 O3 P3', 210, 'A9 A8 A7 A6 B6 B5 C5 D5 E5 F5 G5 H5 I5 J5 K5 L5 M5 N5 N4 O4 O3 P3'],
  ];

  for (const [mask, waypoints, eta, route] of ROUTES) {
    it(`plans A9→P3 with transport mask ${mask}`, () => {
      const ctx = testContext({ content });
      initStrategicLayerMap(ctx);
      const g = createNewPlayerGroupDepartingFromSector(ctx, parseSectorString('A9'));
      g.transportMask = mask;
      const path = buildAStrategicPath(ctx, strategicIndex(parseSectorString('A9')), strategicIndex(parseSectorString('P3')), g);
      expect(names(path).join(' ')).toBe(route);
      rebuildWayPointsForGroupPath(ctx, path, g);
      expect(g.waypoints.map((w) => sectorShortString(w)).join(' ')).toBe(waypoints);
      expect(calculateTravelTimeOfGroup(ctx, g)).toBe(eta);
    });
  }

  it('finds no route out of an edge-of-world corner', () => {
    const ctx = testContext({ content });
    initStrategicLayerMap(ctx);
    const g = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('A1'), 0, 1, 0);
    expect(buildAStrategicPath(ctx, strategicIndex(parseSectorString('A1')), strategicIndex(parseSectorString('P16')), g)).toBeNull();
  });
});
