// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc ReevaluateItemHatches; Interface_Items.cc CompatibleAmmoForGun,
// @src CompatibleGunForAmmo, CompatibleItemForApplyingOnMerc, SoldierContainsAnyCompatibleStuff,
// @src InternalHandleCompatibleAmmoUI (the slots outlined for an item in the cursor), HandleCompatibleAmmoUIForMapScreen
// @src and HandleCompatibleAmmoUIForMapInventory (the same rule for a merc's slots and the sector inventory's page on the
// @src map screen, 2026-11-03).

import { ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { validAttachment, validLaunchable } from '../../content/items/rules.ts';
import type { ItemObject } from '../items/object.ts';
import { canItemFitInPosition, type Inventory, NUM_INV_SLOTS } from './inventory.ts';
import { validMerge } from './item-merge.ts';

const APPLY_ON_MERC_ITEMS: readonly string[] = [
  'CAMOUFLAGEKIT',
  'ADRENALINE_BOOSTER',
  'REGEN_BOOSTER',
  'SYRINGE_3',
  'SYRINGE_4',
  'SYRINGE_5',
  'ALCOHOL',
  'WINE',
  'BEER',
  'CANTEEN',
  'JAR_ELIXIR',
];

function itemClassOf(items: ItemTable, item: number): number {
  return items.byIndex.get(item)?.itemClass ?? ItemClass.NONE;
}

export function compatibleAmmoForGun(items: ItemTable, tryItem: number, gun: number): boolean {
  const ammo = items.byIndex.get(tryItem);
  if (ammo?.itemClass !== ItemClass.AMMO || !ammo.magazine) return false;
  return items.byIndex.get(gun)?.weapon?.calibre === ammo.magazine.calibre;
}

export function compatibleGunForAmmo(items: ItemTable, tryItem: number, ammo: number): boolean {
  if (itemClassOf(items, tryItem) !== ItemClass.GUN) return false;
  return items.byIndex.get(tryItem)?.weapon?.calibre === items.byIndex.get(ammo)?.magazine?.calibre;
}

export function compatibleItemForApplyingOnMerc(items: ItemTable, item: number, mapScreen: boolean): boolean {
  if (mapScreen) return false;
  return APPLY_ON_MERC_ITEMS.includes(items.byIndex.get(item)?.name ?? '');
}

export function invalidPlacementSlots(items: ItemTable, inv: Inventory, cursor: ItemObject): boolean[] {
  return Array.from({ length: NUM_INV_SLOTS }, (_, slot) => {
    const slotItem = inv[slot]?.item ?? NOTHING;
    if (validAttachment(items, cursor.item, slotItem) || validMerge(items, cursor.item, slotItem)) return false;
    return !canItemFitInPosition(items, inv, cursor, slot, false);
  });
}

function attachOrLaunchCompatible(items: ItemTable, a: number, b: number): boolean {
  return validAttachment(items, a, b) || validAttachment(items, b, a) || validLaunchable(items, b, a) || validLaunchable(items, a, b);
}

export function compatibleWithItem(items: ItemTable, candidate: number, testItem: number): boolean {
  const cls = itemClassOf(items, testItem);
  const hidden = ((items.byIndex.get(candidate)?.flags ?? 0) & ItemFlags.HIDDEN_ADDON) !== 0;
  if (!hidden && attachOrLaunchCompatible(items, candidate, testItem)) return true;
  if (cls === ItemClass.GUN) return compatibleAmmoForGun(items, candidate, testItem);
  if (cls === ItemClass.AMMO) return compatibleGunForAmmo(items, candidate, testItem);
  return false;
}

export function compatibleSlots(items: ItemTable, inv: Inventory, cursorItem: number): boolean[] {
  return Array.from({ length: NUM_INV_SLOTS }, (_, slot) => compatibleWithItem(items, inv[slot]?.item ?? NOTHING, cursorItem));
}

export function soldierContainsAnyCompatibleStuff(items: ItemTable, inv: Inventory, cursorItem: number): boolean {
  const cls = itemClassOf(items, cursorItem);
  if (cls & ItemClass.GUN) return inv.some((o) => compatibleAmmoForGun(items, o.item, cursorItem));
  if (cls & ItemClass.AMMO) return inv.some((o) => compatibleGunForAmmo(items, o.item, cursorItem));
  return false;
}
