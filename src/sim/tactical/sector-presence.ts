// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc RemoveSoldierFromTacticalSector; OppList.cc InitSoldierOppList. See docs/16 §5.

import { removeMercStructure } from './person-structure.ts';
import { NOWHERE, type Soldier, TOTAL_SOLDIERS } from './soldier.ts';
import { removeOccupant, type TacticalState, unregisterSoldier } from './state.ts';

export function initSoldierOppList(t: TacticalState, s: Soldier): void {
  s.oppList.fill(0);
  s.ai.oppCount = 0;
  s.lastKnownOpp.fill(NOWHERE);
  t.turn.seenOpponents.fill(0, s.id * TOTAL_SOLDIERS, (s.id + 1) * TOTAL_SOLDIERS);
}

export function removeSoldierFromTacticalSector(t: TacticalState, s: Soldier): void {
  initSoldierOppList(t, s);
  if (s.placed) {
    removeOccupant(t, s);
    removeMercStructure(t, s);
  }
  if (t.reserved[s.reservedGridNo] === s.id) t.reserved[s.reservedGridNo] = -1;
  unregisterSoldier(t, s);
  s.placed = false;
  s.offMap = false;
}
