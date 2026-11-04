// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc CleanUpStack (ammo, kits and medkits only; the cursor's points first, then the stack's own,
// @src each object's points moved down to the lower objects, an emptied object dropped from the top of the count);
// @src Interface_Panels.cc UIHandleItemPlacement and SMInvClickCallbackPrimary (CTRL+click, free: without a cursor on
// @src a stack after Nails' vest, with one after the 3 AP check of both mercs when the cursor is another merc's, Nails'
// @src vest and the attach or merge of a hand or armour slot; the cursor's objects of the same item are pooled whoever
// @src holds them and from wherever they came, the clicked stack's own included, and what is left stays in the cursor,
// @src 2026-11-03: a gun's magazine taken out in the description box pours its rounds, an attachment or keys off the ring
// @src never do); src/game/Strategic/MapScreen.cc MAPInvClickCallbackPrimary (on the map Nails' vest, then CTRL before
// @src any attach or merge, 2026-11-03).

import { ItemClass, type ItemTable, NOTHING } from '../../content/items/items.ts';
import {
  cloneObject,
  copyObjectInto,
  deleteObject,
  emptyWeaponMagazine,
  getObjFrom,
  type ItemObject,
  removeObjectAt,
  stackObjects,
} from '../items/object.ts';
import { itemIn } from './inventory.ts';
import { attachOrMergeAt, nailsRefuses, type PanelEnv, type PanelOutcome, PanelRefusal, transferCheckRefusal } from './inventory-panel.ts';
import type { Soldier } from './soldier.ts';

const KIT_POINTS = 100;

function maxPointsOf(items: ItemTable, item: number): number | null {
  const def = items.byIndex.get(item);
  if (!def) return null;
  if (def.itemClass === ItemClass.AMMO) return def.magazine?.capacity ?? null;
  if (def.itemClass === ItemClass.KIT || def.itemClass === ItemClass.MEDKIT) return KIT_POINTS;
  return null;
}

function moveDown(target: ItemObject, from: number, below: number, source: ItemObject, max: number): void {
  let points = source.status[from] ?? 0;
  if (points <= 0) return;
  for (let k = below; k >= 0; k--) {
    const have = target.status[k] ?? 0;
    if (have >= max) continue;
    const moved = Math.min(max - have, points);
    target.status[k] = have + moved;
    points -= moved;
    source.status[from] = points;
    if (points !== 0) continue;
    source.count--;
    return;
  }
}

function clearBeyondCount(o: ItemObject): void {
  for (let k = o.count; k < o.status.length; k++) o.status[k] = 0;
}

export function cleanUpStack(items: ItemTable, o: ItemObject, cursor: ItemObject | null): boolean {
  const max = maxPointsOf(items, o.item);
  if (max === null) return false;
  if (cursor && cursor.item === o.item) {
    for (let i = cursor.count - 1; i >= 0; i--) moveDown(o, i, o.count - 1, cursor, max);
    clearBeyondCount(cursor);
    if (cursor.count === 0) deleteObject(cursor);
  }
  for (let i = o.count - 1; i >= 0; i--) moveDown(o, i, i - 1, o, max);
  clearBeyondCount(o);
  return true;
}

export type CombineCursor =
  | { readonly slot: number; readonly index: number | null }
  | { readonly magazine: number }
  | { readonly outside: ItemObject };

export interface CombineRequest {
  readonly holder: Soldier;
  readonly owner: Soldier;
  readonly slot: number;
  readonly cursor: CombineCursor | null;
}

const refuse = (refusal: PanelRefusal): PanelOutcome => ({ ok: false, refusal });

function cursorItemOf(holder: Soldier, cursor: CombineCursor | null): number {
  if (!cursor) return NOTHING;
  if ('outside' in cursor) return cursor.outside.item;
  if ('magazine' in cursor) return holder.inv[cursor.magazine]?.gunAmmoItem ?? NOTHING;
  return itemIn(holder.inv, cursor.slot);
}

function cursorMissing(holder: Soldier, cursor: CombineCursor | null): boolean {
  if (!cursor || 'outside' in cursor) return false;
  if ('magazine' in cursor) return (holder.inv[cursor.magazine]?.gunShotsLeft ?? 0) <= 0;
  return itemIn(holder.inv, cursor.slot) === NOTHING;
}

function takesFromClickedStack(req: CombineRequest): req is CombineRequest & { cursor: { slot: number; index: number | null } } {
  const cursor = req.cursor;
  return cursor !== null && 'slot' in cursor && req.holder === req.owner && cursor.slot === req.slot;
}

function itemLeftInClickedSlot(req: CombineRequest): number {
  const item = itemIn(req.owner.inv, req.slot);
  if (!takesFromClickedStack(req)) return item;
  return req.cursor.index === null || (req.owner.inv[req.slot]?.count ?? 0) <= 1 ? NOTHING : item;
}

function cursorPart(o: ItemObject, index: number | null): ItemObject {
  if (index === null) return o;
  const one = cloneObject(o);
  one.count = 1;
  one.status = [o.status[index] ?? 0];
  return one;
}

function returnCursorPart(source: ItemObject, index: number | null, cursor: ItemObject): void {
  if (index === null || cursor === source) return;
  if (cursor.count === 0) removeObjectAt(source, index);
  else source.status[index] = cursor.status[0] ?? 0;
}

function combineFromPocket(env: PanelEnv, req: CombineRequest, slot: number, index: number | null): PanelOutcome {
  const source = req.holder.inv[slot] as ItemObject;
  const sourceItem = source.item;
  const cursor = cursorPart(source, index);
  const combined = cleanUpStack(env.items, req.owner.inv[req.slot] as ItemObject, cursor);
  returnCursorPart(source, index, cursor);
  if (source.count === 0) env.equipmentChanged(req.holder, slot, sourceItem, NOTHING);
  return { ok: true, data: { combined, left: cursor.count } };
}

function combineWithinStack(env: PanelEnv, stack: ItemObject, index: number): PanelOutcome {
  const rest = cloneObject(stack);
  const cursor = getObjFrom(env.items, rest, index) as ItemObject;
  if (!cleanUpStack(env.items, rest, cursor)) return { ok: true, data: { combined: false, left: 1, index } };
  const left = cursor.count;
  if (left > 0) stackObjects(cursor, rest, left);
  copyObjectInto(stack, rest);
  return { ok: true, data: { combined: true, left, ...(left > 0 ? { index: stack.count - 1 } : {}) } };
}

function combineMagazine(env: PanelEnv, req: CombineRequest, gunSlot: number): PanelOutcome {
  const gun = req.holder.inv[gunSlot] as ItemObject;
  const magazine = emptyWeaponMagazine(cloneObject(gun)) as ItemObject;
  const combined = cleanUpStack(env.items, req.owner.inv[req.slot] as ItemObject, magazine);
  if (magazine.count > 0) gun.gunShotsLeft = magazine.status[0] ?? 0;
  else emptyWeaponMagazine(gun);
  return { ok: true, data: { combined, left: magazine.count } };
}

function combineCursor(env: PanelEnv, req: CombineRequest, cursor: CombineCursor): PanelOutcome {
  if ('outside' in cursor) {
    const combined = cleanUpStack(env.items, req.owner.inv[req.slot] as ItemObject, cursor.outside);
    return { ok: true, data: { combined, left: cursor.outside.count } };
  }
  if ('magazine' in cursor) return combineMagazine(env, req, cursor.magazine);
  if (!takesFromClickedStack(req)) return combineFromPocket(env, req, cursor.slot, cursor.index);
  const stack = req.owner.inv[req.slot] as ItemObject;
  if (cursor.index === null || stack.count <= 1) return { ok: true, data: { combined: false, left: stack.count } };
  return combineWithinStack(env, stack, cursor.index);
}

function attachOrMergeFirst(env: PanelEnv, req: CombineRequest, cursorItem: number): PanelRefusal | null {
  if (!req.cursor || env.mapScreen) return null;
  return attachOrMergeAt(env, req.slot, itemLeftInClickedSlot(req), cursorItem, undefined);
}

export function combineStacks(env: PanelEnv, req: CombineRequest): PanelOutcome {
  const { holder, owner, slot, cursor } = req;
  if (cursorMissing(holder, cursor)) return refuse(PanelRefusal.EMPTY_SLOT);
  if (!cursor && itemIn(owner.inv, slot) === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  const transfer = cursor ? transferCheckRefusal(env, holder, owner) : null;
  if (transfer) return refuse(transfer);
  const cursorItem = cursorItemOf(holder, cursor);
  if (nailsRefuses(env.items, owner, slot, cursorItem)) return refuse(PanelRefusal.NAILS_VEST);
  const attach = attachOrMergeFirst(env, req, cursorItem);
  if (attach) return refuse(attach);
  if (!cursor) return { ok: true, data: { combined: cleanUpStack(env.items, owner.inv[slot] as ItemObject, null) } };
  if (itemIn(owner.inv, slot) === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  return combineCursor(env, req, cursor);
}
