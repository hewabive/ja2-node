// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc TotalPoints, UseKitPoints, IsMedicalKitItem, FindObj, FindObjClass;
// @src Strategic/Assignments.cc MakeSureMedKitIsInHand, MakeSureToolKitIsInHand, TotalMedicalKitPoints, ToolKitPoints,
// @src IsItemRepairable. See docs/18 §5.6–§5.7.

import { ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../../content/items/items.ts';
import { i8, u16 } from '../../../core/int.ts';
import { deleteObject, type ItemObject, swapObjects } from '../../items/object.ts';

export const Slot = {
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
  SMALLPOCK8: 18,
} as const;
export const NO_SLOT = -1;
export const FULL_STATUS = 100;

export interface KitItems {
  readonly medicKit: number;
  readonly toolKit: number;
}

export function kitItems(items: ItemTable): KitItems {
  return { medicKit: items.byName.get('MEDICKIT')?.index ?? -1, toolKit: items.byName.get('TOOLKIT')?.index ?? -1 };
}

export function totalPoints(o: ItemObject): number {
  let points = 0;
  for (let k = 0; k < o.count; k++) points = u16(points + (o.status[k] ?? 0));
  return points;
}

export function useKitPoints(o: ItemObject, original: number): number {
  let points = u16(original);
  for (let k = o.count - 1; k >= 0; k--) {
    const status = o.status[k] ?? 0;
    if (points < status) {
      o.status[k] = i8(status - points);
      return u16(original);
    }
    points = u16(points - status);
    o.status[k] = 0;
    o.count--;
  }
  deleteObject(o);
  return u16(original - points);
}

export function findObj(inv: readonly ItemObject[], item: number): number {
  for (let slot = 0; slot < inv.length; slot++) if (inv[slot]?.item === item) return slot;
  return NO_SLOT;
}

export function findObjClass(items: ItemTable, inv: readonly ItemObject[], itemClass: number): number {
  for (let slot = 0; slot < inv.length; slot++) {
    const o = inv[slot];
    if (o && o.item !== NOTHING && ((items.byIndex.get(o.item)?.itemClass ?? 0) & itemClass) !== 0) return slot;
  }
  return NO_SLOT;
}

function swapKitIntoHand(inv: ItemObject[], kit: number): boolean {
  for (let slot = Slot.SECOND_HAND; slot <= Slot.SMALLPOCK8; slot++) {
    const o = inv[slot];
    if (o?.item !== kit) continue;
    const hand = inv[Slot.HAND];
    if (!hand) return false;
    swapObjects(hand, o);
    const second = inv[Slot.SECOND_HAND];
    if (second && second.item === NOTHING && o.item !== NOTHING) swapObjects(second, o);
    return true;
  }
  return false;
}

export function makeSureMedKitIsInHand(inv: ItemObject[], kits: KitItems): boolean {
  if (inv[Slot.HAND]?.item === kits.medicKit) return true;
  return swapKitIntoHand(inv, kits.medicKit);
}

export function makeSureToolKitIsInHand(inv: ItemObject[], kits: KitItems): void {
  if (inv[Slot.HAND]?.item !== kits.toolKit) swapKitIntoHand(inv, kits.toolKit);
}

function kitPoints(inv: readonly ItemObject[], kit: number): number {
  let points = 0;
  for (let slot = Slot.HAND; slot <= Slot.SMALLPOCK8; slot++) {
    const o = inv[slot];
    if (o?.item === kit) points = u16(points + totalPoints(o));
  }
  return points;
}

export function totalMedicalKitPoints(inv: readonly ItemObject[], kits: KitItems): number {
  return kitPoints(inv, kits.medicKit);
}

export function toolKitPoints(inv: readonly ItemObject[], kits: KitItems): number {
  return kitPoints(inv, kits.toolKit);
}

export function hasMedicalKitInPockets(inv: readonly ItemObject[], kits: KitItems): boolean {
  for (let slot = Slot.HAND; slot <= Slot.SMALLPOCK8; slot++) if (inv[slot]?.item === kits.medicKit) return true;
  return false;
}

export function isItemRepairable(items: ItemTable, item: number, status: number): boolean {
  return status < FULL_STATUS && ((items.byIndex.get(item)?.flags ?? 0) & ItemFlags.REPAIRABLE) !== 0;
}

export function isElectronic(items: ItemTable, item: number): boolean {
  return ((items.byIndex.get(item)?.flags ?? 0) & ItemFlags.ELECTRONIC) !== 0;
}

export function isGun(items: ItemTable, item: number): boolean {
  return items.byIndex.get(item)?.itemClass === ItemClass.GUN;
}
