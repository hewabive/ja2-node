// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/TileDef.h, TileDef.cc gTileTypeMovementCost; WorldDat.cc SetTileset*TerrainValues;
// @src src/game/TileEngine/TileDat.cc SetSpecificDatabaseValues (shore pieces)

import { type TileTables, tileIndex, typeIndex } from './tile-tables.ts';

export const Terrain = {
  NONE: 0,
  FLAT_GROUND: 1,
  FLAT_FLOOR: 2,
  PAVED_ROAD: 3,
  DIRT_ROAD: 4,
  LOW_GRASS: 5,
  HIGH_GRASS: 6,
  TRAIN_TRACKS: 7,
  LOW_WATER: 8,
  MED_WATER: 9,
  DEEP_WATER: 10,
} as const;

export const TERRAIN_MOVEMENT_COST: readonly number[] = [10, 10, 10, 9, 9, 10, 10, 30, 30, 30, 30];

export const Tileset = {
  CAVES_1: 1,
  TROPICAL_1: 4,
  OMERTA_1: 9,
  AIRSTRIP: 17,
  DEAD_AIRSTRIP: 19,
  TEMP_14: 33,
  TEMP_18: 37,
  TEMP_19: 38,
  TEMP_20: 39,
  TEMP_26: 45,
  TEMP_27: 46,
  TEMP_28: 47,
  TEMP_29: 48,
} as const;

type TerrainFunction = 'one' | 'two' | 'three' | 'four';

const FUNCTION_BY_TILESET: ReadonlyMap<number, TerrainFunction> = new Map([
  [Tileset.CAVES_1, 'two'],
  [Tileset.AIRSTRIP, 'three'],
  [Tileset.DEAD_AIRSTRIP, 'three'],
  [Tileset.TEMP_14, 'three'],
  [Tileset.TEMP_18, 'three'],
  [Tileset.TEMP_19, 'three'],
  [Tileset.TEMP_26, 'three'],
  [Tileset.TEMP_27, 'three'],
  [Tileset.TEMP_28, 'three'],
  [Tileset.TEMP_29, 'three'],
  [Tileset.TROPICAL_1, 'four'],
  [Tileset.TEMP_20, 'four'],
]);

export function surfaceTerrainTable(tables: TileTables, tilesetId: number): Map<number, number> {
  const fn = FUNCTION_BY_TILESET.get(tilesetId) ?? 'one';
  const road = fn === 'three' ? Terrain.PAVED_ROAD : Terrain.DIRT_ROAD;
  const floor = fn === 'two' ? Terrain.FLAT_GROUND : Terrain.FLAT_FLOOR;
  const entries: [string, number][] = [
    ['FIRSTTEXTURE', Terrain.FLAT_GROUND],
    ['SECONDTEXTURE', Terrain.FLAT_GROUND],
    ['THIRDTEXTURE', Terrain.FLAT_GROUND],
    ['FOURTHTEXTURE', Terrain.FLAT_GROUND],
    ['FIFTHTEXTURE', Terrain.LOW_GRASS],
    ['SIXTHTEXTURE', Terrain.LOW_GRASS],
    ['SEVENTHTEXTURE', Terrain.FLAT_GROUND],
    ['REGWATERTEXTURE', Terrain.LOW_WATER],
    ['DEEPWATERTEXTURE', Terrain.DEEP_WATER],
    ['FIRSTROAD', road],
    ['ROADPIECES', road],
    ['FIRSTFLOOR', floor],
    ['SECONDFLOOR', fn === 'four' ? Terrain.FLAT_GROUND : floor],
    ['THIRDFLOOR', floor],
    ['FOURTHFLOOR', floor],
  ];
  return new Map(entries.map(([name, terrain]) => [typeIndex(tables, name), terrain]));
}

export function isShorePiece(tables: TileTables, tile: number): boolean {
  return (
    (tileIndex(tables, 'REGWATERTEXTURE18') <= tile && tile <= tileIndex(tables, 'REGWATERTEXTURE50')) ||
    tile === typeIndex(tables, 'REGWATERTEXTURE') ||
    tile === tileIndex(tables, 'REGWATERTEXTURE12') ||
    tile === tileIndex(tables, 'REGWATERTEXTURE14') ||
    tile === tileIndex(tables, 'REGWATERTEXTURE16')
  );
}
