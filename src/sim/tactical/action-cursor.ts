// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/UI_Cursors.cc GetActionModeCursor (no cursor for an escort, a vehicle or a robot out of
// @src control, the toss cursor in attached mode, the bomb cursor for an item with a detonator, no cursor in deep water
// @src or collapsed); Handle_Items.cc IsDetonatorAttached.

import { ItemCursor, NOTHING } from '../../content/items/items.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { findAttachment, type ItemObject } from '../items/object.ts';
import { WeaponMode } from './combat/types.ts';
import { InvSlot } from './inventory.ts';
import { uncontrolledRobot } from './narrative/robot.ts';
import { Body, OKBREATH, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

function itemIndex(t: Pick<TacticalState, 'content'>, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -2;
}

export function isDetonatorAttached(t: Pick<TacticalState, 'content'>, o: ItemObject): boolean {
  return findAttachment(o, itemIndex(t, 'DETONATOR')) !== -1 || findAttachment(o, itemIndex(t, 'REMDETONATOR')) !== -1;
}

export function itemCursorOf(t: Pick<TacticalState, 'content'>, item: number): number {
  return t.content.items.byIndex.get(item)?.cursor ?? ItemCursor.INVALID;
}

export function actionModeCursor(t: TacticalState, s: Soldier, isEpc: boolean): number {
  if (isEpc && s.bodyType !== Body.ROBOTNOWEAPON) return ItemCursor.INVALID;
  if (isVehicle(s) || uncontrolledRobot(t, s)) return ItemCursor.INVALID;
  if (s.weaponMode === WeaponMode.ATTACHED) return ItemCursor.TRAJECTORY;
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  if (hand.item === NOTHING) return ItemCursor.PUNCH;
  let cursor = itemCursorOf(t, hand.item);
  if (cursor === ItemCursor.INVALID && isDetonatorAttached(t, hand)) cursor = ItemCursor.BOMB;
  if (s.overTerrain === Terrain.DEEP_WATER) cursor = ItemCursor.INVALID;
  if (s.breath < OKBREATH && s.collapsed) cursor = ItemCursor.INVALID;
  return cursor;
}
