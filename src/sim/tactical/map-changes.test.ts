import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { gridNo } from '../../content/world/grid.ts';
import { has, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { tileIndex } from '../../content/world/tile-tables.ts';
import { applyMapChanges, MapChangeKind, recordStructureDamaged, recordStructureRemoved, structTileChange } from './map-changes.ts';
import type { TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';
import { tileChangeViews } from './world-view.ts';

const A10 = 'stubs/world/maps/a10.dat';
const HOUSE_WALL = gridNo(69, 70);
const DAMAGED_HIT_POINTS = 3;
const OPEN_GROUND = gridNo(80, 75);

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

function sandbagTile(): number {
  return tileIndex(kit.world(A10).tables, 'SECONDOSTRUCT1');
}

function trapdoorTile(): number {
  return tileIndex(kit.world(A10).tables, 'DEBRIS2MISC1');
}

function basesAt(t: TacticalState, g: number): StructureInstance[] {
  return t.world.structures.at(g).filter((s) => has(s.flags, StructureFlags.BASE_TILE));
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

  it('appends a structure layer tile with its structure only while the tile is not in the layer yet, as IndexExistsInStructLayer guards AddStructToTail', () => {
    const t = freshA10();
    const append = structTileChange(MapChangeKind.APPEND_STRUCT_TILE, OPEN_GROUND, sandbagTile());
    applyMapChanges(t, [append, append]);
    expect(basesAt(t, OPEN_GROUND)).toHaveLength(1);
    expect(tileChangeViews(t)).toEqual([{ kind: 'append', gridNo: OPEN_GROUND, level: 0, tile: sandbagTile() }]);
    expect(t.mapChanges).toEqual([append, append]);
  });

  it('removes a structure layer tile with its structure, and appends a tile without a structure as a graphic alone', () => {
    const t = freshA10();
    applyMapChanges(t, [
      structTileChange(MapChangeKind.APPEND_STRUCT_TILE, OPEN_GROUND, sandbagTile()),
      structTileChange(MapChangeKind.REMOVE_STRUCT_TILE, OPEN_GROUND, sandbagTile()),
      structTileChange(MapChangeKind.APPEND_STRUCT_TILE, OPEN_GROUND, trapdoorTile()),
    ]);
    expect(basesAt(t, OPEN_GROUND)).toEqual([]);
    expect(tileChangeViews(t).map((c) => [c.kind, c.tile])).toEqual([
      ['append', sandbagTile()],
      ['remove', sandbagTile()],
      ['append', trapdoorTile()],
    ]);
  });

  it('removes nothing for a tile record whose tile is not in the structure layer', () => {
    const t = freshA10();
    applyMapChanges(t, [structTileChange(MapChangeKind.REMOVE_STRUCT_TILE, OPEN_GROUND, sandbagTile())]);
    expect(tileChangeViews(t)).toEqual([]);
  });
});
