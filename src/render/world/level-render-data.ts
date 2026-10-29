// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldMan.cc AddLandToHead, AddStructToTailCommon; WorldDef.cc OptimizeMapForShadows,
// @src GridNoIndoors; Tactical/Handle_UI.cc SetInterfaceHeightLevel

import type { MapInformation } from '../../content/formats/map.ts';
import { Direction, directionIncrement, newGridNo, WORLD_MAX } from '../../content/world/grid.ts';
import { type Level, type LevelLayer, levelTilesAt } from '../../content/world/level.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { type TileElement, TileFlags } from '../../content/world/tile-database.ts';
import { type TileTables, typeIndex } from '../../content/world/tile-tables.ts';

const NO_LAND_START = -1;
const SHADOW_SEARCH_DIRECTIONS: readonly number[] = [
  Direction.WEST,
  Direction.SOUTHWEST,
  Direction.SOUTH,
  Direction.SOUTHEAST,
  Direction.EAST,
];

export interface LevelRenderData {
  readonly landStart: Int8Array;
  readonly shadows: LevelLayer;
  readonly renderHeight: number;
  readonly noBurn: Uint8Array;
  readonly hasStructure: Uint8Array;
  readonly hasTree: Uint8Array;
}

function noBurnStruct(structs: Uint16Array, tiles: readonly TileElement[]): number {
  let wall = false;
  let flag = 0;
  for (const t of structs) {
    const def = tiles[t]?.structure;
    if (!def) continue;
    if (has(def.flags, StructureFlags.WALLSTUFF)) wall = true;
    flag = !wall && def.tiles.length === 1 ? 1 : 0;
  }
  return flag;
}

function firstFullLandFromHead(land: Uint16Array, tiles: readonly TileElement[]): number {
  for (let i = 0; i < land.length; i++) if (tiles[land[i] ?? 0]?.fullTile) return i;
  return NO_LAND_START;
}

function structureFootprints(level: Level, tiles: readonly TileElement[]): { hasStructure: Uint8Array; hasTree: Uint8Array } {
  const hasStructure = new Uint8Array(WORLD_MAX);
  const hasTree = new Uint8Array(WORLD_MAX);
  for (const layer of [level.layers.structs, level.layers.roofs, level.layers.onRoof]) {
    for (let g = 0; g < WORLD_MAX; g++) {
      for (const t of levelTilesAt(layer, g)) {
        const s = tiles[t]?.structure;
        if (!s) continue;
        for (const piece of s.tiles) {
          const at = g + piece.posRelToBase;
          if (at < 0 || at >= WORLD_MAX) continue;
          hasStructure[at] = 1;
          if (has(s.flags, StructureFlags.TREE)) hasTree[at] = 1;
        }
      }
    }
  }
  return { hasStructure, hasTree };
}

function renderHeight(level: Level, info: MapInformation, underground: boolean): number {
  if (underground) return 0;
  const entry = [info.northGridNo, info.eastGridNo, info.southGridNo, info.westGridNo].find((g) => g >= 0 && g < WORLD_MAX);
  return entry === undefined ? 0 : (level.heights[entry] ?? 0);
}

interface ShadowInputs {
  readonly level: Level;
  readonly tiles: readonly TileElement[];
  readonly firstFloor: number;
  readonly lastFloor: number;
  readonly hasStructure: Uint8Array;
  readonly hasTree: Uint8Array;
}

function shadowList(inputs: ShadowInputs, g: number): number[] {
  const { level, tiles, firstFloor, lastFloor, hasStructure, hasTree } = inputs;
  const land = levelTilesAt(level.layers.land, g);
  const indoors = [...land].some((t) => {
    const type = tiles[t]?.type ?? -1;
    return type >= firstFloor && type <= lastFloor;
  });
  const buddies: number[] = [];
  if (!indoors) {
    for (const t of levelTilesAt(level.layers.structs, g)) {
      const te = tiles[t];
      if (te && te.flags & TileFlags.HAS_SHADOW_BUDDY && te.buddy !== -1) buddies.unshift(te.buddy);
    }
  }
  const surrounded = hasTree[g] === 1 && SHADOW_SEARCH_DIRECTIONS.every((d) => hasStructure[newGridNo(g, directionIncrement(d))] === 1);
  return surrounded ? [] : [...buddies, ...levelTilesAt(level.layers.shadows, g)];
}

function packShadows(lists: (g: number) => ArrayLike<number>): LevelLayer {
  const offsets = new Uint32Array(WORLD_MAX + 1);
  const all: ArrayLike<number>[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    const l = lists(g);
    all.push(l);
    offsets[g + 1] = (offsets[g] ?? 0) + l.length;
  }
  const shadowTiles = new Uint16Array(offsets[WORLD_MAX] ?? 0);
  all.forEach((l, g) => {
    shadowTiles.set(l, offsets[g] ?? 0);
  });
  return { offsets, tiles: shadowTiles };
}

function floorRange(tables: TileTables): { readonly firstFloor: number; readonly lastFloor: number } {
  return { firstFloor: typeIndex(tables, 'FIRSTFLOOR'), lastFloor: typeIndex(tables, 'FIRSTROOF') - 1 };
}

export function prepareLevelRenderData(
  level: Level,
  tiles: readonly TileElement[],
  tables: TileTables,
  info: MapInformation,
  underground: boolean,
): LevelRenderData {
  const landStart = new Int8Array(WORLD_MAX);
  const noBurn = new Uint8Array(WORLD_MAX);
  const { hasStructure, hasTree } = structureFootprints(level, tiles);
  const inputs: ShadowInputs = { level, tiles, ...floorRange(tables), hasStructure, hasTree };
  for (let g = 0; g < WORLD_MAX; g++) {
    landStart[g] = firstFullLandFromHead(levelTilesAt(level.layers.land, g), tiles);
    noBurn[g] = noBurnStruct(levelTilesAt(level.layers.structs, g), tiles);
  }
  const shadows = packShadows((g) => shadowList(inputs, g));
  return { landStart, shadows, renderHeight: renderHeight(level, info, underground), noBurn, hasStructure, hasTree };
}

export function updateLevelRenderData(
  previous: LevelRenderData,
  level: Level,
  tiles: readonly TileElement[],
  tables: TileTables,
  gridNos: ReadonlySet<number>,
): LevelRenderData {
  const noBurn = previous.noBurn.slice();
  for (const g of gridNos) noBurn[g] = noBurnStruct(levelTilesAt(level.layers.structs, g), tiles);
  const inputs: ShadowInputs = { level, tiles, ...floorRange(tables), hasStructure: previous.hasStructure, hasTree: previous.hasTree };
  const shadows = packShadows((g) => (gridNos.has(g) ? shadowList(inputs, g) : levelTilesAt(previous.shadows, g)));
  return { ...previous, shadows, noBurn };
}
