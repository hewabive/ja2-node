import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { MapModificationType, type SavedMapModification } from '../../content/formats/savegame-temp-files.ts';
import { gridNo } from '../../content/world/grid.ts';
import { has, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import { tileIndex, typeIndex } from '../../content/world/tile-tables.ts';
import { applyMapChanges, MapChangeKind, sectorTempFileChanges } from './map-changes.ts';
import { loadSavedSectorChanges, NO_SAVED_SECTOR_CHANGES } from './save-import.ts';
import type { TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

const TOWN = 'stubs/world/maps/town.dat';
const WALL_CORNER = 8715;
const TOWN_WINDOW = 7912;
const OPEN_GROUND = gridNo(80, 75);
const WALL_TYPE = 16;
const NORMAL_ROOF_TYPE = 24;
const SWITCH_TYPE = 27;
const SAVED_LEVEL_BIT = 0x80;
const SAVED_HIT_POINTS = 3;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function town(): TacticalSim {
  return new TacticalSim(kit.world(TOWN), kit.content, 1);
}

function loadMapChanges(sim: TacticalSim, mapModifications: readonly SavedMapModification[]): boolean {
  return loadSavedSectorChanges(sim, { ...NO_SAVED_SECTOR_CHANGES, mapModifications });
}

function damaged(gridNo: number, type: number, extra: number): SavedMapModification {
  return { type: MapModificationType.DAMAGED_STRUCT, gridNo, imageType: type, subImageIndex: SAVED_HIT_POINTS, extra };
}

function windowHit(gridNo: number): SavedMapModification {
  return { type: MapModificationType.WINDOW_HIT, gridNo, imageType: 0, subImageIndex: 0, extra: 0 };
}

function structuresAt(t: TacticalState, g: number): readonly StructureInstance[] {
  return t.world.structures.at(g);
}

function hitPoints(t: TacticalState, g: number): number[] {
  return structuresAt(t, g).map((s) => s.hitPoints);
}

function switchPiece(t: TacticalState, at: number, tiles: readonly (readonly [number, number])[] = [[0, 0]]): StructureInstance {
  const added = t.world.structures.add(at, 0, syntheticStructure(StructureFlags.SWITCH, Orientation.NONE, { tiles }));
  if (!added) throw new Error('no switch');
  return added;
}

function windowAt(t: TacticalState): StructureInstance {
  const w = t.world.structures.find(TOWN_WINDOW, StructureFlags.WALLNWINDOW);
  if (!w) throw new Error('no window');
  return w;
}

describe('the damage records of a native save (SaveLoadMap.cc DamageStructsFromMapTempFile, Structure.cc FindStructureBySavedInfo)', () => {
  it('gives the saved hit points to the structure of the tile with the saved type bit and wall orientation, and keeps them for the next exit', () => {
    const sim = town();
    const t = sim.state;
    const [left, right] = structuresAt(t, WALL_CORNER);
    expect([left?.wallOrientation, right?.wallOrientation]).toEqual([Orientation.OUTSIDE_LEFT, Orientation.OUTSIDE_RIGHT]);
    loadMapChanges(sim, [damaged(WALL_CORNER, WALL_TYPE, Orientation.OUTSIDE_RIGHT)]);
    expect([left?.hitPoints, right?.hitPoints]).toEqual([left?.def.hitPoints, SAVED_HIT_POINTS]);
    const entered = town();
    applyMapChanges(entered.state, sectorTempFileChanges(t.mapChanges));
    expect(hitPoints(entered.state, WALL_CORNER)).toEqual(hitPoints(t, WALL_CORNER));
  });

  it('reads the level from bit 7 of the extra byte: set, the record damages the roof over the tile; clear, it finds no roof on the ground', () => {
    const sim = town();
    const t = sim.state;
    const roof = structuresAt(t, WALL_CORNER).find((s) => has(s.flags, StructureFlags.NORMAL_ROOF));
    if (!roof) throw new Error('no roof');
    const intact = hitPoints(t, WALL_CORNER);
    loadMapChanges(sim, [damaged(WALL_CORNER, NORMAL_ROOF_TYPE, Orientation.NONE)]);
    expect(hitPoints(t, WALL_CORNER)).toEqual(intact);
    loadMapChanges(sim, [damaged(WALL_CORNER, NORMAL_ROOF_TYPE, Orientation.NONE | SAVED_LEVEL_BIT)]);
    expect(roof.hitPoints).toBe(SAVED_HIT_POINTS);
  });

  it('damages the first of two structures that match, in the order the tile lists them', () => {
    const sim = town();
    const t = sim.state;
    const first = switchPiece(t, OPEN_GROUND);
    const second = switchPiece(t, OPEN_GROUND);
    loadMapChanges(sim, [damaged(OPEN_GROUND, SWITCH_TYPE, Orientation.NONE)]);
    expect([first.hitPoints, second.hitPoints]).toEqual([SAVED_HIT_POINTS, second.def.hitPoints]);
  });

  it('applies no damage record on a tile without a base tile, even where a piece of a larger structure matches', () => {
    const sim = town();
    const t = sim.state;
    switchPiece(t, OPEN_GROUND - 1, [
      [0, 0],
      [1, 0],
    ]);
    loadMapChanges(sim, [damaged(OPEN_GROUND, SWITCH_TYPE, Orientation.NONE)]);
    expect(hitPoints(t, OPEN_GROUND)).toEqual([0]);
    expect(t.mapChanges).toEqual([]);
  });

  it('lets a damage record land on the piece of another structure the tile lists first, which the next exit does not keep: the save after the load rescans base tiles only (SaveLoadMap.cc:344)', () => {
    const sim = town();
    const t = sim.state;
    switchPiece(t, OPEN_GROUND - 1, [
      [0, 0],
      [1, 0],
    ]);
    const base = switchPiece(t, OPEN_GROUND);
    loadMapChanges(sim, [damaged(OPEN_GROUND, SWITCH_TYPE, Orientation.NONE)]);
    expect(hitPoints(t, OPEN_GROUND)).toEqual([SAVED_HIT_POINTS, base.def.hitPoints]);
    expect(t.mapChanges).toEqual([]);
  });
});

describe('the window hits of a native save (SaveLoadMap.cc ModifyWindowStatus)', () => {
  it("swaps the tile's window for its partner and keeps the swap for the next exit", () => {
    const sim = town();
    const t = sim.state;
    const intact = windowAt(t).def;
    expect(loadMapChanges(sim, [windowHit(TOWN_WINDOW)])).toBe(true);
    expect(windowAt(t).def.number).toBe(intact.number + intact.partnerDelta);
    expect(t.mapChanges.map((c) => [c.kind, c.gridNo, c.partnerSwap === true])).toEqual([
      [MapChangeKind.REMOVE, TOWN_WINDOW, false],
      [MapChangeKind.ADD, TOWN_WINDOW, true],
    ]);
    const entered = town();
    applyMapChanges(entered.state, sectorTempFileChanges(t.mapChanges));
    expect(windowAt(entered.state).def).toBe(windowAt(t).def);
  });

  it('writes a record back only when it finds a window: a hit on a tile without one changes nothing and keeps nothing', () => {
    const sim = town();
    expect(loadMapChanges(sim, [windowHit(OPEN_GROUND)])).toBe(false);
    expect(sim.state.mapChanges).toEqual([]);
  });
});

describe('the map modifications file of the loaded sector after a native load (SaveLoadMap.cc:236)', () => {
  it('stays when a record is written back and goes when none is: damage, blood and openable records are rescanned at the next save instead', () => {
    const tables = kit.world(TOWN).tables;
    const sandbag = tileIndex(tables, 'SECONDOSTRUCT1');
    const struct = {
      type: MapModificationType.STRUCT,
      gridNo: OPEN_GROUND,
      imageType: typeIndex(tables, 'SECONDOSTRUCT'),
      subImageIndex: sandbag - (tables.types[typeIndex(tables, 'SECONDOSTRUCT')]?.start ?? 0) + 1,
      extra: 0,
    };
    const blood = { type: MapModificationType.BLOOD_SMELL, gridNo: OPEN_GROUND, imageType: 1, subImageIndex: 0, extra: 0 };
    const openable = { type: MapModificationType.OPENABLE_STRUCT, gridNo: OPEN_GROUND, imageType: 1, subImageIndex: 0, extra: 0 };
    const rescanned = [blood, openable, damaged(WALL_CORNER, WALL_TYPE, Orientation.OUTSIDE_RIGHT)];
    expect(loadMapChanges(town(), rescanned)).toBe(false);
    expect(loadMapChanges(town(), [...rescanned, struct])).toBe(true);
    expect(loadMapChanges(town(), [...rescanned, windowHit(TOWN_WINDOW)])).toBe(true);
    expect(loadSavedSectorChanges(town(), NO_SAVED_SECTOR_CHANGES)).toBe(true);
  });
});
