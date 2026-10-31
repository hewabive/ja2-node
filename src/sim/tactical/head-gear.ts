// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/externalized/Soldier.cc Soldier::switchHeadGear (HEAD_GEARS_DAY, HEAD_GEARS_NIGHT; the gear named "from" is
// @src the one put on: putDayHeadGear puts on the night gear), getFreeHeadSlot, getFreePocket, showGearEquipMessage,
// @src showGearRemoveMessage; the helmet branches of extra_attachments, off by default, are not ported.

import { NOTHING } from '../../content/items/items.ts';
import { type ItemObject, swapObjects } from '../items/object.ts';
import { InvSlot, NUM_INV_SLOTS, wearsHeadGear } from './inventory.ts';
import { SightFlags } from './perception/opp.ts';
import { handleSight } from './perception/sight.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export type HeadGear = 'day' | 'night';

const GEARS: Readonly<Record<HeadGear, readonly string[]>> = {
  day: ['SUNGOGGLES'],
  night: ['UVGOGGLES', 'NIGHTGOGGLES'],
};
const OTHER_GEAR: Readonly<Record<HeadGear, HeadGear>> = { day: 'night', night: 'day' };
const EYE_GEAR_BLOCKERS: readonly string[] = ['GASMASK', 'ROBOT_REMOTE_CONTROL'];
const FREE_POCKETS: readonly number[] = [
  InvSlot.SMALLPOCK1,
  InvSlot.SMALLPOCK2,
  InvSlot.SMALLPOCK3,
  InvSlot.SMALLPOCK4,
  InvSlot.SMALLPOCK5,
  InvSlot.SMALLPOCK6,
  InvSlot.SMALLPOCK7,
  InvSlot.SMALLPOCK8,
  InvSlot.BIGPOCK1,
  InvSlot.BIGPOCK2,
  InvSlot.BIGPOCK3,
  InvSlot.BIGPOCK4,
];
const HEAD_SLOTS: readonly number[] = [InvSlot.HEAD1, InvSlot.HEAD2];
const NO_SLOT = -1;

function itemsNamed(t: TacticalState, names: readonly string[]): number[] {
  return names.flatMap((name) => t.content.items.byName.get(name)?.index ?? []);
}

function firstSlotHolding(s: Soldier, item: number): number {
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) if (s.inv[slot]?.item === item) return slot;
  return NO_SLOT;
}

function wantedGearSlot(t: TacticalState, s: Soldier, gear: HeadGear): number {
  for (const item of itemsNamed(t, GEARS[gear])) {
    const slot = firstSlotHolding(s, item);
    if (slot !== NO_SLOT) return slot;
  }
  return NO_SLOT;
}

function wornGearSlot(t: TacticalState, s: Soldier, gear: HeadGear): number {
  let worn = NO_SLOT;
  for (const item of itemsNamed(t, GEARS[OTHER_GEAR[gear]])) for (const slot of HEAD_SLOTS) if (s.inv[slot]?.item === item) worn = slot;
  return worn;
}

function firstEmpty(s: Soldier, slots: readonly number[]): number {
  return slots.find((slot) => s.inv[slot]?.item === NOTHING) ?? NO_SLOT;
}

function inventoryObject(s: Soldier, slot: number): ItemObject {
  const o = s.inv[slot];
  if (!o) throw new Error(`no inventory slot ${slot}`);
  return o;
}

function changed(t: TacticalState, s: Soldier, item: number, on: boolean): void {
  t.events.push({ type: 'headGearChanged', soldier: s.id, item, on });
}

export function switchHeadGear(t: TacticalState, s: Soldier, gear: HeadGear): void {
  if (itemsNamed(t, EYE_GEAR_BLOCKERS).some((item) => wearsHeadGear(s.inv, item))) return;
  const wanted = wantedGearSlot(t, s, gear);
  const worn = wornGearSlot(t, s, gear);
  const head = worn === NO_SLOT ? firstEmpty(s, HEAD_SLOTS) : worn;
  if (head === NO_SLOT) return;
  const current = inventoryObject(s, head);
  if (wanted !== NO_SLOT) {
    const optimal = inventoryObject(s, wanted);
    changed(t, s, optimal.item, true);
    swapObjects(optimal, current);
    handleSight(t, s, SightFlags.LOOK);
    return;
  }
  if (current.item === NOTHING) return;
  const pocket = firstEmpty(s, FREE_POCKETS);
  if (pocket === NO_SLOT) return;
  changed(t, s, current.item, false);
  swapObjects(current, inventoryObject(s, pocket));
}
