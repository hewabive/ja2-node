// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc BuildStashForSelectedSector (the visible items padded to
// @src whole pages of MAP_INVENTORY_POOL_SLOT_COUNT), CheckAndUnDateSlotAllocation (another page when fewer than two slots
// @src are free), GetTotalNumberOfItemsInSectorStash, MapInvenPoolSlotsPrimary (the checks in their order: an unreachable
// @src item, no merc selected, the merc not in the sector or on the road, a battle there), BeginInventoryPoolPtr (one object,
// @src SHIFT the whole slot); src/game/Strategic/MapScreen.cc TrashCanBtnCallback; Tactical/Interface_Items.cc
// @src BeginKeyRingItemPointer (keys off the ring put into the pool or the trash can, 2026-11-03).

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

export type PoolLayout = readonly (number | null)[];

export interface PoolPlacement {
  readonly index: number;
  readonly slot: number;
}

export function poolSize(entries: number): number {
  const size = entries + (POOL_SLOTS_PER_PAGE - (entries % POOL_SLOTS_PER_PAGE));
  return size - entries < MIN_FREE_SLOTS ? size + POOL_SLOTS_PER_PAGE : size;
}

export function poolPages(entries: number): number {
  return layoutPages(poolSize(entries));
}

export function layoutPages(size: number): number {
  return idiv(size - 1, POOL_SLOTS_PER_PAGE) + 1;
}

export function openedLayout(stash: readonly StashEntryView[]): PoolLayout {
  const layout: (number | null)[] = stash.map((e) => e.index);
  while (layout.length < poolSize(stash.length)) layout.push(null);
  return layout;
}

export function refreshedLayout(layout: PoolLayout, stash: readonly StashEntryView[], placements: readonly PoolPlacement[]): PoolLayout {
  const listed = new Set(stash.map((e) => e.index));
  const out = layout.map((index) => (index !== null && listed.has(index) ? index : null));
  for (const p of placements) {
    if (!listed.has(p.index)) continue;
    const at = out.indexOf(p.index);
    if (at >= 0) out[at] = null;
    putIntoHole(out, p.index, p.slot);
  }
  for (const e of stash) if (!out.includes(e.index)) putIntoHole(out, e.index, out.indexOf(null));
  return withFreeSlots(out);
}

function putIntoHole(out: (number | null)[], index: number, slot: number): void {
  const hole = slot >= 0 && out[slot] === null ? slot : out.indexOf(null);
  if (hole >= 0) out[hole] = index;
  else out.push(index);
}

function withFreeSlots(out: (number | null)[]): (number | null)[] {
  while (out.length - out.filter((index) => index !== null).length < MIN_FREE_SLOTS)
    out.push(...Array.from({ length: POOL_SLOTS_PER_PAGE }, () => null));
  return out;
}

export function poolSlotIndex(page: number, slot: number): number {
  return page * POOL_SLOTS_PER_PAGE + slot;
}

export function poolEntry(
  layout: PoolLayout,
  entries: ReadonlyMap<number, StashEntryView>,
  page: number,
  slot: number,
): StashEntryView | null {
  const index = layout[poolSlotIndex(page, slot)];
  return index === undefined || index === null ? null : (entries.get(index) ?? null);
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

export function stashLocation(at: PoolLocation): { sector: string; z?: number } {
  return { sector: at.sector, ...(at.z !== 0 ? { z: at.z } : {}) };
}

export function fromStashCommand(cursor: StashCursor, soldier: number, slot: number): CommandEnvelope {
  return {
    type: 'moveItem',
    soldier,
    from: 'ground',
    item: cursor.index,
    to: slot,
    ...stashLocation(cursor),
    ...(cursor.count === 'all' ? {} : { count: cursor.count }),
  };
}

export function toStashCommand(cursor: ItemCursor, target: StashEntryView | null, pool: PoolLocation): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind !== 'slot' && s.kind !== 'keyRing') return null;
  return {
    type: 'moveItem',
    soldier: s.soldier,
    from: s.kind === 'keyRing' ? { ring: s.position } : s.slot,
    to: 'ground',
    ...(target ? { stashIndex: target.index } : {}),
    ...stashLocation(pool),
    ...countOf(s.count),
  };
}

export function withinStashCommand(cursor: StashCursor, soldier: number, target: StashEntryView | null): CommandEnvelope {
  return {
    type: 'moveItem',
    soldier,
    from: 'ground',
    item: cursor.index,
    to: 'ground',
    ...(target ? { stashIndex: target.index } : {}),
    ...stashLocation(cursor),
    ...(cursor.count === 'all' ? {} : { count: cursor.count }),
  };
}

export function discardFromStashCommand(cursor: StashCursor, soldier: number): CommandEnvelope {
  return {
    type: 'discardItem',
    soldier,
    slot: 'ground',
    item: cursor.index,
    ...stashLocation(cursor),
    ...(cursor.count === 'all' ? {} : { count: cursor.count }),
  };
}

export function arrangeCommand(layout: PoolLayout, at: PoolLocation): CommandEnvelope {
  return { type: 'arrangeStash', ...stashLocation(at), order: layout.filter((index): index is number => index !== null) };
}

export function stashPlacements(data: unknown, target: number, source: number): PoolPlacement[] {
  const reply = (data ?? {}) as { readonly stashIndex?: unknown; readonly leftover?: unknown };
  return [
    ...(typeof reply.stashIndex === 'number' && target >= 0 ? [{ index: reply.stashIndex, slot: target }] : []),
    ...(typeof reply.leftover === 'number' ? [{ index: reply.leftover, slot: source }] : []),
  ];
}

export function leftoverIndex(data: unknown): number | null {
  const leftover = (data as { readonly leftover?: unknown } | undefined)?.leftover;
  return typeof leftover === 'number' ? leftover : null;
}

export function discardCommand(cursor: ItemCursor): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind === 'keyRing') return { type: 'discardItem', soldier: s.soldier, slot: { ring: s.position }, ...countOf(s.count) };
  if (s.kind !== 'slot') return null;
  return {
    type: 'discardItem',
    soldier: s.soldier,
    slot: s.slot,
    ...countOf(s.count),
    ...(s.index !== 0 ? { index: s.index } : {}),
  };
}

function countOf(count: CursorCount): { count?: CursorCount } {
  return count === 'all' ? {} : { count };
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
