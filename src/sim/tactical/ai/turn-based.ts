// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIMain.cc EndAIGuysTurn (with the civilian-group proximity rule and its boxer exception),
// @src StartNPCAI, TurnBasedHandleNPCAI, RefreshAI, ManChecksOnFriends, NPCDoesNothing; AIUtils.cc IsActionAffordable;
// @src Soldier_Control.cc SetSoldierAsUnderAiControl. See docs/10 §6.

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { endHeight } from '../animation.ts';
import { haltMoveForSoldierOutOfPoints } from '../movement.ts';
import { boxingHalvesPoints } from '../narrative/boxing-state.ts';
import { civilianGroupMembersChangeSidesWithinProximity } from '../narrative/civ-hostility.ts';
import { type HeightClass, soldierToSoldierLineOfSight } from '../perception/los.ts';
import { distanceVisible } from '../perception/sight.ts';
import { AP, apsToLook, minPtsToMove, type PointsContext } from '../points.ts';
import { AlertStatus, CivilianGroup, isMonster, NO_PROFILE, NOWHERE, OKLIFE, type Soldier } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { removeFirstAIListEntry } from '../turns/ai-list.ts';
import { endAITurn } from '../turns/turns.ts';
import { AiAction, Situation } from './actions.ts';
import type { AiControl } from './control.ts';
import { checkForChangingOrders, decideAlertStatus, setNewSituation } from './decide.ts';

const IRRELEVANT = -1;

function pointsContext(t: TacticalState): PointsContext {
  return { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
}

export function isActionAffordable(t: TacticalState, s: Soldier): boolean {
  const ctx = pointsContext(t);
  let need = 0;
  switch (s.ai.action) {
    case AiAction.CHANGE_FACING:
      need = apsToLook(t.content, s);
      break;
    case AiAction.RANDOM_PATROL:
    case AiAction.SEEK_FRIEND:
    case AiAction.SEEK_OPPONENT:
    case AiAction.TAKE_COVER:
    case AiAction.GET_CLOSER:
    case AiAction.POINT_PATROL:
    case AiAction.LEAVE_WATER_GAS:
    case AiAction.SEEK_NOISE:
    case AiAction.ESCORTED_MOVE:
    case AiAction.RUN_AWAY:
    case AiAction.APPROACH_MERC:
    case AiAction.TRACK:
    case AiAction.EAT:
    case AiAction.SCHEDULE_MOVE:
    case AiAction.WALK:
    case AiAction.MOVE_TO_CLIMB:
    case AiAction.OPEN_OR_CLOSE_DOOR:
    case AiAction.UNLOCK_DOOR:
    case AiAction.LOCK_DOOR:
      need = minPtsToMove(ctx, s, s.uiMovementMode);
      break;
    case AiAction.PICKUP_ITEM:
      need = Math.max(minPtsToMove(ctx, s, s.uiMovementMode), AP.PICKUP_ITEM);
      break;
    case AiAction.DROP_ITEM:
      need = AP.PICKUP_ITEM;
      break;
    case AiAction.FIRE_GUN:
    case AiAction.TOSS_PROJECTILE:
    case AiAction.KNIFE_MOVE:
    case AiAction.THROW_KNIFE:
      need = t.turnHooks.minAPsToAttack(t, s, s.ai.actionData, true);
      break;
    case AiAction.PULL_TRIGGER:
      need = AP.PULL_TRIGGER;
      break;
    case AiAction.USE_DETONATOR:
      need = AP.USE_REMOTE;
      break;
    case AiAction.YELLOW_ALERT:
    case AiAction.RED_ALERT:
    case AiAction.CREATURE_CALL:
      need = AP.RADIO;
      break;
    case AiAction.CHANGE_STANCE:
      need = AP.CROUCH;
      break;
    case AiAction.CLIMB_ROOF:
      need = s.level === 0 ? AP.CLIMBROOF : AP.CLIMBOFFROOF;
      break;
  }
  return need <= s.actionPoints;
}

function setSoldierAsUnderAiControl(t: TacticalState, s: Soldier): void {
  for (const x of t.soldiers) if (x) x.aiTurnControl = false;
  s.aiTurnControl = true;
}

function manChecksOnFriends(t: TacticalState, s: Soldier): void {
  const losWorld = { structures: t.world.structures, heights: t.world.level.heights };
  for (const friend of mercs(t)) {
    if (friend.neutral || s.side !== friend.side || friend === s) continue;
    const d = distanceVisible(t, s, IRRELEVANT, IRRELEVANT, friend.gridNo, friend.level);
    if (pythSpacesAway(s.gridNo, friend.gridNo) > d) continue;
    const eye = {
      gridNo: s.gridNo,
      level: s.level,
      heightClass: endHeight(t.content, s.state) as (typeof HeightClass)[keyof typeof HeightClass],
    };
    const target = {
      gridNo: friend.gridNo,
      level: friend.level,
      heightClass: endHeight(t.content, friend.state) as (typeof HeightClass)[keyof typeof HeightClass],
    };
    if (soldierToSoldierLineOfSight(losWorld, eye, target, d & 0xff, true, t.perception.disallowSight, isMonster(s)) === 0) continue;
    if (friend.ai.alertStatus >= AlertStatus.RED || friend.ai.underFire || friend.life < OKLIFE) {
      s.ai.alertStatus = AlertStatus.RED;
      checkForChangingOrders(s);
      setNewSituation(t, s);
      break;
    }
    if (friend.ai.alertStatus === AlertStatus.YELLOW && s.ai.alertStatus < AlertStatus.YELLOW) {
      s.ai.alertStatus = AlertStatus.YELLOW;
      setNewSituation(t, s);
      s.ai.noiseGridNo = friend.gridNo;
      s.ai.noiseVolume = 3;
    }
  }
}

function refreshAI(t: TacticalState, s: Soldier, control: AiControl): void {
  decideAlertStatus(t, s, control.hooks);
  if (t.inCombat) {
    if (s.ai.alertStatus === AlertStatus.BLACK || s.ai.alertStatus === AlertStatus.RED) s.ai.newSituation = Situation.IS_NEW;
    else {
      s.pathStored = false;
      manChecksOnFriends(t, s);
    }
    s.ai.lastAction = AiAction.NONE;
  }
}

export function startNPCAI(t: TacticalState, s: Soldier, control: AiControl): void {
  setSoldierAsUnderAiControl(t, s);
  s.turnInProgress = true;
  s.lastTwoLocations = [NOWHERE, NOWHERE];
  refreshAI(t, s, control);
  decideAlertStatus(t, s, control.hooks);
}

function hostileGroupMemberSpreadsHostility(t: TacticalState, s: Soldier): void {
  if (s.civilianGroup === CivilianGroup.NONE || s.neutral) return;
  if (s.boxer && boxingHalvesPoints(t)) return;
  const first = civilianGroupMembersChangeSidesWithinProximity(t, s);
  if (first !== NO_PROFILE) t.narrative.triggerFriendWithHostileQuote(first);
}

export function endAIGuysTurn(t: TacticalState, s: Soldier, control: AiControl): void {
  if (!t.inCombat) return;
  hostileGroupMemberSpreadsHostility(t, s);
  s.aiTurnControl = false;
  s.turnInProgress = false;
  s.moved = true;
  s.ai.bypassToGreen = 0;
  const next = removeFirstAIListEntry(t);
  if (next) startNPCAI(t, next, control);
  else endAITurn(t);
}

export interface TurnBasedActions {
  readonly npcDoesAct: (t: TacticalState, s: Soldier) => void;
  readonly executeAction: (t: TacticalState, s: Soldier) => boolean;
  readonly decide: (t: TacticalState, s: Soldier) => number;
}

export function turnBasedHandleNPCAI(t: TacticalState, s: Soldier, control: AiControl, actions: TurnBasedActions): void {
  const ai = s.ai;
  if (ai.action !== AiAction.NONE) return;
  ai.actionInProgress = false;
  s.pathStored = false;
  if (ai.nextAction !== AiAction.NONE) {
    if (ai.nextAction === AiAction.END_COWER_AND_MOVE) {
      if (s.cowering) {
        ai.action = AiAction.STOP_COWERING;
        ai.actionData = 6;
      } else if (endHeight(t.content, s.state) < 6) {
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
    ai.action = ai.checkSchedule ? AiAction.SCHEDULE_MOVE : AiAction.WALK;
    ai.actionData = s.absoluteFinalDestination;
  } else if (!t.engagedInConv) ai.action = actions.decide(t, s);
  if (ai.action === AiAction.ABSOLUTELY_NONE) ai.action = AiAction.NONE;
  if (ai.action === AiAction.NONE) {
    endAIGuysTurn(t, s, control);
    return;
  }
  if (isActionAffordable(t, s)) {
    actions.npcDoesAct(t, s);
    ai.actionInProgress = actions.executeAction(t, s);
    if (!ai.actionInProgress && s.absoluteFinalDestination !== NOWHERE) endAIGuysTurn(t, s, control);
  } else haltMoveForSoldierOutOfPoints(t, s);
}
