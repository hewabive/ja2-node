// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Doors.cc SetDoorString (perceived lock and trap state); Interface_Items.cc key ring popup.
// @src See docs/25 §13.4.

import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { DOOR_TRAP_NAMES, PerceivedLock, PerceivedTrap } from './door-table.ts';

export type PerceivedLockName = 'unknown' | 'locked' | 'unlocked' | 'broken';

export interface DoorView {
  readonly gridNo: number;
  readonly locked: PerceivedLockName;
  readonly trap: string;
}

export interface KeyView {
  readonly keyId: number;
  readonly count: number;
  readonly sectorFound?: number;
  readonly dayFound?: number;
}

const LOCK_NAMES: Readonly<Record<number, PerceivedLockName>> = {
  [PerceivedLock.UNKNOWN]: 'unknown',
  [PerceivedLock.LOCKED]: 'locked',
  [PerceivedLock.UNLOCKED]: 'unlocked',
  [PerceivedLock.BROKEN]: 'broken',
};

function trapName(perceived: number, trapId: number): string {
  if (perceived === PerceivedTrap.PROVED_TRAPPED) return DOOR_TRAP_NAMES[trapId] ?? 'unknown';
  if (perceived === PerceivedTrap.PROVED_UNTRAPPED) return 'none';
  if (perceived === PerceivedTrap.PERCEIVED_UNTRAPPED) return 'noneFound';
  return 'unknown';
}

export function doorViews(t: TacticalState): DoorView[] {
  const views: DoorView[] = [];
  for (const door of t.world.mapDoors.values()) {
    if (door.perceivedLocked === PerceivedLock.UNKNOWN && door.perceivedTrapped === PerceivedTrap.UNKNOWN) continue;
    views.push({
      gridNo: door.gridNo,
      locked: LOCK_NAMES[door.perceivedLocked] ?? 'unknown',
      trap: trapName(door.perceivedTrapped, door.trapId),
    });
  }
  return views.sort((a, b) => a.gridNo - b.gridNo);
}

export function keyRingView(t: TacticalState, s: Soldier): KeyView[] {
  const keys: KeyView[] = [];
  for (const k of s.keyRing ?? []) {
    if (k.count === 0) continue;
    const found = t.keyTable[k.keyId];
    const known = found && found.dateFound !== 0 ? { sectorFound: found.sectorFound, dayFound: found.dateFound } : {};
    keys.push({ keyId: k.keyId, count: k.count, ...known });
  }
  return keys;
}
