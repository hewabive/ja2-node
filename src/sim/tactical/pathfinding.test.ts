import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Orientation, type StructureDef } from '../../content/formats/jsd.ts';
import type { MapDoor } from '../../content/formats/map.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { parseDoorCostTable } from '../../content/world/movement-costs.ts';
import { RestrictedScroll } from '../../content/world/render-bounds.ts';
import { StructureFlags, type WorldStructures } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import {
  aiPathCostIndex,
  findBestPath,
  MAX_PATH_LIST_SIZE,
  NOWHERE,
  PathCopy,
  type PathEnv,
  PathFlags,
  type PathSoldier,
} from './pathfinding.ts';
import { Team } from './soldier.ts';

const doorCosts = parseDoorCostTable(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/door-costs.json'), 'utf8')));
const { NORTH, EAST, SOUTHEAST, SOUTH, WEST } = Direction;

function soldier(at: number, overrides: Partial<PathSoldier> = {}): PathSoldier {
  return {
    id: 1,
    team: Team.OUR,
    bodyType: 0,
    gridNo: at,
    level: 0,
    visible: 1,
    hasKeys: false,
    underAiControl: false,
    monsterOrAnimal: false,
    ...overrides,
  };
}

function env(place: (s: WorldStructures) => void = () => {}, people: PathSoldier[] = [], doors: MapDoor[] = []): PathEnv {
  const w = syntheticWorld(doorCosts, place);
  return {
    world: {
      costs: w.costs,
      terrain: w.terrain,
      heights: w.level.heights,
      structures: w.structures,
      mapDoors: new Map(doors.map((d) => [d.gridNo, d])),
    },
    restrictedScrollId: RestrictedScroll.NONE,
    whoIsThere: (g, level) => people.find((p) => p.gridNo === g && p.level === level) ?? null,
    doorStatus: () => null,
    showAllMercs: false,
    autoBandage: false,
  };
}

const START = gridNo(80, 80);

function walk(from: number, steps: readonly number[]): number {
  const inc = [-160, -159, 1, 161, 160, 159, -1, -161];
  return steps.reduce((g, d) => g + (inc[d] as number), from);
}

const DOOR_GRIDNO = gridNo(80, 79);
const AP_MOVEMENT_FLAT = 3;
const WALK_AP_COST = -1;
const DOOR_APS_OPEN = 3;
const AP_JUMPFENCE = 6;
const AP_CROUCH = 2;

function houseWithDoor(s: WorldStructures): void {
  for (let x = 70; x <= 90; x++) {
    const flags = x === 80 ? StructureFlags.DOOR | StructureFlags.OPENABLE : StructureFlags.WALL;
    s.add(gridNo(x, 79), 0, syntheticStructure(flags, Orientation.INSIDE_LEFT));
  }
}

function doorRecord(locked: boolean): MapDoor {
  return {
    gridNo: DOOR_GRIDNO,
    locked,
    trapLevel: 0,
    trapId: 0,
    lockId: 0,
    perceivedLocked: 0,
    perceivedTrapped: 0,
    lockDamage: 0,
  };
}

describe('findBestPath', () => {
  it('walks straight lines and diagonals', () => {
    const e = env();
    expect(findBestPath(e, soldier(START), gridNo(85, 80), 0).steps).toEqual([EAST, EAST, EAST, EAST, EAST]);
    expect(findBestPath(e, soldier(START), gridNo(83, 83), 0).steps).toEqual([SOUTHEAST, SOUTHEAST, SOUTHEAST]);
  });

  it('stops as soon as the destination heads the open list, even on a dearer path', () => {
    expect(findBestPath(env(), soldier(START), gridNo(82, 81), 0).steps).toEqual([SOUTHEAST, EAST]);
  });

  it('rejects the soldier tile, unreachable and off-map destinations', () => {
    const e = env();
    expect(findBestPath(e, soldier(START), START, 0).length).toBe(0);
    expect(findBestPath(e, soldier(START), gridNo(2, 2), 0).length).toBe(0);
    expect(findBestPath(e, soldier(START), gridNo(85, 80), 1).length).toBe(0);
  });

  it('goes around a wall and never crosses it', () => {
    const wall = (s: WorldStructures) => {
      for (let x = 75; x <= 85; x++) s.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT));
    };
    const r = findBestPath(env(wall), soldier(START), gridNo(80, 77), 0);
    expect(r.length).toBeGreaterThan(3);
    let g = START;
    for (const d of r.steps) {
      const next = walk(g, [d]);
      expect(Math.floor(next / 160) === 79 && Math.floor(g / 160) === 80 && next % 160 >= 75 && next % 160 <= 85).toBe(false);
      g = next;
    }
    expect(g).toBe(gridNo(80, 77));
  });

  it('paths around people unless told to path through them', () => {
    const blocker = soldier(gridNo(81, 80), { id: 2 });
    const e = env(() => {}, [blocker]);
    expect(findBestPath(e, soldier(START), gridNo(82, 80), 0).steps).not.toContain(undefined);
    expect(walk(START, findBestPath(e, soldier(START), gridNo(82, 80), 0).steps.slice(0, 1))).not.toBe(gridNo(81, 80));
    expect(findBestPath(e, soldier(START), gridNo(82, 80), 0, { flags: PathFlags.THROUGH_PEOPLE }).steps).toEqual([EAST, EAST]);
    expect(findBestPath(e, soldier(START), gridNo(81, 80), 0).length).toBe(0);
    expect(findBestPath(e, soldier(START, { team: Team.ENEMY }), gridNo(81, 80), 0).steps).toEqual([EAST]);
  });

  it("routes a player around soldiers he cannot see, yet lets him walk at an unseen soldier's tile", () => {
    const unseen = soldier(gridNo(81, 80), { id: 2, team: Team.ENEMY, visible: -1 });
    const e = env(() => {}, [unseen]);
    expect(walk(START, findBestPath(e, soldier(START), gridNo(82, 80), 0).steps.slice(0, 1))).not.toBe(unseen.gridNo);
    expect(findBestPath(e, soldier(START), unseen.gridNo, 0).steps).toEqual([EAST]);
  });

  it('hops fences for merc bodies only', () => {
    const fence = (s: WorldStructures) => {
      for (let x = 60; x <= 100; x++) s.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.FENCE, Orientation.OUTSIDE_LEFT));
    };
    const e = env(fence);
    expect(findBestPath(e, soldier(START), gridNo(80, 77), 0).steps).toEqual([NORTH, NORTH, NORTH]);
    const cow = findBestPath(e, soldier(START, { bodyType: 20 }), gridNo(80, 77), 0);
    expect(cow.steps.length).toBeGreaterThan(20);
  });

  it('keeps players out of closed doors while enemies open unlocked ones', () => {
    const behindDoor = gridNo(80, 78);
    const enemy = soldier(START, { team: Team.ENEMY });
    expect(findBestPath(env(houseWithDoor), soldier(START), behindDoor, 0).length).toBeGreaterThan(10);
    expect(findBestPath(env(houseWithDoor), enemy, behindDoor, 0).steps).toEqual([NORTH, NORTH]);
    const locked = env(houseWithDoor, [], [doorRecord(true)]);
    expect(findBestPath(locked, enemy, behindDoor, 0).length).toBeGreaterThan(10);
    expect(findBestPath(locked, { ...enemy, hasKeys: true }, behindDoor, 0).steps).toEqual([NORTH, NORTH]);
  });

  it('charges an AI budget for opening a closed door only when the map has a record of the door', () => {
    const enemy = soldier(START, { team: Team.ENEMY });
    const twoWalkingSteps = 2 * (AP_MOVEMENT_FLAT + WALK_AP_COST);
    const throughDoor = twoWalkingSteps + DOOR_APS_OPEN;
    const behindDoor = gridNo(80, 78);
    expect(findBestPath(env(houseWithDoor), enemy, behindDoor, 0, { budget: twoWalkingSteps }).steps).toEqual([NORTH, NORTH]);
    const recorded = env(houseWithDoor, [], [doorRecord(false)]);
    expect(findBestPath(recorded, enemy, behindDoor, 0, { budget: throughDoor - 1 }).length).toBe(0);
    expect(findBestPath(recorded, enemy, behindDoor, 0, { budget: throughDoor }).steps).toEqual([NORTH, NORTH]);
  });

  it('gives a walker one AP of an AI budget back when he lands on the free tile behind a fence', () => {
    const fence = (s: WorldStructures) => {
      for (let x = 60; x <= 100; x++) s.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.FENCE, Orientation.OUTSIDE_LEFT));
    };
    const flood = findBestPath(env(fence), soldier(START, { team: Team.ENEMY }), NOWHERE, 0, {
      copy: PathCopy.REACHABLE_AND_APS,
      budget: 20,
      distLimit: 5,
    });
    const apsTo = (x: number, y: number) => flood.apCosts?.[aiPathCostIndex(x - 80, y - 80)];
    const hop = AP_JUMPFENCE + WALK_AP_COST + AP_CROUCH;
    expect(apsTo(80, 79)).toBe(hop);
    expect(apsTo(80, 78)).toBe(hop - 1);
  });

  it('copies at most 30 steps into a route', () => {
    const r = findBestPath(env(), soldier(START), gridNo(80, 120), 0, { copy: PathCopy.ROUTE });
    expect(r.length).toBe(MAX_PATH_LIST_SIZE);
    expect(r.steps.every((d) => d === SOUTH)).toBe(true);
    expect(findBestPath(env(), soldier(START), gridNo(80, 120), 0).length).toBe(40);
  });

  it('respects a distance limit', () => {
    expect(findBestPath(env(), soldier(START), gridNo(90, 80), 0, { distLimit: 5 }).length).toBe(0);
    expect(findBestPath(env(), soldier(START), gridNo(84, 80), 0, { distLimit: 5 }).length).toBe(4);
  });
});

const DIRECTION_XY: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const DIRECTIONS = 8;
const CREATURE_ID = 52;

function shapeFacing(dir: number, offset: (dir: number) => readonly [number, number]): StructureDef {
  return syntheticStructure(StructureFlags.MOBILE, Orientation.NONE, { tiles: [[0, 0], offset(dir)] });
}

function multiTileEnv(e: PathEnv, facing: number, offset: (dir: number) => readonly [number, number]): PathEnv {
  const structures = Array.from({ length: DIRECTIONS }, (_, index) => shapeFacing((index + DIRECTIONS - 1) % DIRECTIONS, offset));
  return { ...e, multiTile: () => ({ structures, structureId: CREATURE_ID, continuousTurn: true, direction: facing }) };
}

const tail = (dir: number): readonly [number, number] => {
  const [dx, dy] = DIRECTION_XY[dir] ?? [0, 0];
  return [-dx, -dy];
};
const rightFlank = (dir: number): readonly [number, number] => DIRECTION_XY[(dir + 2) % DIRECTIONS] ?? [0, 0];

function corridor(fromX: number, toX: number, gapX: number | null = null): (s: WorldStructures) => void {
  return (s) => {
    for (let x = fromX; x <= toX; x++) {
      if (x !== gapX) s.add(gridNo(x, 79), 0, syntheticStructure(StructureFlags.GENERIC));
      s.add(gridNo(x, 81), 0, syntheticStructure(StructureFlags.GENERIC));
    }
  };
}

describe('findBestPath for multi-tile bodies', () => {
  const creature = soldier(START, { id: CREATURE_ID, team: Team.CREATURE, bodyType: 4, monsterOrAnimal: true });

  it('keeps a wide body out of a corridor a person walks through', () => {
    const plain = env(corridor(83, 87));
    const target = gridNo(90, 80);
    const inCorridor = (steps: readonly number[]) =>
      steps.some((_, k) => {
        const g = walk(START, steps.slice(0, k + 1));
        return g >= gridNo(83, 80) && g <= gridNo(87, 80);
      });
    const person = findBestPath(plain, soldier(START), target, 0);
    expect(person.steps).toEqual(Array.from({ length: 10 }, () => EAST));
    const route = findBestPath(multiTileEnv(plain, EAST, rightFlank), creature, target, 0);
    expect(route.length).toBeGreaterThan(0);
    expect(walk(START, route.steps)).toBe(target);
    expect(inCorridor(route.steps)).toBe(false);
  });

  it('cannot turn a long body inside a corridor and leaves it at an end', () => {
    const plain = env(corridor(75, 85, 80));
    const target = gridNo(80, 75);
    expect(findBestPath(plain, soldier(START), target, 0).steps).toEqual([NORTH, NORTH, NORTH, NORTH, NORTH]);
    const route = findBestPath(multiTileEnv(plain, EAST, tail), creature, target, 0);
    expect(route.length).toBeGreaterThan(5);
    expect(route.steps[0] === EAST || route.steps[0] === WEST).toBe(true);
  });
});
