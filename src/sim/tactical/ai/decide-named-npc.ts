// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/DecideAction.cc DecideActionNamedNPC; TacticalAI/AI.h
// @src QUOTE_ACTION_ID_TURNTOWARDSPLAYER; NPC.h NPC_TALK_RADIUS.

import { endHeight } from '../animation.ts';
import { directionToward } from '../movement.ts';
import { addToShouldBecomeHostileOrSayQuoteList } from '../narrative/civ-hostility.ts';
import { closestPc } from '../narrative/closest-pc.ts';
import { ASSASSINS } from '../narrative/constants.ts';
import { internalIsValidStance } from '../person-structure.ts';
import { NOWHERE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { AiAction } from './actions.ts';
import { determineMovementMode } from './decide.ts';
import { goAsFarAsPossibleTowards } from './destinations.ts';

const NPC_TALK_RADIUS = 4;
const NEAR_ENOUGH_TO_TRIGGER = NPC_TALK_RADIUS * 2;
const QUOTE_ACTION_TURN_TOWARDS_PLAYER = 2;
const ASSASSIN_WAIT_MS = 5000;

function turnTowardsPlayer(t: TacticalState, s: Soldier): number {
  const pc = closestPc(t, s);
  if (pc.gridNo === NOWHERE) return AiAction.ABSOLUTELY_NONE;
  if (pc.distance <= NEAR_ENOUGH_TO_TRIGGER) {
    s.quoteRecord = 0;
    t.narrative.pcsNearNpc(s.profile);
    s.ai.handleEveryFrame = false;
    return AiAction.ABSOLUTELY_NONE;
  }
  const direction = directionToward(s.gridNo, pc.gridNo);
  if (s.direction !== direction && internalIsValidStance(t, s, direction, endHeight(t.content, s.state))) {
    s.ai.actionData = direction;
    return AiAction.CHANGE_FACING;
  }
  return AiAction.ABSOLUTELY_NONE;
}

function assassinApproach(t: TacticalState, s: Soldier): number {
  const pc = closestPc(t, s);
  if (pc.gridNo === NOWHERE) return AiAction.NONE;
  if (pc.distance <= NEAR_ENOUGH_TO_TRIGGER) {
    addToShouldBecomeHostileOrSayQuoteList(t, s);
    s.ai.actionData = ASSASSIN_WAIT_MS;
    return AiAction.WAIT;
  }
  s.ai.actionData = goAsFarAsPossibleTowards(t, s, pc.gridNo, AiAction.APPROACH_MERC, (x, action) => determineMovementMode(t, x, action));
  return s.ai.actionData !== NOWHERE ? AiAction.APPROACH_MERC : AiAction.NONE;
}

export function decideActionNamedNPC(t: TacticalState, s: Soldier): number {
  if (s.quoteRecord !== 0 && s.quoteActionId === QUOTE_ACTION_TURN_TOWARDS_PLAYER) return turnTowardsPlayer(t, s);
  s.ai.actionData = t.narrative.npcConsiderInitiatingConv(s);
  if (s.ai.actionData !== NOWHERE) return AiAction.APPROACH_MERC;
  if (ASSASSINS.has(s.profile)) return assassinApproach(t, s);
  return AiAction.NONE;
}
