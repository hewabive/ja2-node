// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/TeamTurns.cc CalcInterruptDuelPts (the robot and its controller); Tactical/Overhead.cc
// @src UIOKMoveDestination, Tactical/UI_Cursors.cc, Tactical/Handle_UI.cc (an uncontrolled robot takes no orders);
// @src Tactical/Soldier_Macros.h AM_A_ROBOT. See docs/25 §9.4.

import { effectiveExpLevel } from '../skills.ts';
import { Body, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

const CONTROLLER_DISTRACTION = 2;

export function isRobot(s: Pick<Soldier, 'bodyType'>): boolean {
  return s.bodyType === Body.ROBOTNOWEAPON;
}

export function uncontrolledRobot(t: TacticalState, s: Soldier): boolean {
  return isRobot(s) && !t.narrative.robotCanBeControlled(s);
}

export function interruptBasePoints(t: TacticalState, s: Soldier): number {
  const holder = isRobot(s) ? t.narrative.robotController(s) : null;
  if (holder) return effectiveExpLevel(holder) - CONTROLLER_DISTRACTION;
  const own = effectiveExpLevel(s);
  return t.narrative.controllingRobot(s) ? own - CONTROLLER_DISTRACTION : own;
}
