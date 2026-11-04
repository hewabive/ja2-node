import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { MapModificationType } from '../../content/formats/savegame-temp-files.ts';
import { gridNo } from '../../content/world/grid.ts';
import { has, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { tileIndex, typeIndex } from '../../content/world/tile-tables.ts';
import {
  addStructTileToHead,
  addStructTileToTail,
  applyMapChanges,
  MapChangeKind,
  objectLayerAt,
  recordStructureDamaged,
  recordStructureRemoved,
  structLayerAt,
  structTileChange,
} from './map-changes.ts';
import { loadSavedSectorChanges } from './save-import.ts';
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

  it('re-adds a structure the stay put at the head of its tile at the tail, as AddStructToTail does for every stored structure (SaveLoadMap.cc:123)', () => {
    const left = freshA10();
    addStructTileToTail(left, OPEN_GROUND, trapdoorTile());
    addStructTileToHead(left, OPEN_GROUND, sandbagTile());
    expect(structLayerAt(left, OPEN_GROUND)).toEqual([sandbagTile(), trapdoorTile()]);
    expect(tileChangeViews(left).map((c) => c.kind)).toEqual(['append', 'add']);
    const entered = freshA10();
    applyMapChanges(entered, left.mapChanges);
    expect(structLayerAt(entered, OPEN_GROUND)).toEqual([trapdoorTile(), sandbagTile()]);
    expect(tileChangeViews(entered).map((c) => [c.kind, c.tile])).toEqual([
      ['append', trapdoorTile()],
      ['append', sandbagTile()],
    ]);
    expect(basesAt(entered, OPEN_GROUND)).toHaveLength(1);
  });

  it('finds a re-added structure for the damage recorded after it was added', () => {
    const left = freshA10();
    addStructTileToHead(left, OPEN_GROUND, sandbagTile());
    const sandbag = basesAt(left, OPEN_GROUND)[0];
    if (!sandbag) throw new Error('no sandbag');
    sandbag.hitPoints = DAMAGED_HIT_POINTS;
    recordStructureDamaged(left, sandbag);
    const entered = freshA10();
    applyMapChanges(entered, left.mapChanges);
    expect(basesAt(entered, OPEN_GROUND).map((s) => s.hitPoints)).toEqual([DAMAGED_HIT_POINTS]);
  });

  it('removes nothing for a tile record whose tile is not in the structure layer', () => {
    const t = freshA10();
    applyMapChanges(t, [structTileChange(MapChangeKind.REMOVE_STRUCT_TILE, OPEN_GROUND, sandbagTile())]);
    expect(tileChangeViews(t)).toEqual([]);
  });
});

describe('the map changes of a native save', () => {
  it('adds a saved object record at the head of the object layer, as AddObjectFromMapTempFileToMap does (SaveLoadMap.cc:105)', () => {
    const sim = new TacticalSim(kit.world(A10), kit.content, 1);
    const tables = kit.world(A10).tables;
    const debris = { type: MapModificationType.OBJECT, gridNo: OPEN_GROUND, imageType: typeIndex(tables, 'FIRSTEXPLDEBRIS'), extra: 0 };
    loadSavedSectorChanges(sim, {
      mapModifications: [
        { ...debris, subImageIndex: 3 },
        { ...debris, subImageIndex: 5 },
      ],
      revealed: null,
      doorStatus: null,
    });
    const tiles = [tileIndex(tables, 'FIRSTEXPLDEBRIS3'), tileIndex(tables, 'FIRSTEXPLDEBRIS5')];
    expect(objectLayerAt(sim.state, OPEN_GROUND)).toEqual([tiles[1], tiles[0]]);
    expect(tileChangeViews(sim.state)).toEqual(tiles.map((tile) => ({ kind: 'object', gridNo: OPEN_GROUND, level: 0, tile })));
  });
});
