// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc BuildStashForSelectedSector (the visible items padded to
// @src whole pages of MAP_INVENTORY_POOL_SLOT_COUNT), CheckAndUnDateSlotAllocation (another page when fewer than two slots
// @src are free), GetTotalNumberOfItemsInSectorStash, MapInvenPoolSlotsPrimary (the checks in their order: an unreachable
// @src item, no merc selected, the merc not in the sector or on the road, a battle there), BeginInventoryPoolPtr (one object,
// @src SHIFT the whole slot); src/game/Strategic/MapScreen.cc TrashCanBtnCallback.

import { idiv } from '../../../core/int.ts';
import type { StashEntryView } from '../../../protocol/map-inventory.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView } from '../../../protocol/view.ts';
import type { CursorCount, ItemCursor } from '../tactical/item-cursor.ts';

export const POOL_SLOTS_PER_PAGE = 45;
export const POOL_SLOT_ROWS = 9;
const MIN_FREE_SLOTS = 2;

export interface StashCursor {
  readonly kind: 'stash';
  readonly index: number;
  readonly item: string;
  readonly count: CursorCount;
  readonly sector: string;
  readonly z: number;
}

export interface PoolLocation {
  readonly sector: string;
  readonly z: number;
}

export function poolSize(entries: number): number {
  const size = entries + (POOL_SLOTS_PER_PAGE - (entries % POOL_SLOTS_PER_PAGE));
  return size - entries < MIN_FREE_SLOTS ? size + POOL_SLOTS_PER_PAGE : size;
}

export function poolPages(entries: number): number {
  return idiv(poolSize(entries) - 1, POOL_SLOTS_PER_PAGE) + 1;
}

export function poolEntry(stash: readonly StashEntryView[], page: number, slot: number): StashEntryView | null {
  return stash[page * POOL_SLOTS_PER_PAGE + slot] ?? null;
}

export function poolObjects(stash: readonly StashEntryView[]): number {
  return stash.reduce((sum, e) => sum + Math.max(0, e.count), 0);
}

export function poolSlotOrigin(slot: number): { readonly column: number; readonly row: number } {
  return { column: idiv(slot, POOL_SLOT_ROWS), row: slot % POOL_SLOT_ROWS };
}

export function stashCursor(entry: StashEntryView, wholeSlot: boolean, location: PoolLocation): StashCursor {
  return { kind: 'stash', index: entry.index, item: entry.item, count: wholeSlot ? 'all' : 1, sector: location.sector, z: location.z };
}

export function shownEntry(entry: StashEntryView, cursor: StashCursor | null): StashEntryView | null {
  if (!cursor || cursor.index !== entry.index) return entry;
  if (cursor.count === 'all' || entry.count <= 1) return null;
  return { ...entry, count: entry.count - 1, status: entry.status.slice(1) };
}

export function entryView(entry: StashEntryView): InventoryItemView {
  return {
    slot: -1,
    item: entry.item,
    index: 0,
    count: entry.count,
    status: entry.status,
    ...(entry.money !== undefined ? { money: entry.money } : {}),
    ...(entry.ammo ? { ammo: entry.ammo } : {}),
    ...(entry.attachments ? { attachments: entry.attachments } : {}),
    ...(entry.jammed ? { jammed: entry.jammed } : {}),
    ...(entry.imprint !== undefined ? { imprint: entry.imprint } : {}),
  };
}

function location(cursor: PoolLocation): { sector: string; z?: number } {
  return { sector: cursor.sector, ...(cursor.z !== 0 ? { z: cursor.z } : {}) };
}

export function fromStashCommand(cursor: StashCursor, soldier: number, slot: number): CommandEnvelope {
  return {
    type: 'moveItem',
    soldier,
    from: 'ground',
    item: cursor.index,
    to: slot,
    ...location(cursor),
    ...(cursor.count === 'all' ? {} : { count: cursor.count }),
  };
}

export function toStashCommand(cursor: ItemCursor, target: StashEntryView | null, pool: PoolLocation): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind !== 'slot') return null;
  return {
    type: 'moveItem',
    soldier: s.soldier,
    from: s.slot,
    to: 'ground',
    ...(target ? { stashIndex: target.index } : {}),
    ...location(pool),
    ...(s.count === 'all' ? {} : { count: s.count }),
  };
}

export function discardCommand(cursor: ItemCursor): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind !== 'slot') return null;
  return {
    type: 'discardItem',
    soldier: s.soldier,
    slot: s.slot,
    ...(s.count === 'all' ? {} : { count: s.count }),
    ...(s.index !== 0 ? { index: s.index } : {}),
  };
}

export const PoolRefusal = {
  UNREACHABLE: 'unreachable',
  NO_MERC: 'noMerc',
  ELSEWHERE: 'elsewhere',
  BATTLE: 'battle',
} as const;
export type PoolRefusal = (typeof PoolRefusal)[keyof typeof PoolRefusal];

export interface PoolClickInput {
  readonly entry: StashEntryView | null;
  readonly holding: boolean;
  readonly mercInSector: boolean | null;
  readonly usable: boolean;
}

export function poolClickRefusal(input: PoolClickInput): PoolRefusal | null {
  if (input.entry && !input.entry.reachable) return PoolRefusal.UNREACHABLE;
  if (input.mercInSector === null) return PoolRefusal.NO_MERC;
  if (!input.mercInSector) return PoolRefusal.ELSEWHERE;
  return input.usable ? null : PoolRefusal.BATTLE;
}
