import { type ItemTable, NOTHING } from '../../content/items/items.ts';
import type { ItemObject } from '../items/object.ts';
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
}

function itemName(items: ItemTable, index: number): string {
  return items.byIndex.get(index)?.name ?? String(index);
}

function slotView(items: ItemTable, slot: number, o: ItemObject): InventoryItemView {
  const def = items.byIndex.get(o.item);
  const attachments = o.attachments.filter((a) => a.item !== NOTHING).map((a) => ({ item: itemName(items, a.item), status: a.status }));
  return {
    slot,
    item: itemName(items, o.item),
    index: o.item,
    count: o.count,
    status: o.status.slice(0, Math.max(1, o.count)),
    ...(def?.weapon && o.gunAmmoItem !== NOTHING ? { ammo: { item: itemName(items, o.gunAmmoItem), shots: o.gunShotsLeft } } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(o.money > 0 ? { money: o.money } : {}),
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
