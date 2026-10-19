// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc BeginItemPointer (one object, SHIFT the whole stack), CancelItemPointer,
// @src ItemDescAmmoCallback (the magazine into the cursor), ItemDescAttachmentsCallbackPrimary (attach with the item in
// @src the cursor, else the attachment into the cursor), ItemPopupRegionCallbackPrimary (one object of a stack);
// @src src/game/Tactical/Interface_Panels.cc SMInvClickCallbackPrimary (place, swap, give to the merc of the panel, the
// @src attach and merge branches), SMInvClickCamoCallback (apply on the merc). See docs/28 §5.3 and the deviation
// @src "Item cursor".

import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView, SoldierView } from '../../../protocol/view.ts';

export type CursorCount = 'all' | 1;

export type CursorSource =
  | { readonly kind: 'slot'; readonly soldier: number; readonly slot: number; readonly count: CursorCount; readonly index: number }
  | { readonly kind: 'attachment'; readonly soldier: number; readonly slot: number; readonly attachment: number }
  | { readonly kind: 'magazine'; readonly soldier: number; readonly slot: number };

export interface ItemCursor {
  readonly source: CursorSource;
  readonly item: string;
}

export function slotItem(soldier: SoldierView | null, slot: number): InventoryItemView | null {
  return soldier?.inventory?.find((i) => i.slot === slot) ?? null;
}

export function cursorFromSlot(soldier: SoldierView, slot: number, wholeStack: boolean, index = 0): ItemCursor | null {
  const item = slotItem(soldier, slot);
  if (!item) return null;
  const count: CursorCount = wholeStack ? 'all' : 1;
  return { source: { kind: 'slot', soldier: soldier.id, slot, count, index }, item: item.item };
}

export function cursorFromAttachment(soldier: SoldierView, slot: number, attachment: number): ItemCursor | null {
  const item = slotItem(soldier, slot)?.attachments?.[attachment];
  return item ? { source: { kind: 'attachment', soldier: soldier.id, slot, attachment }, item: item.item } : null;
}

export function cursorFromMagazine(soldier: SoldierView, slot: number): ItemCursor | null {
  const ammo = slotItem(soldier, slot)?.ammo;
  if (!ammo || ammo.shots <= 0) return null;
  return { source: { kind: 'magazine', soldier: soldier.id, slot }, item: ammo.item };
}

function countField(count: CursorCount): { count?: CursorCount } {
  return count === 'all' ? {} : { count };
}

export function placeCommand(cursor: ItemCursor, target: number, slot: number, merge?: boolean): CommandEnvelope {
  const s = cursor.source;
  if (s.kind === 'attachment') return { type: 'detach', soldier: s.soldier, slot: s.slot, attachment: s.attachment, to: slot };
  if (s.kind === 'magazine') return { type: 'unload', soldier: s.soldier, slot: s.slot, to: slot };
  return {
    type: 'moveItem',
    soldier: s.soldier,
    from: s.slot,
    to: slot,
    ...(target !== s.soldier ? { toSoldier: target } : {}),
    ...countField(s.count),
    ...(s.index !== 0 ? { index: s.index } : {}),
    ...(merge !== undefined ? { merge } : {}),
  };
}

export function attachCommand(
  cursor: ItemCursor,
  owner: number,
  slot: number,
  ownerIndex: number,
  permanent: boolean,
): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind !== 'slot') return null;
  return {
    type: 'attach',
    soldier: s.soldier,
    item: s.slot,
    to: slot,
    ...(owner !== s.soldier ? { toSoldier: owner } : {}),
    ...(ownerIndex !== 0 ? { index: ownerIndex } : {}),
    count: s.count,
    ...(permanent ? { permanent: true } : {}),
  };
}

export function applyCommand(cursor: ItemCursor, target: number): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind !== 'slot') return null;
  return { type: 'applyItem', soldier: s.soldier, slot: s.slot, ...(target !== s.soldier ? { target } : {}) };
}

export function dropCommand(cursor: ItemCursor): CommandEnvelope {
  const s = cursor.source;
  if (s.kind === 'slot')
    return { type: 'drop', soldier: s.soldier, slot: s.slot, ...countField(s.count), ...(s.index !== 0 ? { index: s.index } : {}) };
  return cancelCommand(cursor) as CommandEnvelope;
}

export function giveCommand(cursor: ItemCursor, target: number): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind !== 'slot') return null;
  return { type: 'give', soldier: s.soldier, target, slot: s.slot, ...countField(s.count) };
}

export function cancelCommand(cursor: ItemCursor): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind === 'attachment') return { type: 'detach', soldier: s.soldier, slot: s.slot, attachment: s.attachment };
  if (s.kind === 'magazine') return { type: 'unload', soldier: s.soldier, slot: s.slot };
  return null;
}

export function takenFrom(cursor: ItemCursor | null, soldier: number, slot: number): CursorCount | null {
  const s = cursor?.source;
  if (s?.kind !== 'slot' || s.soldier !== soldier || s.slot !== slot) return null;
  return s.count;
}

export function hidesSlot(cursor: ItemCursor | null, view: InventoryItemView, soldier: number): boolean {
  const taken = takenFrom(cursor, soldier, view.slot);
  return taken === 'all' || (taken === 1 && view.count <= 1);
}

export function shownCount(cursor: ItemCursor | null, view: InventoryItemView, soldier: number): number {
  return takenFrom(cursor, soldier, view.slot) === 1 ? view.count - 1 : view.count;
}

export const REFUSAL_USE_ATTACH = 'useAttach';
export const REFUSAL_MERGE_PROMPT = 'mergePrompt';
export const REFUSAL_PERMANENT_ATTACHMENT = 'permanentAttachment';

export function refusalOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const refusal = (data as { refusal?: unknown }).refusal;
  return typeof refusal === 'string' ? refusal : null;
}
