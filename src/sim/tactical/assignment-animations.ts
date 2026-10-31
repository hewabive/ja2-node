// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc CommonEnterCombatModeCode (the sleeper's wake-up); Strategic/Assignments.cc
// @src PutMercInAsleepState, PutMercInAwakeState, AssignmentDone (their animations in the loaded sector),
// @src MakeSoldiersTacticalAnimationReflectAssignment; Tactical/Soldier_Add.cc SoldierInSectorAnim, SoldierInSectorPatient,
// @src SoldierInSectorDoctor, SoldierInSectorRepair (the animation; the sweet spot is the soldier's own tile).

import { anim } from './anim-states.ts';
import { AnimHeight, changeSoldierStance, changeSoldierState, states } from './animation.ts';
import { Body, OKLIFE, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export const SectorAssignment = { DOCTOR: 21, PATIENT: 22, REPAIR: 25 } as const;

const STATE_CHANGE_START_CODE = 1;

const ASSIGNMENT_POSES: Readonly<Record<number, string>> = {
  [SectorAssignment.PATIENT]: 'BEING_PATIENT',
  [SectorAssignment.DOCTOR]: 'BEING_DOCTOR',
  [SectorAssignment.REPAIR]: 'BEING_REPAIRMAN',
};

const ASSIGNMENT_ENDS: Readonly<Record<number, string>> = {
  [SectorAssignment.DOCTOR]: 'END_DOCTOR',
  [SectorAssignment.REPAIR]: 'END_REPAIRMAN',
};

function changeStateFromSecondCode(t: TacticalState, s: Soldier, state: number): void {
  changeSoldierState(t, s, state, STATE_CHANGE_START_CODE, true);
}

function standing(t: TacticalState): number {
  return states(t.content.animations).STANDING;
}

export function startWakingUp(t: TacticalState, s: Soldier): void {
  changeStateFromSecondCode(t, s, anim(t.content, 'WKAEUP_FROM_SLEEP'));
}

export function animateWakingUp(t: TacticalState, s: Soldier, onTacticalScreen: boolean): void {
  if (onTacticalScreen) startWakingUp(t, s);
  else changeStateFromSecondCode(t, s, standing(t));
}

export function animateFallingAsleep(t: TacticalState, s: Soldier, onTacticalScreen: boolean): void {
  changeStateFromSecondCode(t, s, anim(t.content, onTacticalScreen ? 'GOTO_SLEEP' : 'SLEEPING'));
}

export function animateAssignmentDone(t: TacticalState, s: Soldier, assignment: number, onTacticalScreen: boolean): void {
  const end = ASSIGNMENT_ENDS[assignment];
  if (end === undefined && assignment !== SectorAssignment.PATIENT) return;
  if (!onTacticalScreen) changeStateFromSecondCode(t, s, standing(t));
  else if (end !== undefined) changeStateFromSecondCode(t, s, anim(t.content, end));
  else changeSoldierStance(t, s, AnimHeight.CROUCH);
}

export function assignmentPose(t: TacticalState, s: Soldier, assignment: number): number | null {
  const pose = ASSIGNMENT_POSES[assignment];
  if (pose === undefined) return null;
  return s.bodyType <= Body.REGFEMALE ? anim(t.content, pose) : standing(t);
}

export function reflectAssignment(t: TacticalState, s: Soldier, assignment: number): void {
  if (s.life < OKLIFE) return;
  const pose = assignmentPose(t, s, assignment);
  if (pose !== null) changeStateFromSecondCode(t, s, pose);
  else if (s.state !== anim(t.content, 'WKAEUP_FROM_SLEEP')) changeStateFromSecondCode(t, s, standing(t));
}
