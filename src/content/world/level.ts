// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.cc LoadWorldFromSGPFile (layer list construction)

import { LAYER_NAMES, type LayerName, type MapDef } from '../formats/map.ts';
import { WORLD_MAX } from './grid.ts';
import { type TileElement, TileFlags } from './tile-database.ts';
import { type TileTables, tileIndexFromTypeSubIndex, typeIndex } from './tile-tables.ts';

const LAST_MINOR_VERSION_WITH_PHANTOM_STRUCTS = 25;

export interface LevelLayer {
  readonly offsets: Uint32Array;
  readonly tiles: Uint16Array;
}

export interface Level {
  readonly tilesetId: number;
  readonly heights: Uint8Array;
  readonly rooms: Uint8Array;
  readonly layers: Readonly<Record<LayerName, LevelLayer>>;
}

export function levelTilesAt(layer: LevelLayer, gridNo: number): Uint16Array {
  return layer.tiles.subarray(layer.offsets[gridNo] ?? 0, layer.offsets[gridNo + 1] ?? 0);
}

function packLayer(lists: number[][]): LevelLayer {
  const offsets = new Uint32Array(WORLD_MAX + 1);
  lists.forEach((list, g) => {
    offsets[g + 1] = (offsets[g] ?? 0) + list.length;
  });
  const tiles = new Uint16Array(offsets[WORLD_MAX] ?? 0);
  lists.forEach((list, g) => {
    tiles.set(list, offsets[g] ?? 0);
  });
  return { offsets, tiles };
}

export function buildLevel(map: MapDef, tables: TileTables, db: readonly TileElement[]): Level {
  const firstPointerType = typeIndex(tables, 'FIRSTPOINTERS');
  const lists = Object.fromEntries(LAYER_NAMES.map((name) => [name, Array.from({ length: WORLD_MAX }, (): number[] => [])])) as Record<
    LayerName,
    number[][]
  >;
  for (const name of LAYER_NAMES) {
    const src = map.layers[name];
    for (let g = 0; g < WORLD_MAX; g++) {
      const start = src.offsets[g] ?? 0;
      const end = src.offsets[g + 1] ?? 0;
      const count = end - start;
      const list = lists[name][g] as number[];
      for (let i = start; i < end; i++) {
        const type = src.types[i] ?? 0;
        const subIndex = src.subIndices[i] ?? 0;
        if (name === 'objects' && type >= firstPointerType) continue;
        let tile = tileIndexFromTypeSubIndex(tables, type, subIndex);
        if (
          name === 'structs' &&
          map.minorVersion <= LAST_MINOR_VERSION_WITH_PHANTOM_STRUCTS &&
          (db[tile]?.flags ?? 0) & TileFlags.UNDERFLOW_FILLER
        ) {
          if (count > 1) continue;
          tile = tileIndexFromTypeSubIndex(tables, type, 1);
        }
        if (name === 'land') list.unshift(tile);
        else list.push(tile);
      }
    }
  }
  const layers = Object.fromEntries(LAYER_NAMES.map((name) => [name, packLayer(lists[name])])) as Record<LayerName, LevelLayer>;
  return { tilesetId: map.tilesetId, heights: map.heights, rooms: map.rooms, layers };
}
