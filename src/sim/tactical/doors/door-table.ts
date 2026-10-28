// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Keys.h DOOR, DoorTrapTypes, perceived values, DOORTRAP flags; Keys.cc DoorTrapTable,
// @src FindDoorInfoAtGridNo, RemoveDoorInfoFromTable; Handle_Doors.h HandleDoor.

import type { MapDoor } from '../../../content/formats/map.ts';
import type { TacticalState } from '../state.ts';

export const HandleDoor = {
  DENIED: 0,
  OPEN: 1,
  OPEN_DIAG_SHORT: 2,
  OPEN_DIAG_LONG: 3,
  EXAMINE: 4,
  LOCKPICK: 5,
  FORCE: 6,
  LOCK: 7,
  UNLOCK: 8,
  EXPLODE: 9,
  UNTRAP: 10,
  CROWBAR: 11,
} as const;

export const DoorTrap = { NONE: 0, EXPLOSION: 1, ELECTRIC: 2, SIREN: 3, SILENT_ALARM: 4, BROTHEL_SIREN: 5, SUPER_ELECTRIC: 6 } as const;
export const DOOR_TRAP_NAMES: readonly string[] = ['none', 'explosion', 'electric', 'siren', 'silentAlarm', 'siren', 'electric'];

export const DoorTrapFlags = { STOPS_ACTION: 0x01, RECURRING: 0x02, SILENT: 0x04 } as const;
const F = DoorTrapFlags;
export const DOOR_TRAP_TABLE: readonly number[] = [
  0,
  F.STOPS_ACTION,
  F.STOPS_ACTION | F.RECURRING,
  F.RECURRING,
  F.RECURRING | F.SILENT,
  F.RECURRING,
  F.STOPS_ACTION | F.RECURRING,
];

export const PerceivedLock = { UNKNOWN: 0, LOCKED: 1, UNLOCKED: 2, BROKEN: 3 } as const;
export const PerceivedTrap = { UNKNOWN: 0, PROVED_TRAPPED: 1, PERCEIVED_UNTRAPPED: 2, PROVED_UNTRAPPED: 3 } as const;

export type Door = MapDoor;

export function trapFlags(trapId: number): number {
  return DOOR_TRAP_TABLE[trapId] ?? 0;
}

export function findDoorInfo(t: TacticalState, gridNo: number): Door | null {
  return t.world.mapDoors.get(gridNo) ?? null;
}

export function updateDoor(t: TacticalState, gridNo: number, patch: Partial<Omit<Door, 'gridNo'>>): Door | null {
  const door = t.world.mapDoors.get(gridNo);
  if (!door) return null;
  const next = { ...door, ...patch };
  t.world.mapDoors.set(gridNo, next);
  return next;
}

export function removeDoorInfo(t: TacticalState, gridNo: number): void {
  t.world.mapDoors.delete(gridNo);
}

export function disarmDoorTrap(t: TacticalState, gridNo: number): void {
  updateDoor(t, gridNo, { trapLevel: 0, trapId: DoorTrap.NONE });
}
