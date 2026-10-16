// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc AutoReload, FindAmmoToReload, FindAmmo, FindObjExcludingSlot, FindObjClass;
// @src Soldier_Control.cc IsValidSecondHandShotForReloadingPurposes. See docs/19 §2.8.1.

import { ItemClass, type ItemTable, NOTHING } from '../../../content/items/items.ts';
import { type ItemObject, USABLE_STATUS } from '../../items/object.ts';
import { apsToReloadGunWithAmmo, type Carrier, type InventoryContext, InvSlot, NO_SLOT, NUM_INV_SLOTS, reloadGun } from '../inventory.ts';
import { enoughPoints } from '../points.ts';
import type { Soldier } from '../soldier.ts';

const ANY_MAGSIZE = -1;

export function findObjClass(items: ItemTable, c: Carrier, itemClass: number): number {
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) {
    if ((items.byIndex.get(c.inv[slot]?.item ?? NOTHING)?.itemClass ?? ItemClass.NONE) & itemClass) return slot;
  }
  return NO_SLOT;
}

function findObjExcludingSlot(c: Carrier, item: number, excludeSlot: number): number {
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) if (slot !== excludeSlot && c.inv[slot]?.item === item) return slot;
  return NO_SLOT;
}

function findAmmo(items: ItemTable, c: Carrier, calibre: number, magSize: number, excludeSlot: number): number {
  for (let slot: number = InvSlot.HAND; slot < NUM_INV_SLOTS; slot++) {
    if (slot === excludeSlot) continue;
    const def = items.byIndex.get(c.inv[slot]?.item ?? NOTHING);
    if (def?.itemClass !== ItemClass.AMMO || !def.magazine) continue;
    if (def.magazine.calibre !== calibre) continue;
    if (def.magazine.capacity !== magSize && magSize !== ANY_MAGSIZE) continue;
    return slot;
  }
  return NO_SLOT;
}

function findLaunchableAmmo(items: ItemTable, c: Carrier, calibre: string): number {
  for (const def of items.ordered) {
    if (def.explosive?.calibre !== calibre) continue;
    const slot = findObjExcludingSlot(c, def.index, NO_SLOT);
    if (slot !== NO_SLOT) return slot;
  }
  return NO_SLOT;
}

export function findAmmoToReload(items: ItemTable, c: Carrier, weaponSlot: number, excludeSlot: number): number {
  const gun = c.inv[weaponSlot] as ItemObject;
  const def = items.byIndex.get(gun.item);
  const weapon = def?.weapon;
  if (!def || !weapon) return NO_SLOT;
  if (weapon.explosiveCalibre) return findLaunchableAmmo(items, c, weapon.explosiveCalibre);
  if (def.itemClass !== ItemClass.GUN) return NO_SLOT;
  const same = findObjExcludingSlot(c, gun.gunAmmoItem, excludeSlot);
  if (same !== NO_SLOT) return same;
  const sized = findAmmo(items, c, weapon.calibre, weapon.magSize, excludeSlot);
  return sized !== NO_SLOT ? sized : findAmmo(items, c, weapon.calibre, ANY_MAGSIZE, excludeSlot);
}

export function isValidSecondHandShotForReloading(items: ItemTable, s: Soldier): boolean {
  const second = s.inv[InvSlot.SECOND_HAND] as ItemObject;
  return (
    items.byIndex.get(second.item)?.itemClass === ItemClass.GUN &&
    !s.doBurst &&
    items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? NOTHING)?.itemClass === ItemClass.GUN &&
    (second.status[0] ?? 0) >= USABLE_STATUS
  );
}

function reloadSecondHand(ctx: InventoryContext, s: Soldier): boolean {
  const gun = s.inv[InvSlot.SECOND_HAND] as ItemObject;
  const slot = findAmmoToReload(ctx.items, s, InvSlot.SECOND_HAND, NO_SLOT);
  if (slot === NO_SLOT) return true;
  const ammo = s.inv[slot] as ItemObject;
  if (!enoughPoints(ctx.inCombat, s, apsToReloadGunWithAmmo(ctx.items, gun, ammo))) return true;
  return reloadGun(ctx, s, gun, ammo);
}

export function autoReload(ctx: InventoryContext, s: Soldier): boolean {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const cls = ctx.items.byIndex.get(hand.item)?.itemClass;
  if (cls !== ItemClass.GUN && cls !== ItemClass.LAUNCHER) return false;
  const slot = findAmmoToReload(ctx.items, s, InvSlot.HAND, NO_SLOT);
  if (slot === NO_SLOT) return false;
  const reloaded = reloadGun(ctx, s, hand, s.inv[slot] as ItemObject);
  if (reloaded && isValidSecondHandShotForReloading(ctx.items, s)) return reloadSecondHand(ctx, s);
  return reloaded;
}
