import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Orientation } from '../formats/jsd.ts';
import type { MapInformation } from '../formats/map.ts';
import { Direction, gridNo, WORLD_COLS } from './grid.ts';
import {
  compileWorldMovementCosts,
  type MovementWorld,
  parseDoorCostTable,
  recompileLocalMovementCosts,
  TravelCost,
} from './movement-costs.ts';
import { RestrictedScroll } from './render-bounds.ts';
import { StructureFlags, type WorldStructures } from './structures.ts';
import { syntheticStructure, syntheticWorld } from './synthetic.ts';

const doorCosts = parseDoorCostTable(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/door-costs.json'), 'utf8')));
const { NORTH, NORTHEAST, EAST, SOUTHEAST, SOUTH, SOUTHWEST, WEST, NORTHWEST } = Direction;

function world(place: (s: WorldStructures) => void, roofs: ReadonlySet<number> = new Set()): MovementWorld {
  return syntheticWorld(doorCosts, place, roofs);
}

function mapInfo(restrictedScrollId: number): MapInformation {
  return {
    northGridNo: -1,
    eastGridNo: -1,
    southGridNo: -1,
    westGridNo: -1,
    numIndividuals: 0,
    mapVersion: 0,
    restrictedScrollId,
    editorSmoothingType: 0,
    centerGridNo: -1,
    isolatedGridNo: -1,
  };
}

const def = syntheticStructure;
const G = gridNo(80, 80);
const N = -WORLD_COLS;
const S = WORLD_COLS;
const FENCE = StructureFlags.FENCE;
const SANDBAG = 18;

describe('movement costs', () => {
  it('marks tiles outside the visible diamond off-map on both levels', () => {
    const costs = compileWorldMovementCosts(world(() => {}));
    expect(costs.get(gridNo(2, 2), NORTH, 0)).toBe(TravelCost.OFF_MAP);
    expect(costs.get(gridNo(2, 2), SOUTH, 1)).toBe(TravelCost.OFF_MAP);
    expect(costs.get(G, EAST, 0)).toBe(TravelCost.FLAT);
    expect(costs.get(G, EAST, 1)).toBe(TravelCost.OBSTACLE);
  });

  it('marks the tiles outside the smaller visible area of a basement off-map', () => {
    const outsideBasement = gridNo(112, 80);
    const surface = compileWorldMovementCosts({ ...world(() => {}), map: { info: mapInfo(RestrictedScroll.NONE) } });
    expect(surface.get(outsideBasement, EAST, 0)).toBe(TravelCost.FLAT);
    const basement = compileWorldMovementCosts({ ...world(() => {}), map: { info: mapInfo(RestrictedScroll.BASEMENT) } });
    expect(basement.get(outsideBasement, EAST, 0)).toBe(TravelCost.OFF_MAP);
    expect(basement.get(outsideBasement, EAST, 1)).toBe(TravelCost.OFF_MAP);
    expect(basement.get(G, EAST, 0)).toBe(TravelCost.FLAT);
  });

  it('makes roofs walkable on level 1', () => {
    const costs = compileWorldMovementCosts(world(() => {}, new Set([G])));
    expect(costs.get(G, WEST, 1)).toBe(TravelCost.FLAT);
  });

  it('lands north of a north-south fence for free but pays terrain south of it', () => {
    const costs = compileWorldMovementCosts(world((s) => s.add(G, 0, def(FENCE, Orientation.OUTSIDE_LEFT))));
    expect([NORTH, SOUTH].map((d) => costs.get(G, d, 0))).toEqual([TravelCost.FENCE, TravelCost.FENCE]);
    expect([NORTHEAST, EAST, SOUTHEAST, SOUTHWEST, WEST, NORTHWEST].every((d) => costs.get(G, d, 0) === TravelCost.OBSTACLE)).toBe(true);
    expect(costs.get(G + N, NORTH, 0)).toBe(TravelCost.NONE);
    expect(costs.get(G + S, SOUTH, 0)).toBe(TravelCost.FLAT);
    expect(costs.get(G + 1, EAST, 0)).toBe(TravelCost.OBSTACLE);
    expect(costs.get(G + 1, NORTH, 0)).toBe(TravelCost.FLAT);
  });

  it('lands west of an east-west fence for free but pays terrain east of it', () => {
    const costs = compileWorldMovementCosts(world((s) => s.add(G, 0, def(FENCE, Orientation.OUTSIDE_RIGHT))));
    expect([EAST, WEST].map((d) => costs.get(G, d, 0))).toEqual([TravelCost.FENCE, TravelCost.FENCE]);
    expect(costs.get(G - 1, WEST, 0)).toBe(TravelCost.NONE);
    expect(costs.get(G + 1, EAST, 0)).toBe(TravelCost.FLAT);
    expect(costs.get(G + N, NORTH, 0)).toBe(TravelCost.OBSTACLE);
  });

  it('lets low sandbags be hopped only across lines without neighbouring obstacles', () => {
    const lone = compileWorldMovementCosts(world((s) => s.add(G, 0, def(StructureFlags.GENERIC, 0, { armour: SANDBAG, height: 1 }))));
    expect([NORTH, EAST, SOUTH, WEST].map((d) => lone.get(G, d, 0))).toEqual(Array(4).fill(TravelCost.FENCE));
    expect(lone.get(G, NORTHEAST, 0)).toBe(TravelCost.OBSTACLE);
    const row = compileWorldMovementCosts(
      world((s) => {
        s.add(G, 0, def(StructureFlags.GENERIC, 0, { armour: SANDBAG, height: 1 }));
        s.add(G + 1, 0, def(StructureFlags.GENERIC, 0, { armour: SANDBAG, height: 1 }));
      }),
    );
    expect([NORTH, SOUTH].map((d) => row.get(G, d, 0))).toEqual([TravelCost.FENCE, TravelCost.FENCE]);
    expect([EAST, WEST].map((d) => row.get(G, d, 0))).toEqual([TravelCost.OBSTACLE, TravelCost.OBSTACLE]);
    const tall = compileWorldMovementCosts(world((s) => s.add(G, 0, def(StructureFlags.GENERIC, 0, { armour: SANDBAG, height: 2 }))));
    expect(tall.get(G, NORTH, 0)).toBe(TravelCost.OBSTACLE);
  });

  it('blocks every move crossing a wall edge', () => {
    const left = compileWorldMovementCosts(world((s) => s.add(G, 0, def(StructureFlags.WALL, Orientation.OUTSIDE_LEFT))));
    expect([NORTHEAST, NORTH, NORTHWEST].map((d) => left.get(G, d, 0))).toEqual(Array(3).fill(TravelCost.WALL));
    expect([SOUTHEAST, SOUTH, SOUTHWEST].map((d) => left.get(G + S, d, 0))).toEqual(Array(3).fill(TravelCost.WALL));
    expect(left.get(G - 1, NORTHWEST, 0)).toBe(TravelCost.WALL);
    expect(left.get(G + 1, NORTHEAST, 0)).toBe(TravelCost.WALL);
    expect(left.get(G, EAST, 0)).toBe(TravelCost.FLAT);
    const right = compileWorldMovementCosts(world((s) => s.add(G, 0, def(StructureFlags.WALL, Orientation.INSIDE_RIGHT))));
    expect([SOUTHWEST, WEST, NORTHWEST].map((d) => right.get(G, d, 0))).toEqual(Array(3).fill(TravelCost.WALL));
    expect([SOUTHEAST, EAST, NORTHEAST].map((d) => right.get(G + 1, d, 0))).toEqual(Array(3).fill(TravelCost.WALL));
    expect(right.get(G, NORTH, 0)).toBe(TravelCost.FLAT);
  });

  it('writes door frame and swing codes for a standard outside-left door', () => {
    const door = StructureFlags.DOOR | StructureFlags.OPENABLE;
    const costs = compileWorldMovementCosts(
      world((s) =>
        s.add(
          G,
          0,
          def(door, Orientation.OUTSIDE_LEFT, {
            tiles: [
              [0, 0],
              [-1, 0],
            ],
          }),
        ),
      ),
    );
    expect(costs.get(G, NORTH, 0)).toBe(TravelCost.DOOR_CLOSED_HERE);
    expect(costs.get(G, NORTHEAST, 0)).toBe(TravelCost.WALL);
    expect(costs.get(G + S, SOUTH, 0)).toBe(TravelCost.DOOR_CLOSED_N);
    expect(costs.get(G - 1, EAST, 0)).toBe(224);
    expect(costs.get(G - 2, WEST, 0)).toBe(225);
  });

  it('recompiles a neighbourhood to the same values after a change is undone', () => {
    const w = world((s) => s.add(G, 0, def(FENCE, Orientation.OUTSIDE_LEFT)));
    const costs = compileWorldMovementCosts(w);
    const before = costs.values.slice();
    recompileLocalMovementCosts(costs, w, G);
    expect(costs.values).toEqual(before);
  });
});
