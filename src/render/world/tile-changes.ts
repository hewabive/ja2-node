// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Structure.cc InternalSwapStructureForPartner (the node keeps its place, its index moves by
// @src the partner delta); SaveLoadMap.cc LoadAllMapChangesFromMapTempFileAndApplyThem (RemoveStruct, AddStructToHead,
// @src AddOnRoofToHead); End_Game.cc ChangeO3SectorStatue. See docs/28 §12.1 G8.

import type { LayerName } from '../../content/formats/map.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { type Level, type LevelLayer, levelTilesAt } from '../../content/world/level.ts';

export interface TileChange {
  readonly kind: 'remove' | 'add';
  readonly gridNo: number;
  readonly level: number;
  readonly tile: number;
}

type StructureLayer = Extract<LayerName, 'structs' | 'onRoof'>;

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
