// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldMan.cc AddStructToTailCommon, AddStructToHead (MAPELEMENT_EXT_NOBURN_STRUCT);
// @src WorldDef.cc LoadWorldFromSGPFile (the struct layer loop); Structure.cc FindStructure,
// @src InternalSwapStructureForPartner (a swap keeps the flag)

import type { StructureDef } from '../../content/formats/jsd.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { type Level, levelTilesAt } from '../../content/world/level.ts';
import { has, instanceFlags, StructureFlags, type WorldStructures } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import type { TileChange } from './tile-changes.ts';

const STRUCT_LAYER_LEVEL = 0;
const SINGLE_TILE = 1;

class WallCover {
  readonly #walls = new Uint16Array(WORLD_MAX);

  static of(structures: WorldStructures): WallCover {
    const cover = new WallCover();
    for (let g = 0; g < WORLD_MAX; g++) {
      for (const s of structures.at(g)) if (has(s.flags, StructureFlags.WALLSTUFF)) cover.#walls[g] = (cover.#walls[g] ?? 0) + 1;
    }
    return cover;
  }

  covered(g: number): boolean {
    return (this.#walls[g] ?? 0) > 0;
  }

  add(base: number, def: StructureDef): void {
    this.#count(base, def, 1);
  }

  remove(base: number, def: StructureDef): void {
    this.#count(base, def, -1);
  }

  #count(base: number, def: StructureDef, step: number): void {
    for (const tile of def.tiles) {
      if (!has(instanceFlags(def, tile), StructureFlags.WALLSTUFF)) continue;
      const g = base + tile.posRelToBase;
      if (g >= 0 && g < WORLD_MAX) this.#walls[g] = Math.max(0, (this.#walls[g] ?? 0) + step);
    }
  }
}

function singleTile(def: StructureDef): boolean {
  return def.tiles.length === SINGLE_TILE;
}

function flagAddedAtTail(walls: WallCover, g: number, def: StructureDef): number {
  return !walls.covered(g) && singleTile(def) ? 1 : 0;
}

function flagAddedAtHeadWithInvertedWallTest(walls: WallCover, g: number, def: StructureDef): number {
  return walls.covered(g) && singleTile(def) ? 1 : 0;
}

export function loadedNoBurn(level: Level, tiles: readonly TileElement[]): Uint8Array {
  const noBurn = new Uint8Array(WORLD_MAX);
  const walls = new WallCover();
  for (let g = 0; g < WORLD_MAX; g++) {
    for (const t of levelTilesAt(level.layers.structs, g)) {
      const def = tiles[t]?.structure;
      if (!def) continue;
      walls.add(g, def);
      noBurn[g] = flagAddedAtTail(walls, g, def);
    }
  }
  return noBurn;
}

export function noBurnAfterChanges(
  loaded: Uint8Array,
  structures: WorldStructures,
  tiles: readonly TileElement[],
  changes: readonly TileChange[],
): Uint8Array {
  if (changes.length === 0) return loaded;
  const noBurn = loaded.slice();
  const walls = WallCover.of(structures);
  for (const c of changes) {
    const def = tiles[c.tile]?.structure;
    if (!def || c.kind === 'object') continue;
    if (c.kind === 'remove') {
      walls.remove(c.gridNo, def);
      continue;
    }
    walls.add(c.gridNo, def);
    if (c.level !== STRUCT_LAYER_LEVEL) continue;
    if (c.kind === 'append') noBurn[c.gridNo] = flagAddedAtTail(walls, c.gridNo, def);
    else if (c.kind === 'add') noBurn[c.gridNo] = flagAddedAtHeadWithInvertedWallTest(walls, c.gridNo, def);
  }
  return noBurn;
}
