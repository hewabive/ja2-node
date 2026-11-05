// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc RemoveSoldierFromTacticalSector (with its next selection, 2026-10-31; the NOWHERE
// @src of its RemoveSoldierFromGridNo, Soldier_Control.cc InternalRemoveSoldierFromGridNo, 2026-11-05),
// @src HostileBloodcatsPresent, HostileCiviliansPresent; Soldier_Create.cc InternalTacticalRemoveSoldier (DeleteSchedule, HandleCrowLeave
// @src 2026-11-01).

import { removeFromAwaySlots } from './away-slots.ts';
import { deleteScheduleNode } from './narrative/schedule-state.ts';
import { initSoldierOppList } from './perception/opplist-reset.ts';
import { removeMercStructure } from './person-structure.ts';
import { handleCrowLeave } from './rotting-corpses.ts';
import { selectAfterRemovalFromSector } from './selection.ts';
import { Body, NOWHERE, type Soldier, Team } from './soldier.ts';
import { removeOccupant, type TacticalState, teamMembers, unregisterSoldier } from './state.ts';

export function removeSoldierFromTacticalSector(t: TacticalState, s: Soldier): void {
  if (s.scheduleId) deleteScheduleNode(t.schedules, t.scheduleClock, s.scheduleId);
  handleCrowLeave(t, s);
  removeFromAwaySlots(t, s);
  initSoldierOppList(t, s);
  const inSector = s.placed || s.offMap;
  if (s.placed) {
    removeOccupant(t, s);
    removeMercStructure(t, s);
  }
  if (inSector) s.gridNo = NOWHERE;
  if (t.reserved[s.reservedGridNo] === s.id) t.reserved[s.reservedGridNo] = -1;
  unregisterSoldier(t, s);
  s.placed = false;
  s.offMap = false;
}

export function leaveTacticalSector(t: TacticalState, s: Soldier): void {
  removeSoldierFromTacticalSector(t, s);
  selectAfterRemovalFromSector(t, s);
}

export function hostileBloodcatsPresent(t: Pick<TacticalState, 'soldiers'>): boolean {
  return teamMembers(t, Team.CREATURE).some((s) => s.life > 0 && s.bodyType === Body.BLOODCAT);
}

export function hostileCiviliansPresent(t: Pick<TacticalState, 'soldiers'>): boolean {
  return teamMembers(t, Team.CIV).some((s) => s.life > 0 && !s.neutral);
}
