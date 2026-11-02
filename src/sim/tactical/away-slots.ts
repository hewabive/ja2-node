// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc AddAwaySlot, RemoveAwaySlot, MoveSoldierFromMercToAwaySlot,
// @src MoveSoldierFromAwayToMercSlot (the vectors of Stracciatella, 2026-11-02).

import { removeMercStructure } from './person-structure.ts';
import type { Soldier } from './soldier.ts';
import { eraseFromSlots, registerSoldier, removeOccupant, type TacticalState, unregisterSoldier } from './state.ts';

function addAwaySlot(t: TacticalState, s: Soldier): void {
  t.awaySlots.push(s);
}

function removeAwaySlot(t: TacticalState, s: Soldier): boolean {
  return eraseFromSlots(t.awaySlots, s);
}

function leaveWorld(t: TacticalState, s: Soldier): void {
  if (s.placed) removeOccupant(t, s);
  removeMercStructure(t, s);
  if (t.reserved[s.reservedGridNo] === s.id) t.reserved[s.reservedGridNo] = -1;
  s.placed = false;
  s.offMap = false;
}

export function moveSoldierFromMercToAwaySlot(t: TacticalState, s: Soldier): void {
  if (!unregisterSoldier(t, s)) return;
  leaveWorld(t, s);
  s.away = true;
  addAwaySlot(t, s);
}

export function moveSoldierFromAwayToMercSlot(t: TacticalState, s: Soldier): boolean {
  if (!removeAwaySlot(t, s)) return false;
  s.away = false;
  registerSoldier(t, s);
  return true;
}

export function awaySoldierAt(t: TacticalState, g: number, level: number): Soldier | null {
  return t.awaySlots.find((s) => s.gridNo === g && s.level === level) ?? null;
}

export function removeFromAwaySlots(t: TacticalState, s: Soldier): void {
  if (removeAwaySlot(t, s)) s.away = false;
}
