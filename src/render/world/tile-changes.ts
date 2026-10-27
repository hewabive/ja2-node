// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Structure.cc InternalSwapStructureForPartner (the node keeps its place, its index moves by
// @src the partner delta); SaveLoadMap.cc LoadAllMapChangesFromMapTempFileAndApplyThem (RemoveStruct, AddStructToHead,
// @src AddOnRoofToHead); End_Game.cc ChangeO3SectorStatue; Smell.cc UpdateBloodGraphics (the pool graphic replacing the
// @src tile's first blood object at the head of its object layer). See docs/28 §12.1 G8.

import type { LayerName } from '../../content/formats/map.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { type Level, type LevelLayer, levelTilesAt } from '../../content/world/level.ts';
import { type TileTables, tileIndexFromTypeSubIndex, tileTypeOf, typeIndex } from '../../content/world/tile-tables.ts';

export interface TileChange {
  readonly kind: 'remove' | 'add';
  readonly gridNo: number;
  readonly level: number;
  readonly tile: number;
}

export interface BloodPool {
  readonly gridNo: number;
  readonly strength: number;
  readonly creature?: boolean;
}

type StructureLayer = Extract<LayerName, 'structs' | 'onRoof'>;

const POOL_VARIANTS = 4;
const POOL_SIZES = 4;
const SMALLEST_POOL_FRAME = POOL_SIZES - 1;
const STRENGTH_PER_POOL_SIZE = 2;
const VARIANT_HASH = 0x9e3779b1;
const VARIANT_SHIFT = 32 - Math.log2(POOL_VARIANTS);

const LAYER_OF_LEVEL: readonly StructureLayer[] = ['structs', 'onRoof'];

function layerOfLevel(level: number): StructureLayer {
  return LAYER_OF_LEVEL[level > 0 ? 1 : 0] as StructureLayer;
}

class LayerEdit {
  readonly #source: LevelLayer;
  readonly #edited = new Map<number, number[]>();

  constructor(source: LevelLayer) {
    this.#source = source;
  }

  get changed(): boolean {
    return this.#edited.size > 0;
  }

  at(g: number): number[] {
    let list = this.#edited.get(g);
    if (!list) {
      list = [...levelTilesAt(this.#source, g)];
      this.#edited.set(g, list);
    }
    return list;
  }

  build(): LevelLayer {
    const offsets = new Uint32Array(WORLD_MAX + 1);
    const lists: (readonly number[])[] = [];
    for (let g = 0; g < WORLD_MAX; g++) {
      const list = this.#edited.get(g) ?? levelTilesAt(this.#source, g);
      lists.push(list as readonly number[]);
      offsets[g + 1] = (offsets[g] ?? 0) + list.length;
    }
    const tiles = new Uint16Array(offsets[WORLD_MAX] ?? 0);
    lists.forEach((list, g) => {
      tiles.set(list, offsets[g] ?? 0);
    });
    return { offsets, tiles };
  }
}

interface Removed {
  readonly gridNo: number;
  readonly layer: StructureLayer;
  readonly index: number;
}

function removeTile(edits: Record<StructureLayer, LayerEdit>, c: TileChange): Removed | null {
  const preferred = layerOfLevel(c.level);
  for (const layer of [preferred, ...LAYER_OF_LEVEL.filter((l) => l !== preferred)]) {
    const list = edits[layer].at(c.gridNo);
    const index = list.indexOf(c.tile);
    if (index < 0) continue;
    list.splice(index, 1);
    return { gridNo: c.gridNo, layer, index };
  }
  return null;
}

export function applyTileChanges(level: Level, changes: readonly TileChange[]): Level {
  if (changes.length === 0) return level;
  const edits: Record<StructureLayer, LayerEdit> = {
    structs: new LayerEdit(level.layers.structs),
    onRoof: new LayerEdit(level.layers.onRoof),
  };
  let lastRemoved: Removed | null = null;
  for (const c of changes) {
    if (c.kind === 'remove') {
      lastRemoved = removeTile(edits, c);
      continue;
    }
    const inPlace = lastRemoved !== null && lastRemoved.gridNo === c.gridNo && lastRemoved.layer === layerOfLevel(c.level);
    const list = edits[layerOfLevel(c.level)].at(c.gridNo);
    list.splice(inPlace && lastRemoved ? lastRemoved.index : 0, 0, c.tile);
    lastRemoved = null;
  }
  return {
    ...level,
    layers: {
      ...level.layers,
      structs: edits.structs.changed ? edits.structs.build() : level.layers.structs,
      onRoof: edits.onRoof.changed ? edits.onRoof.build() : level.layers.onRoof,
    },
  };
}

export function tileChangesKey(changes: readonly TileChange[]): string {
  return changes.map((c) => `${c.kind[0]}${c.gridNo}.${c.level}.${c.tile}`).join(',');
}

function poolVariant(pool: BloodPool): number {
  return Math.imul(pool.gridNo * POOL_SIZES * STRENGTH_PER_POOL_SIZE + pool.strength, VARIANT_HASH) >>> VARIANT_SHIFT;
}

function poolTile(tables: TileTables, pool: BloodPool): number {
  const type = typeIndex(tables, pool.creature ? 'CREATUREBLOOD' : 'HUMANBLOOD');
  const frame = poolVariant(pool) * POOL_SIZES + SMALLEST_POOL_FRAME - Math.trunc(pool.strength / STRENGTH_PER_POOL_SIZE);
  return tileIndexFromTypeSubIndex(tables, type, frame + 1);
}

export function applyBloodPools(level: Level, tables: TileTables, pools: readonly BloodPool[]): Level {
  if (pools.length === 0) return level;
  const human = typeIndex(tables, 'HUMANBLOOD');
  const creature = typeIndex(tables, 'CREATUREBLOOD');
  const isPool = (tile: number) => {
    const type = tileTypeOf(tables, tile);
    return type >= human && type <= creature;
  };
  const objects = new LayerEdit(level.layers.objects);
  for (const pool of pools) {
    const list = objects.at(pool.gridNo);
    const old = list.findIndex(isPool);
    if (old >= 0) list.splice(old, 1);
    list.unshift(poolTile(tables, pool));
  }
  return { ...level, layers: { ...level.layers, objects: objects.build() } };
}

export function bloodPoolsKey(pools: readonly BloodPool[]): string {
  return pools.map((p) => `${p.gridNo}.${p.strength}${p.creature ? 'c' : ''}`).join(',');
}
