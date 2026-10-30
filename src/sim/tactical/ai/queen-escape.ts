// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/PanicButtons.cc HeadForTheStairCase; TacticalAI/DecideAction.cc DecideActionRed,
// @src DecideActionBlack (the Queen's and Joe's escape in P3); TacticalAI/AIMain.cc ExecuteAction (AI_ACTION_TRAVERSE_DOWN),
// @src HandleInitialRedAlert (the Queen and Joe, 2026-10-30).

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { profileProgress } from '../profiles.ts';
import { removeSoldierFromTacticalSector } from '../sector-presence.ts';
import { AlertStatus, NO_PROFILE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { checkForEndOfBattle } from '../turns/turns.ts';
import { AiAction } from './actions.ts';
import { legalNPCDestination, PathMode } from './destinations.ts';

const STAIRCASE_GRIDNO = 12067;
const STAIRCASE_REACHED_SPACES = 2;
const QUEEN = 75;
const JOE = 79;
const MEDUNA = { x: 3, y: 16, z: 0 } as const;
const WATER_OK = true;

function inThePalace(t: TacticalState): boolean {
  const s = t.sector;
  return s !== null && s.x === MEDUNA.x && s.y === MEDUNA.y && s.z === MEDUNA.z;
}

function soldierOfProfile(t: TacticalState, profile: number): Soldier | null {
  return t.soldiers.find((s): s is Soldier => s?.placed === true && s.profile === profile) ?? null;
}

export function alertQueenAndJoe(t: TacticalState): void {
  if (!inThePalace(t)) return;
  for (const profile of [QUEEN, JOE]) {
    const s = soldierOfProfile(t, profile);
    if (s) s.ai.alertStatus = AlertStatus.RED;
  }
}

export function headForTheStairCase(t: TacticalState, s: Soldier): number {
  if (t.narrative.palaceBasementSecured()) return AiAction.NONE;
  if (pythSpacesAway(s.gridNo, STAIRCASE_GRIDNO) < STAIRCASE_REACHED_SPACES) return AiAction.TRAVERSE_DOWN;
  if (legalNPCDestination(t, s, STAIRCASE_GRIDNO, PathMode.ENSURE_PATH, WATER_OK, 0)) {
    s.ai.actionData = STAIRCASE_GRIDNO;
    return AiAction.GET_CLOSER;
  }
  return AiAction.NONE;
}

export function queenEscape(t: TacticalState, s: Soldier, canMove: boolean, joeFleesToo: boolean): number {
  if (!canMove || (s.profile !== QUEEN && !(joeFleesToo && s.profile === JOE))) return AiAction.NONE;
  if (!inThePalace(t) || !t.narrative.queenCanFlee()) return AiAction.NONE;
  return headForTheStairCase(t, s);
}

export function traverseDown(t: TacticalState, s: Soldier): void {
  if (t.inCombat) t.hooks.endAiGuysTurn(t, s);
  if (s.profile !== NO_PROFILE) {
    const p = profileProgress(t, s.profile);
    if (p) {
      p.sectorZ++;
      p.useProfileInsertion = false;
    }
  }
  removeSoldierFromTacticalSector(t, s);
  checkForEndOfBattle(t);
}
