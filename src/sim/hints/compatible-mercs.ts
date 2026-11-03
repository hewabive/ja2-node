// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc DrawItemPoolList (every item of the list lights the faces);
// @src Interface_Items.cc HandleAnyMercInSquadHasCompatibleStuff, SoldierContainsAnyCompatibleStuff.

import { type ItemTable, NOTHING } from '../../content/items/items.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import type { Inventory } from '../tactical/inventory.ts';
import { soldierContainsAnyCompatibleStuff } from '../tactical/item-compatibility.ts';
import { Team } from '../tactical/soldier.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export interface CompatibleMercs {
  readonly mercs: readonly number[];
}

export interface CompatibleMercsRequest extends HintRequestBase {
  readonly items?: unknown;
}

function itemIndices(table: ItemTable, items: unknown): readonly number[] | null {
  if (!Array.isArray(items)) return null;
  const known = (item: unknown): item is number => typeof item === 'number' && item !== NOTHING && table.byIndex.has(item);
  return items.every(known) ? items : null;
}

function carriesCompatibleStuff(table: ItemTable, inv: Inventory, items: readonly number[]): boolean {
  return items.some((item) => soldierContainsAnyCompatibleStuff(table, inv, item));
}

export function compatibleMercs(world: KnowledgeWorld, req: CompatibleMercsRequest): HintResult<CompatibleMercs> {
  const tactical = world.tactical;
  if (!tactical) return refuseHint('noSector', 'no sector is loaded');
  const table = tactical.state.content.items;
  const items = itemIndices(table, req.items);
  if (!items) return refuseHint('badItems', 'items must be a list of item indices');
  const mercs = world.view.soldiers
    .filter((v) => v.team === Team.OUR)
    .filter((v) => {
      const merc = tactical.ownSoldier(v.id);
      return merc !== null && carriesCompatibleStuff(table, merc.inv, items);
    })
    .map((v) => v.id);
  return hintData({ mercs });
}
