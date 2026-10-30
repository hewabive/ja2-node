// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc InitSoldierStruct (bAssignment of a soldier outside our roster stays zero);
// @src Strategic/Assignments.h Assignments, ON_DUTY.

import { Assignment } from '../../strategic/economy/constants.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

const ZEROED_ASSIGNMENT = Assignment.SQUAD_1;

type AssignmentSource = Pick<TacticalState, 'narrative'>;

export function soldierAssignment(t: AssignmentSource, s: Soldier): number {
  return t.narrative.assignment(s) ?? ZEROED_ASSIGNMENT;
}

export function onSquad(t: AssignmentSource, s: Soldier): boolean {
  return soldierAssignment(t, s) < Assignment.ON_DUTY;
}

export function heldPrisoner(t: AssignmentSource, s: Soldier): boolean {
  return soldierAssignment(t, s) === Assignment.ASSIGNMENT_POW;
}
