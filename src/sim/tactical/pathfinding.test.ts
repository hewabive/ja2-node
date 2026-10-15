import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Orientation } from '../../content/formats/jsd.ts';
import type { MapDoor } from '../../content/formats/map.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { parseDoorCostTable } from '../../content/world/movement-costs.ts';
import { StructureFlags, type WorldStructures } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import { findBestPath, MAX_PATH_LIST_SIZE, PathCopy, type PathEnv, PathFlags, type PathSoldier } from './pathfinding.ts';
import { Team } from './soldier.ts';

const doorCosts = parseDoorCostTable(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/door-costs.json'), 'utf8')));
const { NORTH, EAST, SOUTHEAST, SOUTH } = Direction;

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
    const house = (s: WorldStructures) => {
      for (let x = 70; x <= 90; x++) {
        const flags = x === 80 ? StructureFlags.DOOR | StructureFlags.OPENABLE : StructureFlags.WALL;
        s.add(gridNo(x, 79), 0, syntheticStructure(flags, Orientation.INSIDE_LEFT));
      }
    };
    const door: MapDoor = { gridNo: gridNo(80, 79), locked: true, trapLevel: 0, trapId: 0, lockId: 0, lockDamage: 0 };
    const player = findBestPath(env(house), soldier(START), gridNo(80, 78), 0);
    expect(player.length).toBeGreaterThan(10);
    expect(findBestPath(env(house), soldier(START, { team: Team.ENEMY }), gridNo(80, 78), 0).steps).toEqual([NORTH, NORTH]);
    expect(findBestPath(env(house, [], [door]), soldier(START, { team: Team.ENEMY }), gridNo(80, 78), 0).length).toBeGreaterThan(10);
    expect(findBestPath(env(house, [], [door]), soldier(START, { team: Team.ENEMY, hasKeys: true }), gridNo(80, 78), 0).steps).toEqual([
      NORTH,
      NORTH,
    ]);
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
