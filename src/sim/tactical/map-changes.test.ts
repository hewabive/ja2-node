import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { gridNo } from '../../content/world/grid.ts';
import { has, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { applyMapChanges, recordStructureDamaged, recordStructureRemoved } from './map-changes.ts';
import type { TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

const A10 = 'stubs/world/maps/a10.dat';
const HOUSE_WALL = gridNo(69, 70);
const DAMAGED_HIT_POINTS = 3;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function freshA10(): TacticalState {
  return new TacticalSim(kit.world(A10), kit.content, 1).state;
}

function wallBase(t: TacticalState): StructureInstance | undefined {
  return t.world.structures.at(HOUSE_WALL).find((s) => has(s.flags, StructureFlags.BASE_TILE) && has(s.flags, StructureFlags.WALL));
}

describe('replaying the map changes of a sector', () => {
  it('takes a structure destroyed before the sector was left off the map again', () => {
    const left = freshA10();
    const wall = wallBase(left);
    if (!wall) throw new Error('no wall');
    recordStructureRemoved(left, wall);
    left.world.structures.remove(wall);
    const entered = freshA10();
    applyMapChanges(entered, left.mapChanges);
    expect(wallBase(entered)).toBeUndefined();
  });

  it('gives a structure damaged before the sector was left its hit points again', () => {
    const left = freshA10();
    const wall = wallBase(left);
    if (!wall) throw new Error('no wall');
    wall.hitPoints = DAMAGED_HIT_POINTS;
    recordStructureDamaged(left, wall);
    const entered = freshA10();
    applyMapChanges(entered, left.mapChanges);
    expect(wallBase(entered)?.hitPoints).toBe(DAMAGED_HIT_POINTS);
  });
});
