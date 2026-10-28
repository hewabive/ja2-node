// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc RemoveSoldierFromTacticalSector, HostileBloodcatsPresent; OppList.cc InitSoldierOppList;
// @src Soldier_Create.cc InternalTacticalRemoveSoldier (DeleteSchedule).

import { removeFromAwaySlots } from './away-slots.ts';
import { deleteScheduleNode } from './narrative/schedule-state.ts';
import { removeMercStructure } from './person-structure.ts';
import { Body, NOWHERE, type Soldier, Team, TOTAL_SOLDIERS } from './soldier.ts';
import { removeOccupant, type TacticalState, teamMembers, unregisterSoldier } from './state.ts';

export function initSoldierOppList(t: TacticalState, s: Soldier): void {
  s.oppList.fill(0);
  s.ai.oppCount = 0;
  s.lastKnownOpp.fill(NOWHERE);
  t.turn.seenOpponents.fill(0, s.id * TOTAL_SOLDIERS, (s.id + 1) * TOTAL_SOLDIERS);
}

export function removeSoldierFromTacticalSector(t: TacticalState, s: Soldier): void {
  if (s.scheduleId) deleteScheduleNode(t.schedules, t.scheduleClock, s.scheduleId);
  removeFromAwaySlots(t, s);
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

export function hostileBloodcatsPresent(t: Pick<TacticalState, 'soldiers'>): boolean {
  return teamMembers(t, Team.CREATURE).some((s) => s.life > 0 && s.bodyType === Body.BLOODCAT);
}
