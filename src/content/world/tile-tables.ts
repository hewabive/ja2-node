// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/TileDat.h, TileDat.cc

import { FormatError } from '../binary/errors.ts';

export const TILE_TABLES_PATH = 'tables/tiles.json';

export interface TileTypeInfo {
  readonly index: number;
  readonly name: string;
  readonly surfaceName: string;
  readonly start: number;
  readonly count: number;
}

export interface ShadowBuddy {
  readonly structureType: number;
  readonly shadowType: number;
  readonly firstStructureTile: number;
  readonly firstShadowTile: number;
}

export interface TileTables {
  readonly numberOfTiles: number;
  readonly types: readonly TileTypeInfo[];
  readonly shadowBuddies: readonly ShadowBuddy[];
  readonly doorAnimations: {
    readonly open: readonly number[];
    readonly openShadow: readonly number[];
    readonly closed: readonly number[];
    readonly closedShadow: readonly number[];
  };
  readonly fullBaseTileValues: readonly number[];
  readonly tileNames: readonly string[];
  readonly tileIndexByName: ReadonlyMap<string, number>;
  readonly typeIndexByName: ReadonlyMap<string, number>;
}

export function parseTileTables(json: unknown): TileTables {
  const t = json as Omit<TileTables, 'tileIndexByName' | 'typeIndexByName'>;
  if (!Array.isArray(t?.types) || !Array.isArray(t.tileNames) || t.tileNames.length !== t.numberOfTiles) {
    throw new FormatError('malformed tile tables');
  }
  return {
    ...t,
    tileIndexByName: new Map(t.tileNames.map((name, i) => [name, i])),
    typeIndexByName: new Map(t.types.map((type) => [type.name, type.index])),
  };
}

export function tileIndex(tables: TileTables, name: string): number {
  const i = tables.tileIndexByName.get(name);
  if (i === undefined) throw new RangeError(`unknown tile ${name}`);
  return i;
}

export function typeIndex(tables: TileTables, name: string): number {
  const i = tables.typeIndexByName.get(name);
  if (i === undefined) throw new RangeError(`unknown tile type ${name}`);
  return i;
}

export function tileIndexFromTypeSubIndex(tables: TileTables, type: number, subIndex: number): number {
  const t = tables.types[type];
  if (!t) throw new RangeError(`unknown tile type ${type}`);
  return t.start + subIndex - 1;
}

export function tileTypeOf(tables: TileTables, tile: number): number {
  let lo = 0;
  let hi = tables.types.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((tables.types[mid]?.start ?? 0) <= tile) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
