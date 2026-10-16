// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead_Types.h fCivGroupHostile, CIV_GROUP_*; Strategic/Strategic_Event_Handler.cc
// @src MakeCivGroupHostileOnNextSectorEntrance; Overhead.cc CivilianGroupMemberChangesSides (scheduling). See docs/25 §6.1–§6.2.

import { CivGroupHostility, NUM_CIV_GROUPS } from '../../tactical/narrative/constants.ts';

export interface CivGroupState {
  readonly hostility: number[];
}

export const REBEL_CIV_GROUP = 1;

export function createCivGroupState(): CivGroupState {
  return { hostility: new Array<number>(NUM_CIV_GROUPS).fill(CivGroupHostility.NEUTRAL) };
}

export function civGroupHostility(state: CivGroupState, group: number): number {
  return state.hostility[group] ?? CivGroupHostility.NEUTRAL;
}

export function setCivGroupHostility(state: CivGroupState, group: number, value: number): void {
  if (group >= 0 && group < NUM_CIV_GROUPS) state.hostility[group] = value;
}

export function importCivGroupHostility(state: CivGroupState, saved: readonly number[]): void {
  for (let group = 0; group < NUM_CIV_GROUPS; group++) state.hostility[group] = saved[group] ?? CivGroupHostility.NEUTRAL;
}

export function makeCivGroupHostileOnNextSectorEntrance(state: CivGroupState, group: number, rebelsBetrayed: () => void): void {
  if (group === REBEL_CIV_GROUP && civGroupHostility(state, group) === CivGroupHostility.NEUTRAL) rebelsBetrayed();
  setCivGroupHostility(state, group, CivGroupHostility.WILL_BECOME_HOSTILE);
}
