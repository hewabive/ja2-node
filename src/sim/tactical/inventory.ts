// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.h InvSlotPos; Soldier_Create.cc gubItemDroppableFlag, CopyProfileItems;
// @src Items.cc MoneySlotLimit, FindEmptySlotWithin

import type { MercProfile } from '../../content/formats/prof.ts';
import { ItemClass, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { createItems, createMoney, type ItemObject, MAX_MONEY_PER_SLOT, ObjectFlags } from '../items/object.ts';

export const InvSlot = {
  HELMET: 0,
  VEST: 1,
  LEGS: 2,
  HEAD1: 3,
  HEAD2: 4,
  HAND: 5,
  SECOND_HAND: 6,
  BIGPOCK1: 7,
  BIGPOCK2: 8,
  BIGPOCK3: 9,
  BIGPOCK4: 10,
  SMALLPOCK1: 11,
  SMALLPOCK2: 12,
  SMALLPOCK3: 13,
  SMALLPOCK4: 14,
  SMALLPOCK5: 15,
  SMALLPOCK6: 16,
  SMALLPOCK7: 17,
  SMALLPOCK8: 18,
} as const;

export const NUM_INV_SLOTS = 19;
export const NO_SLOT = -1;

const DROPPABLE_FLAG = [0x01, 0x02, 0x04, 0, 0, 0x08, 0, 0x10, 0x20, 0x40, 0x80, 0, 0, 0, 0, 0, 0, 0, 0];
const IMPRINTED_ON_CREATION: ReadonlySet<string> = new Set(['ROCKET_RIFLE', 'AUTO_ROCKET_RIFLE']);

export type Inventory = (ItemObject | null)[];

export function emptyInventory(): Inventory {
  return Array.from({ length: NUM_INV_SLOTS }, () => null);
}

export function itemIn(inv: Inventory, slot: number): number {
  return inv[slot]?.item ?? NOTHING;
}

export function moneySlotLimit(slot: number): number {
  return slot >= InvSlot.SMALLPOCK1 ? MAX_MONEY_PER_SLOT / 2 : MAX_MONEY_PER_SLOT;
}

export function findEmptySlotWithin(inv: Inventory, from: number, to: number): number {
  for (let slot = from; slot <= to; slot++) if (!inv[slot]) return slot;
  return NO_SLOT;
}

export function profileInventory(items: ItemTable, profile: MercProfile): Inventory {
  const inv = emptyInventory();
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) {
    const item = profile.inventory[slot] ?? NOTHING;
    const def = items.byIndex.get(item);
    if (item === NOTHING || !def || def.itemClass === ItemClass.KEY) continue;
    const o = createItems(items, item, profile.inventoryStatus[slot] ?? 100, profile.inventoryCount[slot] ?? 1);
    if (IMPRINTED_ON_CREATION.has(def.name)) o.imprintId = profile.id;
    if (profile.inventoryUndroppable & (DROPPABLE_FLAG[slot] ?? 0)) o.flags |= ObjectFlags.UNDROPPABLE;
    inv[slot] = o;
  }
  for (let left = profile.money; left > 0; ) {
    const slot = findEmptySlotWithin(inv, InvSlot.BIGPOCK1, InvSlot.SMALLPOCK8);
    if (slot === NO_SLOT) break;
    const amount = Math.min(left, moneySlotLimit(slot));
    inv[slot] = createMoney(items, amount);
    left -= amount;
  }
  return inv;
}

export function objectWeight(items: ItemTable, o: ItemObject): number {
  const def = items.byIndex.get(o.item);
  if (!def) return 0;
  let grams = 100 * def.weight;
  if (def.perPocket <= 1) {
    for (const a of o.attachments) grams += 100 * (items.byIndex.get(a.item)?.weight ?? 0);
    if (def.itemClass === ItemClass.GUN && o.gunShotsLeft > 0) grams += 100 * (items.byIndex.get(o.gunAmmoItem)?.weight ?? 0);
  }
  return def.perPocket > 1 ? grams * o.count : grams;
}

export function carriedWeightPercent(items: ItemTable, inv: Inventory, effectiveStrength: number): number {
  let grams = 0;
  for (const o of inv) if (o) grams += objectWeight(items, o);
  const strength = effectiveStrength > 80 ? (effectiveStrength + effectiveStrength - 80) & 0xff : effectiveStrength;
  return Math.trunc((100 * grams) / (strength * 500));
}
