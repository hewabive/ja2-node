import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyTileLayer, LAYER_NAMES, type MapDef, tileLayerFromLists } from '../formats/map.ts';
import { WORLD_MAX } from './grid.ts';
import { buildLevel, levelTilesAt } from './level.ts';
import { buildTileDatabase, TileFlags, type TileSurface } from './tile-database.ts';
import { parseTileTables, tileIndex, tileIndexFromTypeSubIndex, tileTypeOf, typeIndex } from './tile-tables.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));

function surface(type: number, frames: number): TileSurface {
  return {
    type,
    path: `tilesets/0/t${type}.sti`,
    frames: Array.from({ length: frames }, () => ({ offsetX: 0, offsetY: 0, width: 40 })),
    auxData: null,
    structures: null,
  };
}

describe('tile tables', () => {
  it('index the 151 tile types contiguously', () => {
    expect(tables.types.length).toBe(151);
    expect(tables.types.reduce((a, t) => a + t.count, 0)).toBe(tables.numberOfTiles);
    expect(tileIndex(tables, 'FIRSTWALL1')).toBe(tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'FIRSTWALL'), 1));
    expect(tileTypeOf(tables, tileIndex(tables, 'FIRSTDOORSH1'))).toBe(typeIndex(tables, 'FIRSTDOORSHADOW'));
    expect(tileTypeOf(tables, tables.numberOfTiles - 1)).toBe(150);
  });
});

describe('tile database', () => {
  const surfaces = tables.types.map((t) => surface(t.index, Math.max(1, t.count - 2)));
  const db = buildTileDatabase(tables, surfaces);

  it('has exactly one element per tile and marks underflow fillers', () => {
    expect(db.length).toBe(tables.numberOfTiles);
    const firstWall = tables.types[typeIndex(tables, 'FIRSTWALL')];
    const last = db[(firstWall?.start ?? 0) + (firstWall?.count ?? 0) - 1];
    expect((last?.flags ?? 0) & TileFlags.UNDERFLOW_FILLER).toBeTruthy();
    expect(db[firstWall?.start ?? 0]?.regionIndex).toBe(0);
  });

  it('sets flags from tile ranges like SetSpecificDatabaseValues', () => {
    const flags = (name: string) => db[tileIndex(tables, name)]?.flags ?? 0;
    expect(flags('FIRSTWALL1') & TileFlags.WALL).toBeTruthy();
    expect(flags('FIRSTWALL32') & TileFlags.AFRAME).toBeTruthy();
    expect(flags('FIRSTROOF1') & TileFlags.ROOF).toBeTruthy();
    expect(flags('FIRSTCLIFFHANG1') & (TileFlags.CLIFFHANG | TileFlags.IGNORE_WORLD_HEIGHT)).toBe(
      TileFlags.CLIFFHANG | TileFlags.IGNORE_WORLD_HEIGHT,
    );
    expect(flags('FIRSTFULLSTRUCT1') & TileFlags.FULL3D).toBeTruthy();
    expect(flags('FIRSTFULLSTRUCT2') & TileFlags.DYNAMIC).toBeTruthy();
    expect(flags('FIRSTOSTRUCT1') & TileFlags.HAS_SHADOW_BUDDY).toBeTruthy();
    expect(db[tileIndex(tables, 'FIRSTSHADOW1')]?.buddy).toBe(tileIndex(tables, 'FIRSTOSTRUCT1'));
    expect(db[tileIndex(tables, 'FIRSTDOOR1')]?.animationFrames?.length).toBe(5);
    expect(db[tileIndex(tables, 'FIRSTFLOOR1')]?.fullTile).toBe(1);
  });
});

describe('level', () => {
  const db = buildTileDatabase(
    tables,
    tables.types.map((t) => surface(t.index, t.count)),
  );
  const at = (g: number, entries: [number, number][]) => {
    const lists = Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[]);
    lists[g] = entries.map(([type, subIndex]) => ({ type, subIndex }));
    return tileLayerFromLists(lists);
  };
  const layers = Object.fromEntries(LAYER_NAMES.map((n) => [n, emptyTileLayer()])) as unknown as MapDef['layers'];
  const pointers = typeIndex(tables, 'FIRSTPOINTERS');
  const map = {
    minorVersion: 25,
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers: {
      ...layers,
      land: at(5, [
        [0, 1],
        [1, 2],
      ]),
      objects: at(6, [
        [pointers, 1],
        [40, 1],
      ]),
    },
  } as unknown as MapDef;

  it('puts land on the head of the list and drops cursor pointers from objects', () => {
    const level = buildLevel(map, tables, db);
    expect([...levelTilesAt(level.layers.land, 5)]).toEqual([
      tileIndexFromTypeSubIndex(tables, 1, 2),
      tileIndexFromTypeSubIndex(tables, 0, 1),
    ]);
    expect([...levelTilesAt(level.layers.objects, 6)]).toEqual([tileIndexFromTypeSubIndex(tables, 40, 1)]);
  });
});
