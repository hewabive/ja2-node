// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc BeginItemPointer (one object, SHIFT the whole stack), CancelItemPointer,
// @src ItemDescAmmoCallback (the magazine into the cursor), ItemDescAttachmentsCallbackPrimary (attach with the item in
// @src the cursor, else the attachment into the cursor), ItemPopupRegionCallbackPrimary (one object of a stack);
// @src src/game/Tactical/Interface_Panels.cc SMInvClickCallbackPrimary (place, swap, give to the merc of the panel, the
// @src attach and merge branches), SMInvClickCamoCallback (apply on the merc), SMInvMoneyButtonCallback (money in the
// @src cursor is deposited); Interface_Items.cc HandleItemPointerClick (the toss to a tile or a catcher, the give to a
// @src talkable target: an escort or the robot at any distance, 2026-11-01), RemoveMoney (the split amount goes into the cursor),
// @src BeginKeyRingItemPointer (one key off the ring, SHIFT all of the position); Interface_Panels.cc
// @src KeyRingSlotInvClickCallbackPrimary (a key in the cursor onto a ring position); Handle_UI.cc IsValidTalkableNPC;
// @src UIHandleItemPlacement (PlaceObject back into the slot the object came from, 2026-11-02; CTRL pools the cursor's
// @src objects into the stack clicked, any merc's and from any slot, a gun's magazine, an attachment, money or the key
// @src ring, and leaves the rest in the cursor;
// @src keys off the ring dropped, given, passed or thrown, 2026-11-03).

import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView, SoldierView } from '../../../protocol/view.ts';

export type CursorCount = 'all' | 1;

export type CursorSource =
  | { readonly kind: 'slot'; readonly soldier: number; readonly slot: number; readonly count: CursorCount; readonly index: number }
  | { readonly kind: 'attachment'; readonly soldier: number; readonly slot: number; readonly attachment: number }
  | { readonly kind: 'magazine'; readonly soldier: number; readonly slot: number }
  | { readonly kind: 'money'; readonly soldier: number; readonly slot: number; readonly amount: number }
  | { readonly kind: 'keyRing'; readonly soldier: number; readonly position: number; readonly count: CursorCount };

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

export function cursorFromMoney(soldier: SoldierView, slot: number, amount: number): ItemCursor | null {
  const item = slotItem(soldier, slot);
  if (!item || amount <= 0) return null;
  return { source: { kind: 'money', soldier: soldier.id, slot, amount }, item: item.item };
}

export function cursorFromKeyRing(soldier: SoldierView, position: number, wholeStack: boolean, item: string): ItemCursor | null {
  const key = soldier.keys?.find((k) => k.position === position);
  if (!key || key.count <= 0) return null;
  return { source: { kind: 'keyRing', soldier: soldier.id, position, count: wholeStack ? 'all' : 1 }, item };
}

function otherSoldier(source: CursorSource, target: number): { toSoldier?: number } {
  return target !== source.soldier ? { toSoldier: target } : {};
}

export function keyRingCommand(cursor: ItemCursor, owner: number, position: number): CommandEnvelope | null {
  const s = cursor.source;
  const to = { ring: position };
  if (s.kind === 'keyRing')
    return { type: 'moveKey', soldier: s.soldier, from: { ring: s.position }, to, ...countField(s.count), ...otherSoldier(s, owner) };
  if (s.kind !== 'slot') return null;
  return {
    type: 'moveKey',
    soldier: s.soldier,
    from: s.slot,
    to,
    ...countField(s.count),
    ...(s.index !== 0 ? { index: s.index } : {}),
    ...otherSoldier(s, owner),
  };
}

export function keysTaken(cursor: ItemCursor | null, soldier: number, position: number): CursorCount | null {
  const s = cursor?.source;
  return s?.kind === 'keyRing' && s.soldier === soldier && s.position === position ? s.count : null;
}

export function placeCommand(cursor: ItemCursor, target: number, slot: number, merge?: boolean): CommandEnvelope {
  const s = cursor.source;
  if (s.kind === 'keyRing')
    return {
      type: 'moveKey',
      soldier: s.soldier,
      from: { ring: s.position },
      to: slot,
      ...countField(s.count),
      ...otherSoldier(s, target),
    };
  if (s.kind === 'money')
    return {
      type: 'splitMoney',
      soldier: s.soldier,
      slot: s.slot,
      amount: s.amount,
      to: slot,
      ...(target !== s.soldier ? { toSoldier: target } : {}),
    };
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

type CombineFrom = number | { ring: number } | { magazine: number } | { attachment: number; slot: number };

function combineSource(s: CursorSource): { from: CombineFrom; index?: number } {
  switch (s.kind) {
    case 'keyRing':
      return { from: { ring: s.position } };
    case 'magazine':
      return { from: { magazine: s.slot } };
    case 'attachment':
      return { from: { attachment: s.attachment, slot: s.slot } };
    case 'money':
      return { from: s.slot };
    case 'slot':
      return { from: s.slot, ...(s.count === 1 ? { index: s.index } : {}) };
  }
}

export function combineCommand(cursor: ItemCursor | null, target: number, slot: number): CommandEnvelope | null {
  const s = cursor?.source;
  if (!s) return null;
  return { type: 'combineStack', soldier: s.soldier, slot, ...combineSource(s), ...otherSoldier(s, target) };
}

export function cursorAfterCombine(cursor: ItemCursor, data: unknown): ItemCursor | null {
  const result = data as { readonly left?: number; readonly index?: number } | undefined;
  if ((result?.left ?? 0) <= 0) return null;
  const s = cursor.source;
  if (s.kind !== 'slot' || result?.index === undefined) return cursor;
  return { ...cursor, source: { ...s, index: result.index } };
}

export function applyCommand(cursor: ItemCursor, target: number): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind !== 'slot') return null;
  return {
    type: 'applyItem',
    soldier: s.soldier,
    slot: s.slot,
    ...(s.count === 'all' ? { count: s.count } : {}),
    ...(s.count === 1 && s.index !== 0 ? { index: s.index } : {}),
    ...(target !== s.soldier ? { target } : {}),
  };
}

export interface PocketFields {
  readonly slot: number | { readonly ring: number };
  readonly count?: CursorCount;
  readonly index?: number;
}

export function tossFields(cursor: ItemCursor): PocketFields | null {
  const s = cursor.source;
  if (s.kind === 'keyRing') return { slot: { ring: s.position }, ...countField(s.count) };
  if (s.kind !== 'slot') return null;
  return { slot: s.slot, ...countField(s.count), ...(s.index !== 0 ? { index: s.index } : {}) };
}

export function dropCommand(cursor: ItemCursor, gridNo?: number): CommandEnvelope | null {
  const fields = tossFields(cursor);
  if (!fields) return cancelCommand(cursor);
  return { type: 'drop', soldier: cursor.source.soldier, ...fields, ...(gridNo !== undefined ? { gridNo } : {}) };
}

export function tossCommand(cursor: ItemCursor, gridNo: number, level: number): CommandEnvelope | null {
  const fields = tossFields(cursor);
  if (!fields) return null;
  return { type: 'toss', soldier: cursor.source.soldier, ...fields, gridNo, ...(level !== 0 ? { level } : {}) };
}

export function passCommand(cursor: ItemCursor, target: number): CommandEnvelope | null {
  const fields = tossFields(cursor);
  return fields ? { type: 'pass', soldier: cursor.source.soldier, ...fields, target } : null;
}

export function giveCommand(cursor: ItemCursor, target: number): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind === 'money') return { type: 'give', soldier: s.soldier, target, money: s.amount, slot: s.slot };
  if (s.kind === 'keyRing') return { type: 'give', soldier: s.soldier, target, slot: { ring: s.position }, ...countField(s.count) };
  if (s.kind !== 'slot') return null;
  return { type: 'give', soldier: s.soldier, target, slot: s.slot, ...countField(s.count) };
}

export function depositCommand(cursor: ItemCursor): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind === 'money') return { type: 'depositCash', soldier: s.soldier, slot: s.slot, amount: s.amount };
  if (s.kind === 'slot') return { type: 'depositCash', soldier: s.soldier, slot: s.slot };
  return null;
}

export function cancelCommand(cursor: ItemCursor): CommandEnvelope | null {
  const s = cursor.source;
  if (s.kind === 'attachment') return { type: 'detach', soldier: s.soldier, slot: s.slot, attachment: s.attachment };
  if (s.kind === 'magazine') return { type: 'unload', soldier: s.soldier, slot: s.slot };
  return null;
}

export function returnsToItsSlot(cursor: ItemCursor, soldier: number, slot: number): boolean {
  const s = cursor.source;
  return (s.kind === 'slot' || s.kind === 'money') && s.soldier === soldier && s.slot === slot;
}

export function cursorObjectHeld(cursor: ItemCursor, holder: SoldierView | null): boolean {
  const s = cursor.source;
  if (s.kind === 'keyRing') return (holder?.keys?.find((k) => k.position === s.position)?.count ?? 0) > 0;
  const item = slotItem(holder, s.slot);
  if (!item) return false;
  switch (s.kind) {
    case 'slot':
      return item.item === cursor.item && (s.count === 'all' || s.index < item.count);
    case 'money':
      return item.item === cursor.item && (item.money ?? 0) >= s.amount;
    case 'attachment':
      return item.attachments?.[s.attachment]?.item === cursor.item;
    case 'magazine':
      return item.ammo?.item === cursor.item && item.ammo.shots > 0;
  }
}

export function takenFrom(cursor: ItemCursor | null, soldier: number, slot: number): CursorCount | null {
  const s = cursor?.source;
  if (s?.kind !== 'slot' || s.soldier !== soldier || s.slot !== slot) return null;
  return s.count;
}

export function moneyTaken(cursor: ItemCursor | null, soldier: number, slot: number): number {
  const s = cursor?.source;
  return s?.kind === 'money' && s.soldier === soldier && s.slot === slot ? s.amount : 0;
}

export function hidesSlot(cursor: ItemCursor | null, view: InventoryItemView, soldier: number): boolean {
  const money = moneyTaken(cursor, soldier, view.slot);
  if (money > 0) return money >= (view.money ?? 0);
  const taken = takenFrom(cursor, soldier, view.slot);
  return taken === 'all' || (taken === 1 && view.count <= 1);
}

export function shownCount(cursor: ItemCursor | null, view: InventoryItemView, soldier: number): number {
  return takenFrom(cursor, soldier, view.slot) === 1 ? view.count - 1 : view.count;
}

export const REFUSAL_USE_ATTACH = 'useAttach';
export const REFUSAL_MERGE_PROMPT = 'mergePrompt';
export const REFUSAL_PERMANENT_ATTACHMENT = 'permanentAttachment';
