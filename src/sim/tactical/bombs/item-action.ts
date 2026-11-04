// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc PerformItemAction (every action but the pits),
// @src ToggleActionItemsByFrequency, TogglePressureActionItemsInGridNo.

import { has, StructureFlags } from '../../../content/world/structures.ts';
import type { ItemObject } from '../../items/object.ts';
import { disarmDoorTrap, findDoorInfo, updateDoor } from '../doors/door-table.ts';
import { callAvailableEnemiesTo, callAvailableTeamEnemiesTo } from '../doors/door-traps.ts';
import { handleDoorChangeFromGridNo } from '../doors.ts';
import { kingpinAlarm, museumAlarm, sexActionItem } from '../narrative/quest-items.ts';
import { removeHiddenRoomRoofAt } from '../perception/fov.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import { Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import {
  actionValueOf,
  clearDisabledBomb,
  Detonator,
  detonatorOf,
  FIRST_MAP_PLACED_FREQUENCY,
  frequencyOf,
  ItemAction,
  toggleDisabledBomb,
} from './bomb-object.ts';
import { worldBombItems } from './world-bombs.ts';

type DoorChange = 'open' | 'close' | 'toggle';

const LOCAL_ALARM_VOLUME = 30;
const GROUND_LEVEL = 0;

const TOGGLED_FREQUENCIES: ReadonlyMap<number, number> = new Map([
  [ItemAction.TOGGLE_ACTION1, FIRST_MAP_PLACED_FREQUENCY + 1],
  [ItemAction.TOGGLE_ACTION2, FIRST_MAP_PLACED_FREQUENCY + 2],
  [ItemAction.TOGGLE_ACTION3, FIRST_MAP_PLACED_FREQUENCY + 3],
  [ItemAction.TOGGLE_ACTION4, FIRST_MAP_PLACED_FREQUENCY + 4],
]);

function changeDoorAt(t: TacticalState, gridNo: number, change: DoorChange): boolean {
  const door = t.world.structures.find(gridNo, StructureFlags.ANYDOOR);
  if (!door) return false;
  const open = has(door.flags, StructureFlags.OPEN);
  if ((change === 'open' && open) || (change === 'close' && !open)) return false;
  const base = t.world.structures.findBase(door)?.gridNo ?? gridNo;
  handleDoorChangeFromGridNo(t, null, base);
  return true;
}

function toggleLockAt(t: TacticalState, gridNo: number): void {
  const door = findDoorInfo(t, gridNo);
  if (door) updateDoor(t, gridNo, { locked: !door.locked });
}

function toggleActionItemsByFrequency(t: TacticalState, frequency: number): void {
  for (const item of worldBombItems(t)) {
    if (detonatorOf(item.object) === Detonator.REMOTE && frequencyOf(item.object) === frequency) toggleDisabledBomb(item.object);
  }
}

function togglePressureActionItemsInGridNo(t: TacticalState, gridNo: number): void {
  for (const item of worldBombItems(t)) {
    if (item.gridNo === gridNo && detonatorOf(item.object) === Detonator.PRESSURE) toggleDisabledBomb(item.object);
  }
}

export function performItemAction(t: TacticalState, gridNo: number, o: ItemObject): boolean {
  const action = actionValueOf(o);
  const toggled = TOGGLED_FREQUENCIES.get(action);
  if (toggled !== undefined) {
    toggleActionItemsByFrequency(t, toggled);
    return false;
  }
  switch (action) {
    case ItemAction.OPEN_DOOR:
      return changeDoorAt(t, gridNo, 'open');
    case ItemAction.CLOSE_DOOR:
      return changeDoorAt(t, gridNo, 'close');
    case ItemAction.TOGGLE_DOOR:
      return changeDoorAt(t, gridNo, 'toggle');
    case ItemAction.UNLOCK_DOOR:
      updateDoor(t, gridNo, { locked: false });
      return false;
    case ItemAction.TOGGLE_LOCK:
      toggleLockAt(t, gridNo);
      return false;
    case ItemAction.UNTRAP_DOOR:
      disarmDoorTrap(t, gridNo);
      return false;
    case ItemAction.TOGGLE_PRESSURE_ITEMS:
      togglePressureActionItemsInGridNo(t, gridNo);
      return false;
    case ItemAction.KINGPIN_ALARM:
      kingpinAlarm(t, gridNo);
      clearDisabledBomb(o);
      return false;
    case ItemAction.SEX:
      return sexActionItem(t, gridNo);
    case ItemAction.REVEAL_ROOM:
      removeHiddenRoomRoofAt(t, gridNo);
      return false;
    case ItemAction.LOCAL_ALARM:
      makeNoise(t, null, gridNo, GROUND_LEVEL, LOCAL_ALARM_VOLUME, NoiseKind.SILENT_ALARM);
      return false;
    case ItemAction.GLOBAL_ALARM:
      callAvailableEnemiesTo(t, gridNo);
      return false;
    case ItemAction.BLOODCAT_ALARM:
      callAvailableTeamEnemiesTo(t, gridNo, Team.CREATURE);
      return false;
    case ItemAction.KLAXON:
      t.events.push({ type: 'alarm', gridNo, kind: 'klaxon' });
      return false;
    case ItemAction.MUSEUM_ALARM:
      museumAlarm(t, gridNo);
      return false;
    default:
      return false;
  }
}
