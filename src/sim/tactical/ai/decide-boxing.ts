// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/DecideAction.cc DecideActionBoxerEnteringRing, DecideActionGreen (the boxing block),
// @src DecideActionBlack (the boxer's closing in).

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { endHeight } from '../animation.ts';
import { DIRECTION_INCREMENT } from '../directions.ts';
import { directionToward } from '../movement.ts';
import {
  countPeopleInBoxingRing,
  findClosestBoxingRingSpot,
  triggerEndOfBoxingRecord,
  unlockWhenNobodyLeavesTheRing,
} from '../narrative/boxing.ts';
import { BOXER_GRIDNOS, BOXING_RING, BoxingState, CENTER_OF_RING } from '../narrative/boxing-state.ts';
import { internalIsValidStance } from '../person-structure.ts';
import { apsToLook } from '../points.ts';
import { NOWHERE, Orders, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { AiAction } from './actions.ts';
import { goAsFarAsPossibleTowards, roomAt } from './destinations.ts';
import { closestPC, closestSeenOpponent } from './utils.ts';

const NO_ROOM = 0;
const MAX_DISTANCE_VISIBLE = 26;

type MovementMode = (s: Soldier, action: number) => number;

export function decideActionBoxerEnteringRing(t: TacticalState, s: Soldier): number {
  const room = roomAt(t, s.gridNo);
  if (room === BOXING_RING) {
    const pc = closestPC(t, s);
    if (pc !== NOWHERE) {
      const direction = directionToward(s.gridNo, pc);
      if (s.direction !== direction && internalIsValidStance(t, s, direction, endHeight(t.content, s.state))) {
        s.ai.actionData = direction;
        return AiAction.CHANGE_FACING;
      }
    }
    return AiAction.ABSOLUTELY_NONE;
  }
  if (room !== NO_ROOM) {
    s.ai.actionData = findClosestBoxingRingSpot(t, s, true);
    return AiAction.GET_CLOSER;
  }
  return AiAction.ABSOLUTELY_NONE;
}

function boxerLeavesRing(t: TacticalState, s: Soldier): number {
  const room = roomAt(t, s.gridNo);
  if (room === BOXING_RING) {
    const slot = t.boxing.boxers.indexOf(s.id);
    s.ai.actionData = slot >= 0 ? (BOXER_GRIDNOS[slot] as number) : findClosestBoxingRingSpot(t, s, false);
    return AiAction.GET_CLOSER;
  }
  if (room !== NO_ROOM) {
    s.boxer = false;
    if (s.team === Team.OUR) {
      s.underAiControl = false;
      triggerEndOfBoxingRecord(t, s);
    } else if (countPeopleInBoxingRing(t) === 0 && t.boxing.state === BoxingState.DISQUALIFIED) triggerEndOfBoxingRecord(t, null);
    else unlockWhenNobodyLeavesTheRing(t);
  }
  return AiAction.ABSOLUTELY_NONE;
}

function faceTheRing(t: TacticalState, s: Soldier): number {
  const direction = directionToward(s.gridNo, CENTER_OF_RING);
  if ((t.inCombat || apsToLook(t.content, s) <= s.actionPoints) && s.direction !== direction) {
    s.ai.actionData = direction;
    return AiAction.CHANGE_FACING;
  }
  return AiAction.NONE;
}

export function decideActionGreenWhileBoxing(t: TacticalState, s: Soldier): number | null {
  if (t.boxing.state === BoxingState.NOT_BOXING) return null;
  if (s.boxer) {
    if (t.boxing.state === BoxingState.PRE_BOXING) return decideActionBoxerEnteringRing(t, s);
    return boxerLeavesRing(t, s);
  }
  if (pythSpacesAway(s.gridNo, CENTER_OF_RING) <= MAX_DISTANCE_VISIBLE) return faceTheRing(t, s);
  return null;
}

export function boxerClosesIn(t: TacticalState, s: Soldier, canMove: boolean, mode: MovementMode): number {
  if (!canMove) return AiAction.NONE;
  const opponent = closestSeenOpponent(t, s);
  if (opponent === NOWHERE) return AiAction.NONE;
  s.ai.orders = Orders.CLOSEPATROL;
  const reached = goAsFarAsPossibleTowards(t, s, opponent, AiAction.GET_CLOSER, mode);
  s.ai.orders = Orders.STATIONARY;
  if (reached === NOWHERE) return AiAction.NONE;
  const step = s.gridNo + (DIRECTION_INCREMENT[s.path[0] ?? 0] ?? 0);
  s.ai.actionData = step;
  s.finalDestination = step;
  s.ai.nextAction = AiAction.END_TURN;
  return AiAction.GET_CLOSER;
}
