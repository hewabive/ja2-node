// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-02. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc GetItemPool (every item of the tile and level, drawn or not: only RenderTiles
// @src skips WORLD_ITEM_DONTRENDER), GetLargestZLevelOfItemPool, ItemPoolOKForDisplay (the items of one z-level).

import type { ItemView } from '../../../protocol/view.ts';

export const FLOOR_Z_LEVEL = 0;
const ON_STRUCTURE_Z_LEVEL = 1;

export function itemPool(items: readonly ItemView[] | undefined, gridNo: number, level: number): ItemView[] {
  return (items ?? []).filter((i) => i.gridNo === gridNo && i.level === level);
}

function zLevelOf(item: ItemView): number {
  return (item.height ?? 0) > 0 ? ON_STRUCTURE_Z_LEVEL : FLOOR_Z_LEVEL;
}

export function largestZLevel(pool: readonly ItemView[]): number {
  return pool.some((i) => zLevelOf(i) === ON_STRUCTURE_Z_LEVEL) ? ON_STRUCTURE_Z_LEVEL : FLOOR_Z_LEVEL;
}

export function onZLevel(pool: readonly ItemView[], zLevel: number): ItemView[] {
  return pool.filter((i) => zLevelOf(i) === zLevel);
}
