// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc HasObjectImprint; Tactical/Interface_Items.cc INVRenderItem (a jammed gun has a
// @src negative bGunAmmoStatus).

import { ItemClass, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { type ItemObject, NO_PROFILE } from '../items/object.ts';
import type { Inventory } from './inventory.ts';

export interface InventoryItemView {
  readonly slot: number;
  readonly item: string;
  readonly index: number;
  readonly count: number;
  readonly status: readonly number[];
  readonly ammo?: { readonly item: string; readonly shots: number };
  readonly attachments?: readonly { readonly item: string; readonly status: number }[];
  readonly money?: number;
  readonly keyId?: number;
  readonly jammed?: true;
  readonly imprint?: number;
}

const IMPRINTABLE_ITEMS = ['ROCKET_RIFLE', 'AUTO_ROCKET_RIFLE'];

export function itemJammed(items: ItemTable, o: ItemObject): boolean {
  return items.byIndex.get(o.item)?.itemClass === ItemClass.GUN && o.gunAmmoStatus < 0;
}

export function itemImprint(items: ItemTable, o: ItemObject): number | null {
  if (o.item === NOTHING || o.imprintId === NO_PROFILE) return null;
  return IMPRINTABLE_ITEMS.includes(items.byIndex.get(o.item)?.name ?? '') ? o.imprintId : null;
}

function itemName(items: ItemTable, index: number): string {
  return items.byIndex.get(index)?.name ?? String(index);
}

export function slotView(items: ItemTable, slot: number, o: ItemObject): InventoryItemView {
  const def = items.byIndex.get(o.item);
  const imprint = itemImprint(items, o);
  const attachments = o.attachments.filter((a) => a.item !== NOTHING).map((a) => ({ item: itemName(items, a.item), status: a.status }));
  return {
    slot,
    item: itemName(items, o.item),
    index: o.item,
    count: o.count,
    status: o.status.slice(0, Math.max(1, o.count)),
    ...(def?.weapon && o.gunAmmoItem !== NOTHING ? { ammo: { item: itemName(items, o.gunAmmoItem), shots: o.gunShotsLeft } } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(def?.itemClass === ItemClass.MONEY && o.money > 0 ? { money: o.money } : {}),
    ...(def?.itemClass === ItemClass.KEY ? { keyId: o.keyId } : {}),
    ...(itemJammed(items, o) ? { jammed: true as const } : {}),
    ...(imprint !== null ? { imprint } : {}),
  };
}

export function inventoryView(items: ItemTable, inv: Inventory): InventoryItemView[] {
  const out: InventoryItemView[] = [];
  inv.forEach((o, slot) => {
    if (o.item !== NOTHING) out.push(slotView(items, slot, o));
  });
  return out;
}

export function sameInventory(a: readonly InventoryItemView[] | undefined, b: readonly InventoryItemView[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => JSON.stringify(v) === JSON.stringify(b[i]));
}
