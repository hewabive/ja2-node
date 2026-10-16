// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIMain.cc HandleSoldierAI, ExecuteAction, ActionDone, CancelAIAction, NPCDoesAct,
// @src FreeUpNPCFromTurning, FreeUpNPCFromStanceChange; Realtime.cc RTHandleAI; Movement.cc SoldierTriesToContinueAlongPath;
// @src AIUtils.cc NewDest; Tactical/Overhead.cc ExecuteOverhead (real-time AI cadence). See docs/09 §1.

import { AnimFlags } from '../../../content/anim/tables.ts';
import { newGridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { adjustNoAPToFinishMove, changeSoldierStance, hasAnimFlag, height, states } from '../animation.ts';
import { DIRECTION_INCREMENT } from '../directions.ts';
import { getNewSoldierPath, stopMerc } from '../movement.ts';
import { isMercBody, NOWHERE, newOKDestination } from '../pathfinding.ts';
import { estimateActionPointCost } from '../points.ts';
import { AlertStatus, OKLIFE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { displayHiddenInterrupt } from '../turns/turns.ts';
import { AI_DELAY, AiAction, FIRST_MOVEMENT_ACTION, LAST_MOVEMENT_ACTION, RT_DELAY_BETWEEN_AI_HANDLING, Situation } from './actions.ts';
import {
  type AiHooks,
  decideAction,
  decideAlertStatus,
  determineMovementMode,
  type GreenHooks,
  isCivOrMilitia,
  NO_AI_HOOKS,
  NO_GREEN_HOOKS,
  realtimeAiDelay,
  realtimeCivDelay,
} from './decide.ts';
import { legalNPCDestination, PathMode } from './destinations.ts';
import { endAIGuysTurn, isActionAffordable, turnBasedHandleNPCAI } from './turn-based.ts';

const OFF_MAP_CURSOR = 0xffff;

export interface AiControl {
  readonly hooks: AiHooks;
  readonly green: GreenHooks;
  lastTickMs: number;
  cursor: number;
  handleThisPass: boolean;
  paused: boolean;
}

export function createAiControl(hooks: Partial<AiHooks & GreenHooks> = {}): AiControl {
  return {
    hooks: { ...NO_AI_HOOKS, ...hooks },
    green: { ...NO_GREEN_HOOKS, ...hooks },
    lastTickMs: 0,
    cursor: 0,
    handleThisPass: false,
    paused: false,
  };
}

export function actionDone(t: TacticalState, s: Soldier): void {
  const ai = s.ai;
  if (ai.action === AiAction.NONE) return;
  s.finalDestination = s.gridNo;
  if (!s.noAPToFinishMove) {
    stopMerc(t, s);
    adjustNoAPToFinishMove(s, false);
  }
  ai.lastAction = ai.action;
  ai.action = AiAction.NONE;
  ai.actionData = NOWHERE;
  ai.actionInProgress = false;
  s.delayedMovement = 0;
  s.pathStored = false;
}

export function cancelAIAction(t: TacticalState, s: Soldier): void {
  if (s.ai.newSituation === Situation.IS_NEW) s.ai.newSituation = Situation.WAS_NEW;
  s.ai.bypassToGreen = 0;
  actionDone(t, s);
}

function npcDoesAct(t: TacticalState, s: Soldier): void {
  if (t.turn.hiddenInterrupt) displayHiddenInterrupt(t);
  if (s.desiredDirection !== s.direction) s.desiredDirection = s.direction;
}

export function freeUpFromTurning(t: TacticalState, s: Soldier): void {
  if (s.ai.action === AiAction.CHANGE_FACING && s.ai.actionInProgress) actionDone(t, s);
}

export function freeUpFromStanceChange(t: TacticalState, s: Soldier): void {
  const ai = s.ai;
  if (!ai.actionInProgress) return;
  if (ai.action !== AiAction.CHANGE_STANCE && ai.action !== AiAction.COWER && ai.action !== AiAction.STOP_COWERING) return;
  if (height(t.content, s.state) === ai.actionData) actionDone(t, s);
}

function newDest(t: TacticalState, s: Soldier, g: number): void {
  s.uiMovementMode = determineMovementMode(t, s, s.ai.action);
  if (s.uiMovementMode === states(t.content.animations).SWATTING && !isMercBody(s)) s.uiMovementMode = states(t.content.animations).WALKING;
  getNewSoldierPath(t, s, g, s.uiMovementMode, 0, s.noAPToFinishMove);
}

const MOVEMENT_ACTIONS: ReadonlySet<number> = new Set([
  AiAction.MOVE_TO_CLIMB,
  AiAction.RANDOM_PATROL,
  AiAction.SEEK_FRIEND,
  AiAction.SEEK_OPPONENT,
  AiAction.TAKE_COVER,
  AiAction.GET_CLOSER,
  AiAction.POINT_PATROL,
  AiAction.LEAVE_WATER_GAS,
  AiAction.SEEK_NOISE,
  AiAction.RUN_AWAY,
  AiAction.APPROACH_MERC,
  AiAction.TRACK,
  AiAction.EAT,
  AiAction.SCHEDULE_MOVE,
  AiAction.WALK,
  AiAction.RUN,
]);

function isMovementAction(action: number): boolean {
  return MOVEMENT_ACTIONS.has(action);
}

function executeMovement(t: TacticalState, s: Soldier): boolean {
  const ai = s.ai;
  if (!s.pathStored) {
    if (legalNPCDestination(t, s, ai.actionData, PathMode.ENSURE_PATH, true, 0)) s.pathStored = true;
    if (!s.pathStored) {
      cancelAIAction(t, s);
      return false;
    }
  }
  newDest(t, s, ai.actionData);
  if (s.finalDestination !== ai.actionData) {
    ai.blackList = ai.actionData;
    cancelAIAction(t, s);
    return false;
  }
  ai.blackList = NOWHERE;
  return true;
}

function detectMovementLoop(t: TacticalState, s: Soldier): void {
  const last = s.lastTwoLocations;
  if (last[0] === NOWHERE) last[0] = s.gridNo;
  else if (last[1] === NOWHERE) last[1] = s.gridNo;
  else if (s.ai.actionData === last[1] && s.gridNo === last[0]) {
    actionDone(t, s);
    t.hooks.endAiGuysTurn(t, s);
  } else {
    last[0] = last[1];
    last[1] = s.gridNo;
  }
}

export function executeAction(t: TacticalState, s: Soldier): boolean {
  const ai = s.ai;
  switch (ai.action) {
    case AiAction.NONE:
      return true;
    case AiAction.WAIT:
      if (!t.inCombat) ai.counter = t.clockMs + ai.actionData;
      actionDone(t, s);
      return true;
    case AiAction.CHANGE_FACING:
      t.gameEvents.push({ kind: 'desiredDirection', soldier: s.id, direction: ai.actionData });
      return true;
    case AiAction.CHANGE_STANCE:
      if (height(t.content, s.state) === ai.actionData) {
        actionDone(t, s);
        return false;
      }
      changeSoldierStance(t, s, ai.actionData);
      return true;
    case AiAction.STOP_COWERING:
      if (!s.cowering) {
        actionDone(t, s);
        return false;
      }
      s.cowering = false;
      changeSoldierStance(t, s, ai.actionData);
      return true;
    default:
      if (isMovementAction(ai.action)) {
        if (t.inCombat && ai.alertStatus < AlertStatus.BLACK) detectMovementLoop(t, s);
        return executeMovement(t, s);
      }
      return false;
  }
}

function rtHandleAI(t: TacticalState, s: Soldier, control: AiControl): void {
  const ai = s.ai;
  if (ai.action === AiAction.NONE) {
    if (ai.nextAction === AiAction.NONE) {
      ai.actionInProgress = false;
      decideAlertStatus(t, s, control.hooks);
    }
    s.pathStored = false;
    if (ai.nextAction !== AiAction.NONE) {
      if (ai.nextAction === AiAction.END_COWER_AND_MOVE) {
        if (s.cowering) {
          ai.action = AiAction.STOP_COWERING;
          ai.actionData = 6;
        } else if (height(t.content, s.state) < 6) {
          ai.action = AiAction.CHANGE_STANCE;
          ai.actionData = 6;
        } else ai.action = AiAction.NONE;
        if (s.gridNo === ai.nextActionData) {
          ai.nextAction = AiAction.NONE;
          ai.nextActionData = NOWHERE;
        } else ai.nextAction = AiAction.WALK;
      } else {
        ai.action = ai.nextAction;
        ai.actionData = ai.nextActionData;
        ai.nextAction = AiAction.NONE;
        ai.nextActionData = 0;
      }
    } else if (s.absoluteFinalDestination !== NOWHERE) {
      ai.action = AiAction.WALK;
      ai.actionData = s.absoluteFinalDestination;
    } else {
      ai.action = decideAction(t, s, control.green);
    }
    if (ai.action === AiAction.NONE) {
      ai.action = AiAction.WAIT;
      ai.actionData = isCivOrMilitia(s) ? realtimeCivDelay(t) : realtimeAiDelay(t);
    } else if (ai.action === AiAction.ABSOLUTELY_NONE) {
      ai.action = AiAction.NONE;
    }
  }
  npcDoesAct(t, s);
  ai.actionInProgress = executeAction(t, s);
}

function triesToContinueAlongPath(t: TacticalState, s: Soldier): void {
  const ai = s.ai;
  if (
    ai.newSituation === Situation.IS_NEW ||
    ai.actionData < 0 ||
    ai.actionData >= WORLD_MAX ||
    !newOKDestination(t.pathEnv, s, ai.actionData, true, s.level)
  ) {
    cancelAIAction(t, s);
    return;
  }
  if (isActionAffordable(t, s)) {
    if (!ai.actionInProgress) {
      npcDoesAct(t, s);
      ai.actionInProgress = executeAction(t, s);
    }
  } else cancelAIAction(t, s);
  const direction = s.path[s.pathIndex] ?? 0;
  const next = newGridNo(s.gridNo, DIRECTION_INCREMENT[direction] ?? 0);
  const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
  if (s.actionPoints >= estimateActionPointCost(ctx, s, next, direction, s.uiMovementMode, s.pathIndex, s.pathSize)) {
    newDest(t, s, next);
    ai.actionInProgress = true;
  } else cancelAIAction(t, s);
}

export function handleSoldierAI(t: TacticalState, s: Soldier, control: AiControl): void {
  const ai = s.ai;
  if (t.turn.enemySightingOnTheirTurn) return;
  if (s.team === Team.OUR) {
    ai.handleEveryFrame = false;
    return;
  }
  const turnBased = t.inCombat;
  if (turnBased) {
    if (t.turn.currentTeam === Team.OUR) return;
    if (!s.aiTurnControl) return;
    if (s.team !== t.turn.currentTeam) {
      s.aiTurnControl = false;
      return;
    }
    if (s.moved) {
      endAIGuysTurn(t, s, control);
      return;
    }
  } else if (!ai.handleEveryFrame) {
    if (t.clockMs < ai.counter) return;
    ai.counter = t.clockMs + AI_DELAY;
  }
  ai.handleEveryFrame = false;
  if (s.life < OKLIFE || !s.placed) {
    endAIGuysTurn(t, s, control);
    return;
  }
  if (s.collapsed) {
    cancelAIAction(t, s);
    endAIGuysTurn(t, s, control);
    return;
  }
  if (ai.newSituation === Situation.IS_NEW) {
    if (t.turn.attackBusyCount === 0) {
      cancelAIAction(t, s);
      if (ai.action !== AiAction.END_COWER_AND_MOVE) ai.nextAction = AiAction.NONE;
      decideAlertStatus(t, s, control.hooks);
    }
  } else {
    ai.newSituation = Situation.NOT_NEW;
  }
  if (ai.action === AiAction.NONE) {
    if (turnBased) turnBasedHandleNPCAI(t, s, control, { npcDoesAct, executeAction });
    else rtHandleAI(t, s, control);
    return;
  }
  if (ai.action >= FIRST_MOVEMENT_ACTION && ai.action <= LAST_MOVEMENT_ACTION && !s.delayedMovement) {
    if (s.pathIndex === s.pathSize) {
      if (s.gridNo === s.finalDestination && ai.action === AiAction.MOVE_TO_CLIMB) {
        ai.action = AiAction.CLIMB_ROOF;
        if (isActionAffordable(t, s)) {
          ai.action = AiAction.NONE;
          ai.nextAction = AiAction.CLIMB_ROOF;
        }
      }
      actionDone(t, s);
    }
    if (s.noAPToFinishMove) triesToContinueAlongPath(t, s);
    else if (hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY) && !s.continueMoveAfterStanceChange && !s.endDoorOpenCode) {
      const pendingMove = s.pendingAnimation !== -1 && hasAnimFlag(t.content, s.pendingAnimation, AnimFlags.MOVING);
      if (!pendingMove) triesToContinueAlongPath(t, s);
    }
  }
}

function nextAIToHandle(t: TacticalState, control: AiControl): boolean {
  const start = control.cursor >= t.mercSlots.length ? 0 : control.cursor + 1;
  for (let c = start; c < t.mercSlots.length; c++) {
    const s = t.mercSlots[c];
    if (s?.placed && s.team !== Team.OUR) {
      control.cursor = c;
      return true;
    }
  }
  control.cursor = OFF_MAP_CURSOR;
  return false;
}

export function beginAiPass(t: TacticalState, control: AiControl): void {
  control.handleThisPass = false;
  if (control.paused || t.inCombat || t.clockMs < t.turn.pauseAiUntil) return;
  if (t.clockMs - control.lastTickMs > RT_DELAY_BETWEEN_AI_HANDLING) {
    control.lastTickMs = t.clockMs;
    control.handleThisPass = nextAIToHandle(t, control);
  }
}

export function aiForSlot(t: TacticalState, s: Soldier, slot: number, control: AiControl): void {
  if (control.paused || t.clockMs < t.turn.pauseAiUntil) return;
  if (t.inCombat) {
    handleSoldierAI(t, s, control);
    return;
  }
  const scheduled = control.handleThisPass && control.cursor === slot;
  if (!scheduled && !s.ai.handleEveryFrame) return;
  handleSoldierAI(t, s, control);
  if (!t.inCombat) control.handleThisPass = nextAIToHandle(t, control);
}
