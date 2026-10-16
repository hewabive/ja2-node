// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc AddAwaySlot, RemoveAwaySlot, MoveSoldierFromMercToAwaySlot,
// @src MoveSoldierFromAwayToMercSlot. See docs/25 §5.3–§5.4.

import { removeMercStructure } from './person-structure.ts';
import type { Soldier } from './soldier.ts';
import { registerSoldier, removeOccupant, type TacticalState, unregisterSoldier } from './state.ts';

function addAwaySlot(t: TacticalState, s: Soldier): void {
  const free = t.awaySlots.indexOf(null);
  if (free >= 0) t.awaySlots[free] = s;
  else t.awaySlots.push(s);
}

function removeAwaySlot(t: TacticalState, s: Soldier): boolean {
  const slot = t.awaySlots.indexOf(s);
  if (slot < 0) return false;
  t.awaySlots[slot] = null;
  return true;
}

function leaveWorld(t: TacticalState, s: Soldier): void {
  if (s.placed) removeOccupant(t, s);
  removeMercStructure(t, s);
  if (t.reserved[s.reservedGridNo] === s.id) t.reserved[s.reservedGridNo] = -1;
  s.placed = false;
  s.offMap = false;
}

export function moveSoldierFromMercToAwaySlot(t: TacticalState, s: Soldier): void {
  if (!t.mercSlots.includes(s)) return;
  unregisterSoldier(t, s);
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
  return t.awaySlots.find((s): s is Soldier => s !== null && s.gridNo === g && s.level === level) ?? null;
}

export function removeFromAwaySlots(t: TacticalState, s: Soldier): void {
  if (removeAwaySlot(t, s)) s.away = false;
}
