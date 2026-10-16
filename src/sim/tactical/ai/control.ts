// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIMain.cc HandleSoldierAI, ExecuteAction, ActionDone, CancelAIAction, NPCDoesAct,
// @src FreeUpNPCFromTurning, FreeUpNPCFromStanceChange, FreeUpNPCFromRoofClimb; Realtime.cc RTHandleAI; Movement.cc SoldierTriesToContinueAlongPath;
// @src AIUtils.cc NewDest; Tactical/Overhead.cc ExecuteOverhead (real-time AI cadence); creature/crow dispatch of
// @src TurnBasedHandleNPCAI and Realtime.cc RTDecideAction, RTHandleAI. See docs/09 §1, docs/13 §14.

import { AnimFlags } from '../../../content/anim/tables.ts';
import { newGridNo, pythSpacesAway, spacesAway, WORLD_MAX } from '../../../content/world/grid.ts';
import { anim } from '../anim-states.ts';
import {
  AnimHeight,
  adjustNoAPToFinishMove,
  changeSoldierStance,
  endHeight,
  hasAnimFlag,
  height,
  initNewSoldierAnim,
  states,
} from '../animation.ts';
import { soldierDifficultyLevel } from '../combat/chance.ts';
import { DIRECTION_INCREMENT } from '../directions.ts';
import { getNewSoldierPath, stopMerc } from '../movement.ts';
import { isMercBody, NOWHERE, newOKDestination } from '../pathfinding.ts';
import { mostImportantNoiseHeard } from '../perception/knowledge.ts';
import { radioSightings, removeManAsTarget } from '../perception/sight.ts';
import { deductPoints, enoughPoints, estimateActionPointCost } from '../points.ts';
import { beginSoldierClimbDownRoof, beginSoldierClimbUpRoof } from '../roofs.ts';
import { adjustSoldierPathToGoOffEdge } from '../sector-exit.ts';
import { removeSoldierFromTacticalSector } from '../sector-presence.ts';
import { AlertStatus, Attitude, CivilianGroup, OKLIFE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { checkForEndOfBattle, displayHiddenInterrupt } from '../turns/turns.ts';
import {
  AI_DELAY,
  AiAction,
  FIRST_MOVEMENT_ACTION,
  LAST_MOVEMENT_ACTION,
  MOVEMENT_MODE,
  RT_DELAY_BETWEEN_AI_HANDLING,
  Situation,
  URGENCY,
} from './actions.ts';
import { loadWeaponIfNeeded } from './attack-choice.ts';
import { type CombatDeciderHooks, decideActionBlack, decideActionRed, decideActionYellow } from './combat-decide.ts';
import { findNearestUngassedLand, isTraversalQuoteAction, QuoteAction, traversalDirection } from './cover.ts';
import { creatureCall, creatureDecideAction, crowDecideAction, decidesAsCreature, isCrow } from './creature-decide.ts';
import {
  type AiHooks,
  decideAction,
  decideActionGreen,
  decideAlertStatus,
  determineMovementMode,
  type GreenHooks,
  NO_AI_HOOKS,
  NO_GREEN_HOOKS,
  realtimeDelay,
} from './decide.ts';
import { legalNPCDestination, PathMode } from './destinations.ts';
import { endAIGuysTurn, isActionAffordable, turnBasedHandleNPCAI } from './turn-based.ts';
import { recalculatePathCost } from './utils.ts';

const OFF_MAP_CURSOR = 0xffff;
const MAX_DISTANCE_VISIBLE = 26;
const CLOSE_ENOUGH_TILES = 4;
const NPC_ARRIVAL_WAIT_MS = 500;

export interface AiControl {
  readonly hooks: AiHooks;
  readonly green: GreenHooks;
  lastTickMs: number;
  cursor: number;
  handleThisPass: boolean;
  paused: boolean;
}

export function createAiControl(hooks: Partial<AiHooks & GreenHooks> = {}): AiControl {
  const combat: CombatDeciderHooks = { decideActionGreen: (t, s) => decideActionGreen(t, s, green), npcDoesAct };
  const green: GreenHooks = {
    ...NO_GREEN_HOOKS,
    findNearestUngassedLand,
    decideActionYellow: (t, s) => decideActionYellow(t, s, combat),
    decideActionRed: (t, s) => decideActionRed(t, s, combat),
    decideActionBlack: (t, s) => decideActionBlack(t, s, combat),
    ...hooks,
  };
  return {
    hooks: { ...NO_AI_HOOKS, ...hooks },
    green,
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
  t.turn.skipCoverCheck = false;
  s.ai.bypassToGreen = 0;
  actionDone(t, s);
}

const RADIO_STATES = ['AI_RADIO', 'AI_CR_RADIO'];
const PENDING_RELEASE_STATES = [
  'PICKUP_ITEM',
  'ADJACENT_GET_ITEM',
  'DROP_ITEM',
  'END_OPEN_DOOR',
  'END_OPEN_DOOR_CROUCHED',
  'CLOSE_DOOR',
  'MONSTER_UP',
  'AI_RADIO',
  'AI_CR_RADIO',
  'END_OPENSTRUCT',
  'END_OPENSTRUCT_CROUCHED',
  'QUEEN_CALL',
];
const PENDING_ACTIONS: ReadonlySet<number> = new Set([
  AiAction.PENDING_ACTION,
  AiAction.OPEN_OR_CLOSE_DOOR,
  AiAction.YELLOW_ALERT,
  AiAction.RED_ALERT,
  AiAction.PULL_TRIGGER,
  AiAction.CREATURE_CALL,
  AiAction.UNLOCK_DOOR,
  AiAction.LOCK_DOOR,
]);

export function freeUpFromPendingAction(t: TacticalState, s: Soldier): void {
  if (s.team === Team.OUR || s.ai.action === AiAction.PULL_TRIGGER) return;
  if (!PENDING_ACTIONS.has(s.ai.action)) return;
  const name = t.content.animations.controls[s.state]?.id ?? '';
  if (PENDING_RELEASE_STATES.includes(name)) actionDone(t, s);
}

function aiDecideRadioAnimation(t: TacticalState, s: Soldier): void {
  if (s.bodyType !== 0 && s.bodyType !== 1) {
    actionDone(t, s);
    return;
  }
  if (s.team === Team.CIV && s.civilianGroup !== CivilianGroup.KINGPIN) {
    actionDone(t, s);
    return;
  }
  const end = endHeight(t.content, s.state);
  if (end === AnimHeight.STAND) initNewSoldierAnim(t, s, anim(t.content, RADIO_STATES[0] as string), 0, false);
  else if (end === AnimHeight.CROUCH) initNewSoldierAnim(t, s, anim(t.content, RADIO_STATES[1] as string), 0, false);
  else actionDone(t, s);
}

function handleInitialRedAlert(t: TacticalState, team: number): void {
  t.perception.awareOfOpposition[team] = true;
}

function setSoldierCowerState(t: TacticalState, s: Soldier, on: boolean): void {
  if (s.bodyType === 21) return;
  if (on) {
    if (!s.cowering) {
      initNewSoldierAnim(t, s, anim(t.content, 'START_COWER'), 0, false);
      s.cowering = true;
      s.desiredHeight = AnimHeight.CROUCH;
    }
  } else if (s.cowering) {
    initNewSoldierAnim(t, s, anim(t.content, 'END_COWER'), 0, false);
    s.cowering = false;
    s.desiredHeight = AnimHeight.STAND;
  }
}

const AP_RADIO = 5;

export function npcDoesAct(t: TacticalState, s: Soldier): void {
  if (t.turn.hiddenInterrupt) displayHiddenInterrupt(t);
  if (s.desiredDirection !== s.direction) s.desiredDirection = s.direction;
}

export function freeUpFromTurning(t: TacticalState, s: Soldier): void {
  if (s.ai.action === AiAction.CHANGE_FACING && s.ai.actionInProgress) actionDone(t, s);
}

export function freeUpFromRoofClimb(t: TacticalState, s: Soldier): void {
  if (s.ai.actionInProgress && s.ai.action === AiAction.CLIMB_ROOF) actionDone(t, s);
}

export function freeUpFromStanceChange(t: TacticalState, s: Soldier): void {
  const ai = s.ai;
  if (!ai.actionInProgress) return;
  if (ai.action !== AiAction.CHANGE_STANCE && ai.action !== AiAction.COWER && ai.action !== AiAction.STOP_COWERING) return;
  if (height(t.content, s.state) === ai.actionData) actionDone(t, s);
}

const SWAT_NOISE_RANGE = MAX_DISTANCE_VISIBLE + 10;

function isCunningCoverTaker(t: TacticalState, s: Soldier): boolean {
  const a = s.ai.attitude;
  return (
    isMercBody(s) &&
    s.ai.action === AiAction.TAKE_COVER &&
    (a === Attitude.DEFENSIVE || a === Attitude.CUNNINGSOLO || a === Attitude.CUNNINGAID) &&
    soldierDifficultyLevel(t, s) >= 2
  );
}

function coverMovementMode(t: TacticalState, s: Soldier): number {
  const st = states(t.content.animations);
  const name = MOVEMENT_MODE[AiAction.TAKE_COVER]?.[URGENCY[s.ai.alertStatus]?.[s.ai.morale] ?? 0] ?? 'WALKING';
  const mode = st[name];
  if (mode === st.SWATTING) return mode;
  const canSwat = enoughPoints(t.inCombat, s, recalculatePathCost(t, s, st.SWATTING));
  return canSwat || (s.ai.lastAction === AiAction.TAKE_COVER && s.uiMovementMode === st.SWATTING) ? st.SWATTING : mode;
}

function alertedEnemyMovementMode(t: TacticalState, s: Soldier): number {
  if (t.pre.int(5 - soldierDifficultyLevel(t, s)) === 0) {
    const noise = mostImportantNoiseHeard(t, s);
    if (noise !== NOWHERE && pythSpacesAway(s.gridNo, noise) < SWAT_NOISE_RANGE) return states(t.content.animations).SWATTING;
  }
  return determineMovementMode(t, s, s.ai.action);
}

function newDest(t: TacticalState, s: Soldier, g: number): void {
  const st = states(t.content.animations);
  if (isCunningCoverTaker(t, s)) s.uiMovementMode = coverMovementMode(t, s);
  else {
    s.uiMovementMode =
      s.team === Team.ENEMY && s.ai.alertStatus === AlertStatus.RED
        ? alertedEnemyMovementMode(t, s)
        : determineMovementMode(t, s, s.ai.action);
    if (s.uiMovementMode === st.SWATTING && !isMercBody(s)) s.uiMovementMode = st.WALKING;
  }
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
  const escapeDirection = traversalDirection(s.quoteActionId);
  if (escapeDirection !== null) {
    s.offWorldGridNo = ai.actionData;
    adjustSoldierPathToGoOffEdge(s, ai.actionData, escapeDirection);
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
  t.turn.skipCoverCheck = false;
  s.lastAttackHit = false;
  switch (ai.action) {
    case AiAction.NONE:
      return true;
    case AiAction.WAIT:
      if (!t.inCombat) ai.counter = t.clockMs + ai.actionData;
      actionDone(t, s);
      return true;
    case AiAction.CHANGE_FACING:
      t.turn.skipCoverCheck = true;
      t.gameEvents.push({ kind: 'desiredDirection', soldier: s.id, direction: ai.actionData });
      return true;
    case AiAction.CHANGE_STANCE:
      if (height(t.content, s.state) === ai.actionData) {
        actionDone(t, s);
        return false;
      }
      t.turn.skipCoverCheck = true;
      changeSoldierStance(t, s, ai.actionData);
      return true;
    case AiAction.COWER:
      if (s.cowering) {
        actionDone(t, s);
        return false;
      }
      ai.actionData = AnimHeight.CROUCH;
      setSoldierCowerState(t, s, true);
      return true;
    case AiAction.STOP_COWERING:
      if (!s.cowering) {
        actionDone(t, s);
        return false;
      }
      ai.actionData = AnimHeight.STAND;
      setSoldierCowerState(t, s, false);
      return true;
    case AiAction.THROW_KNIFE:
      cancelAIAction(t, s);
      t.hooks.endAiGuysTurn(t, s);
      return true;
    case AiAction.TOSS_PROJECTILE:
    case AiAction.KNIFE_MOVE:
    case AiAction.FIRE_GUN: {
      if (ai.action === AiAction.TOSS_PROJECTILE) loadWeaponIfNeeded(t, s);
      if (ai.action === AiAction.KNIFE_MOVE) s.uiMovementMode = determineMovementMode(t, s, ai.action);
      const result = t.turnHooks.aiAttack(t, s, ai.actionData, s.targetLevel);
      if (result !== 1) {
        cancelAIAction(t, s);
        t.hooks.endAiGuysTurn(t, s);
      }
      return true;
    }
    case AiAction.RED_ALERT:
    case AiAction.YELLOW_ALERT:
      if (ai.action === AiAction.RED_ALERT && s.team !== Team.OUR && !t.perception.awareOfOpposition[s.team])
        handleInitialRedAlert(t, s.team);
      deductPoints(t.inCombat, s, AP_RADIO, 0);
      radioSightings(t, s, null, s.team);
      aiDecideRadioAnimation(t, s);
      return true;
    case AiAction.CREATURE_CALL:
      deductPoints(t.inCombat, s, AP_RADIO, 0);
      creatureCall(t, s);
      return true;
    case AiAction.PICKUP_ITEM:
      if (!t.turnHooks.aiPickup(t, s, ai.actionData, ai.pickupItem)) {
        cancelAIAction(t, s);
        return false;
      }
      return true;
    case AiAction.DROP_ITEM:
      t.turnHooks.aiDropHandItem(t, s);
      ai.action = AiAction.PENDING_ACTION;
      return true;
    case AiAction.MOVE_TO_CLIMB:
      if (ai.actionData === s.gridNo) {
        ai.action = AiAction.CLIMB_ROOF;
        return isActionAffordable(t, s) ? executeAction(t, s) : false;
      }
      if (t.inCombat && ai.alertStatus < AlertStatus.BLACK) detectMovementLoop(t, s);
      return executeMovement(t, s);
    case AiAction.CLIMB_ROOF:
      if (!(s.level === 0 ? beginSoldierClimbUpRoof(t, s) : beginSoldierClimbDownRoof(t, s))) {
        cancelAIAction(t, s);
        if (t.inCombat) t.hooks.endAiGuysTurn(t, s);
        return false;
      }
      return true;
    case AiAction.LOWER_GUN:
      actionDone(t, s);
      return true;
    case AiAction.END_TURN:
      actionDone(t, s);
      if (t.inCombat) t.hooks.endAiGuysTurn(t, s);
      return false;
    case AiAction.OFFER_SURRENDER:
      return true;
    default:
      if (isMovementAction(ai.action)) {
        if (t.inCombat && ai.alertStatus < AlertStatus.BLACK) detectMovementLoop(t, s);
        return executeMovement(t, s);
      }
      return false;
  }
}

export function decideNpcAction(t: TacticalState, s: Soldier, control: AiControl): number {
  if (decidesAsCreature(s)) return creatureDecideAction(t, s, { npcDoesAct });
  if (isCrow(s)) return crowDecideAction(t, s);
  return decideAction(t, s, control.green);
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
        s.targetLevel = ai.nextTargetLevel;
        ai.nextAction = AiAction.NONE;
        ai.nextActionData = 0;
        ai.nextTargetLevel = 0;
      }
      if (ai.action === AiAction.PICKUP_ITEM) ai.pickupItem = ai.nextPickupItem;
    } else if (s.absoluteFinalDestination !== NOWHERE) {
      ai.action = AiAction.WALK;
      ai.actionData = s.absoluteFinalDestination;
    } else if (!t.engagedInConv) {
      ai.action = decideNpcAction(t, s, control);
    }
    if (ai.action === AiAction.NONE) {
      ai.action = AiAction.WAIT;
      ai.actionData = realtimeDelay(t, s);
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

function reachedRecordDestination(t: TacticalState, s: Soldier): boolean {
  if (spacesAway(s.gridNo, s.absoluteFinalDestination) < CLOSE_ENOUGH_TILES) {
    if (s.absoluteFinalDestination !== s.gridNo) t.narrative.replaceLocationInNpcData(s.profile, s.absoluteFinalDestination, s.gridNo);
    s.absoluteFinalDestination = s.gridNo;
    s.ai.actionData = s.gridNo;
  }
  if (s.absoluteFinalDestination !== s.gridNo) return false;
  s.absoluteFinalDestination = NOWHERE;
  return true;
}

function handleAITacticalTraversal(t: TacticalState, s: Soldier, control: AiControl): void {
  s.quoteActionId = 0;
  endAIGuysTurn(t, s, control);
  removeManAsTarget(t, s);
  t.sectorHooks.soldierLeftMap(t, s);
  removeSoldierFromTacticalSector(t, s);
  checkForEndOfBattle(t);
}

export function handleSoldierAI(t: TacticalState, s: Soldier, control: AiControl): void {
  const ai = s.ai;
  if (s.engagedInAction || t.turn.enemySightingOnTheirTurn || t.actionItems.queue.length > 0 || t.actionItems.active) return;
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
  if (s.life < OKLIFE || !(s.placed || s.offMap)) {
    endAIGuysTurn(t, s, control);
    return;
  }
  if (s.collapsed) {
    cancelAIAction(t, s);
    endAIGuysTurn(t, s, control);
    return;
  }
  const traversingOffMap = s.aiTurnControl && isTraversalQuoteAction(s.quoteActionId) && s.offMap;
  if (ai.newSituation === Situation.IS_NEW) {
    if (t.turn.attackBusyCount === 0 && !traversingOffMap) {
      cancelAIAction(t, s);
      if (ai.action !== AiAction.END_COWER_AND_MOVE) ai.nextAction = AiAction.NONE;
      decideAlertStatus(t, s, control.hooks);
    }
  } else {
    ai.newSituation = Situation.NOT_NEW;
  }
  if (ai.action === AiAction.NONE) {
    if (turnBased)
      turnBasedHandleNPCAI(t, s, control, { npcDoesAct, executeAction, decide: (state, x) => decideNpcAction(state, x, control) });
    else rtHandleAI(t, s, control);
    return;
  }
  if (ai.action >= FIRST_MOVEMENT_ACTION && ai.action <= LAST_MOVEMENT_ACTION && !s.delayedMovement) {
    if (s.pathIndex === s.pathSize) {
      if (s.absoluteFinalDestination !== NOWHERE) {
        if (reachedRecordDestination(t, s)) {
          if (s.quoteRecord !== 0 && s.quoteActionId === QuoteAction.CHECKFORDEST) {
            t.narrative.npcReachedDestination(s);
            ai.nextAction = AiAction.WAIT;
            ai.nextActionData = NPC_ARRIVAL_WAIT_MS;
          } else if (isTraversalQuoteAction(s.quoteActionId)) {
            handleAITacticalTraversal(t, s, control);
            return;
          }
        }
      } else if (isTraversalQuoteAction(s.quoteActionId)) {
        handleAITacticalTraversal(t, s, control);
        return;
      }
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
    if (s && (s.placed || s.offMap) && s.team !== Team.OUR) {
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
