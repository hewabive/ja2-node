// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Item_Types.h DetonatorType, PANIC_FREQUENCY, FIRST_MAP_PLACED_FREQUENCY, OBJECT_DISABLED_BOMB and
// @src the bomb fields of OBJECTTYPE (bBombStatus,
// @src bDetonatorType, usBombItem, bDelay/bFrequency, ubBombOwner, bActionValue, ubTolerance in the union at byte 4,
// @src LoadSaveObjectType.cc ExtractObject); Action_Items.h ItemActionType; Items.cc ArmBomb.

import { i8, u8, u16, u32 } from '../../../core/int.ts';
import { findAttachment, type ItemObject, ObjectFlags } from '../../items/object.ts';
import type { TacticalState } from '../state.ts';

export const Detonator = { TIMED: 1, REMOTE: 2, PRESSURE: 3, SWITCH: 4 } as const;

export const ItemAction = {
  OPEN_DOOR: 1,
  CLOSE_DOOR: 2,
  BLOW_UP: 3,
  SMALL_PIT: 4,
  LARGE_PIT: 5,
  TOGGLE_DOOR: 6,
  TOGGLE_ACTION1: 7,
  TOGGLE_ACTION2: 8,
  TOGGLE_ACTION3: 9,
  TOGGLE_ACTION4: 10,
  ENTER_BROTHEL: 11,
  EXIT_BROTHEL: 12,
  KINGPIN_ALARM: 13,
  SEX: 14,
  REVEAL_ROOM: 15,
  LOCAL_ALARM: 16,
  GLOBAL_ALARM: 17,
  KLAXON: 18,
  UNLOCK_DOOR: 19,
  TOGGLE_LOCK: 20,
  UNTRAP_DOOR: 21,
  TOGGLE_PRESSURE_ITEMS: 22,
  MUSEUM_ALARM: 23,
  BLOODCAT_ALARM: 24,
} as const;

export const PANIC_FREQUENCY = 127;
export const FIRST_MAP_PLACED_FREQUENCY = 50;

const LOW_BYTE = 0xff;
const OWNER_SHIFT = 8;
const TOLERANCE_SHIFT = 24;
const NO_FREQUENCY = 0;
const SOLDIER_OWNER_OFFSET = 2;

export function bombStatusOf(o: ItemObject): number {
  return i8(o.status[0] ?? 0);
}

export function detonatorOf(o: ItemObject): number {
  return i8(o.gunAmmoType);
}

export function setDetonator(o: ItemObject, detonator: number): void {
  o.gunAmmoType = u8(detonator);
}

export function bombItemOf(o: ItemObject): number {
  return u16(o.gunShotsLeft);
}

export function setBombItem(o: ItemObject, item: number): void {
  o.gunShotsLeft = u16(item);
}

export function frequencyOf(o: ItemObject): number {
  return i8(o.money & LOW_BYTE);
}

export const delayOf = frequencyOf;

export function setFrequency(o: ItemObject, frequency: number): void {
  o.money = u32((o.money & ~LOW_BYTE) | u8(frequency));
}

export const setDelay = setFrequency;

export function bombOwnerOf(o: ItemObject): number {
  return u8(o.money >>> OWNER_SHIFT);
}

export function placedBySoldier(o: ItemObject): boolean {
  return bombOwnerOf(o) >= SOLDIER_OWNER_OFFSET;
}

export function bombOwnerIdOf(o: ItemObject): number | null {
  return placedBySoldier(o) ? bombOwnerOf(o) - SOLDIER_OWNER_OFFSET : null;
}

export function setBombOwner(o: ItemObject, owner: number): void {
  o.money = u32((o.money & ~(LOW_BYTE << OWNER_SHIFT)) | (u8(owner) << OWNER_SHIFT));
}

export function actionValueOf(o: ItemObject): number {
  return u8(o.keyId);
}

export function setActionValue(o: ItemObject, action: number): void {
  o.keyId = u8(action);
}

export function toleranceOf(o: ItemObject): number {
  return u8(o.money >>> TOLERANCE_SHIFT);
}

export function isDisabledBomb(o: ItemObject): boolean {
  return (o.flags & ObjectFlags.DISABLED_BOMB) !== 0;
}

export function toggleDisabledBomb(o: ItemObject): void {
  o.flags ^= ObjectFlags.DISABLED_BOMB;
}

export function clearDisabledBomb(o: ItemObject): void {
  o.flags &= ~ObjectFlags.DISABLED_BOMB;
}

type BombKind = 'remote' | 'pressure' | 'timed' | 'switch';

function itemIndex(t: Pick<TacticalState, 'content'>, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -1;
}

export function isPit(o: ItemObject): boolean {
  const action = actionValueOf(o);
  return action === ItemAction.SMALL_PIT || action === ItemAction.LARGE_PIT;
}

function bombKind(t: Pick<TacticalState, 'content'>, o: ItemObject, setting: number): BombKind | null {
  if (o.item === itemIndex(t, 'ACTION_ITEM')) return isPit(o) ? 'pressure' : 'remote';
  if (findAttachment(o, itemIndex(t, 'DETONATOR')) !== -1) return 'timed';
  if (findAttachment(o, itemIndex(t, 'REMDETONATOR')) !== -1) return 'remote';
  if (t.content.items.byIndex.get(o.item)?.explosive?.pressureTriggered) return 'pressure';
  if (o.item === itemIndex(t, 'SWITCH')) return setting === PANIC_FREQUENCY ? 'switch' : 'pressure';
  return null;
}

export function armBomb(t: Pick<TacticalState, 'content' | 'inCombat'>, o: ItemObject, setting: number): boolean {
  const kind = bombKind(t, o, setting);
  if (kind === null) return false;
  if (kind === 'remote') {
    setDetonator(o, Detonator.REMOTE);
    setFrequency(o, setting);
  } else if (kind === 'pressure') {
    setDetonator(o, Detonator.PRESSURE);
    setFrequency(o, NO_FREQUENCY);
  } else if (kind === 'timed') {
    setDetonator(o, Detonator.TIMED);
    setDelay(o, t.inCombat ? setting : i8(setting + 1));
  } else {
    setDetonator(o, Detonator.SWITCH);
    setFrequency(o, setting);
  }
  o.flags |= ObjectFlags.ARMED_BOMB;
  setBombItem(o, o.item);
  return true;
}
