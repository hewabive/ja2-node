// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ShopKeeper_Interface.cc SKITryToAddInvToMercsInventory (money tops up the first MONEY pocket
// @src below MoneySlotLimit first), GetInvSlotOfUnfullMoneyInMercInventory, ShopkeeperAutoPlaceObject (chunks of
// @src MAX_OBJECTS_PER_SLOT through AutoPlaceObject). See docs/23 §9.5, §13.1.

import { ItemClass, type ItemTable } from '../../content/items/items.ts';
import { cloneObject, type ItemObject, MAX_OBJECTS_PER_SLOT } from '../items/object.ts';
import { autoPlaceObject, type Carrier, type InventoryContext, moneySlotLimit, NUM_INV_SLOTS, placeObject } from '../tactical/inventory.ts';
import { dryInventoryContext } from '../tactical/inventory-panel.ts';
import type { Soldier } from '../tactical/soldier.ts';

function unfullMoneySlot(c: Carrier, money: number): number {
  for (let pos = 0; pos < NUM_INV_SLOTS; pos++) {
    const slot = c.inv[pos];
    if (slot?.item === money && slot.money < moneySlotLimit(pos)) return pos;
  }
  return -1;
}

export function shopkeeperAutoPlaceObject(ctx: InventoryContext, c: Carrier, o: ItemObject): boolean {
  const copy = cloneObject(o);
  let left = o.count;
  while (left > 0) {
    o.count = Math.min(MAX_OBJECTS_PER_SLOT, left);
    left -= o.count;
    if (!autoPlaceObject(ctx, c, o)) {
      o.count += left;
      return false;
    }
    Object.assign(o, cloneObject(copy));
  }
  return true;
}

export function addToMercInventory(ctx: InventoryContext, c: Carrier, o: ItemObject, money: number): boolean {
  if (ctx.items.byIndex.get(o.item)?.itemClass === ItemClass.MONEY) {
    const pos = unfullMoneySlot(c, money);
    if (pos >= 0) {
      placeObject(ctx, c, pos, o);
      if (o.money === 0) return true;
    }
  }
  return shopkeeperAutoPlaceObject(ctx, c, o);
}

export function fitsInMercInventory(items: ItemTable, inCombat: boolean, s: Soldier, o: ItemObject, money: number): boolean {
  const carrier = { inv: s.inv.map(cloneObject) };
  return addToMercInventory(dryInventoryContext(items, inCombat, s), carrier, cloneObject(o), money);
}
