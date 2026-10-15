// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.cc LoadWorldFromSGPFile (struct/roof/on-roof loops, FailedToAddNode);
// @src src/game/TileEngine/WorldMan.cc AddNodeToWorld. See docs/07 §1.2.

import type { LayerName } from '../formats/map.ts';
import { WORLD_MAX } from './grid.ts';
import { type Level, type LevelLayer, levelTilesAt } from './level.ts';
import { WorldStructures } from './structures.ts';
import type { TileElement } from './tile-database.ts';

export interface PlacedWorld {
  readonly level: Level;
  readonly structures: WorldStructures;
  readonly rejected: readonly { readonly gridNo: number; readonly tile: number }[];
}

const STRUCTURE_LAYERS: readonly [LayerName, number][] = [
  ['structs', 0],
  ['roofs', 1],
  ['onRoof', 1],
];

function filterLayer(layer: LevelLayer, drop: ReadonlySet<number>): LevelLayer {
  if (drop.size === 0) return layer;
  const offsets = new Uint32Array(WORLD_MAX + 1);
  const tiles: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    const start = layer.offsets[g] ?? 0;
    const end = layer.offsets[g + 1] ?? 0;
    for (let i = start; i < end; i++) if (!drop.has(i)) tiles.push(layer.tiles[i] ?? 0);
    offsets[g + 1] = tiles.length;
  }
  return { offsets, tiles: Uint16Array.from(tiles) };
}

export function placeWorldStructures(level: Level, db: readonly TileElement[]): PlacedWorld {
  const structures = new WorldStructures(level.heights);
  const rejected: { gridNo: number; tile: number }[] = [];
  const dropped = new Set<number>();
  for (const [name, z] of STRUCTURE_LAYERS) {
    const layer = level.layers[name];
    for (let g = 0; g < WORLD_MAX; g++) {
      const start = layer.offsets[g] ?? 0;
      levelTilesAt(layer, g).forEach((tile, k) => {
        const def = db[tile]?.structure;
        if (!def || structures.add(g, z, def)) return;
        if (name !== 'structs') throw new Error(`structure of tile ${tile} rejected on the ${name} layer at ${g}`);
        rejected.push({ gridNo: g, tile });
        dropped.add(start + k);
      });
    }
  }
  const layers = { ...level.layers, structs: filterLayer(level.layers.structs, dropped) };
  return { level: { ...level, layers }, structures, rejected };
}
