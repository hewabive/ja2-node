// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc HandleCompatibleAmmoUIForMapScreen, HandleCompatibleAmmoUIForMapInventory
// @src (the items lit for a merc's item or a sector inventory item under the pointer on the map screen).

import { type ItemTable, NOTHING } from '../../content/items/items.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { compatibleWithItem } from '../tactical/item-compatibility.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export interface CompatibleItems {
  readonly compatible: readonly boolean[];
}

export interface CompatibleItemsRequest extends HintRequestBase {
  readonly item?: unknown;
  readonly items?: unknown;
}

function knownItem(table: ItemTable, item: unknown): item is number {
  return typeof item === 'number' && (item === NOTHING || table.byIndex.has(item));
}

export function compatibleItems(world: KnowledgeWorld, req: CompatibleItemsRequest): HintResult<CompatibleItems> {
  const table = world.rules.content?.items;
  if (!table) return refuseHint('noSector', 'no item content');
  const item = req.item;
  if (!knownItem(table, item) || item === NOTHING) return refuseHint('badItem', 'item must be an item index');
  const items = req.items;
  if (!Array.isArray(items) || !items.every((i) => knownItem(table, i)))
    return refuseHint('badItems', 'items must be a list of item indices');
  return hintData({ compatible: items.map((candidate: number) => compatibleWithItem(table, candidate, item)) });
}
