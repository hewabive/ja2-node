// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/DecideAction.cc DecideAction, DecideActionGreen (with the DecideActionSchedule call and the boxing
// @src block), DecideAlertStatus (with its boxing gate);
// @src AIMain.cc CheckForChangingOrders (with the creature branches), SetNewSituation; Realtime.cc RealtimeDelay; AIUtils.cc DetermineMovementMode;
// @src DecideActionGreen (the DecideActionNamedNPC call and the uiTimeSinceLastSpoke pause).

import { AnimFlags } from '../../../content/anim/tables.ts';
import { AnimHeight, endHeight, hasAnimFlag, states } from '../animation.ts';
import { inGasOrSmoke } from '../explosions/smoke.ts';
import { boxingActive } from '../narrative/boxing-state.ts';
import { isMercBody, isWater, NOWHERE } from '../pathfinding.ts';
import {
  AlertStatus,
  Attitude,
  Body,
  CivilianGroup,
  isCreatureOrBloodcat,
  isMonster,
  NO_PROFILE,
  Orders,
  type Soldier,
  Team,
} from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { AiAction, MOVEMENT_MODE, NEW_SITUATION_DELAY_RANGE, Situation, URGENCY } from './actions.ts';
import { creatureDecideAlertStatus, realtimeCreatureDelay } from './creature-decide.ts';
import { decideActionGreenWhileBoxing } from './decide-boxing.ts';
import { decideActionSchedule } from './decide-schedule.ts';
import { goAsFarAsPossibleTowards, pointPatrolAI, randDestWithinRange, randomFriendWithin, randomPointPatrolAI } from './destinations.ts';

const HATKIDCIV = 15;
const KIDCIV = 16;
const FATCIV = 11;
const CRIPPLECIV = 17;
const REST_BREATH = 75;
const YELLOW_REST_BREATH = 50;
const KID_SKIP_CHANCE = 10;
const CIV_DELAY_PER_MAN = 1000;
const CIV_DELAY_BASE = 5000;
const CIV_DELAY_STEP = 2000;
const AI_DELAY_BASE = 10000;
const AI_DELAY_SPREAD = 1000;
const NAMED_NPC_IDLE_AFTER_TALK_MS = 60000;

export interface AiHooks {
  mostImportantNoiseHeard(t: TacticalState, s: Soldier): number;
  awareOfOpposition(t: TacticalState, team: number): boolean;
}

export const NO_AI_HOOKS: AiHooks = {
  mostImportantNoiseHeard: (_t, s) => (s.ai.noiseGridNo !== NOWHERE ? s.ai.noiseGridNo : NOWHERE),
  awareOfOpposition: () => false,
};

export function isCivOrMilitia(s: Soldier): boolean {
  return s.team === Team.CIV || s.team === Team.MILITIA;
}

function menInSector(t: TacticalState, team: number): number {
  return t.soldiers.filter((s) => (s?.placed || s?.offMap) && s.team === team && s.life > 0).length;
}

export function realtimeCivDelay(t: TacticalState): number {
  return CIV_DELAY_PER_MAN * (menInSector(t, Team.MILITIA) + menInSector(t, Team.CIV)) + CIV_DELAY_BASE + CIV_DELAY_STEP * t.rng.int(3);
}

export function realtimeAiDelay(t: TacticalState): number {
  return AI_DELAY_BASE + t.rng.int(AI_DELAY_SPREAD);
}

export function realtimeDelay(t: TacticalState, s: Soldier): number {
  if (isCivOrMilitia(s)) return realtimeCivDelay(t);
  return isCreatureOrBloodcat(s) && !s.hunting ? realtimeCreatureDelay(t) : realtimeAiDelay(t);
}

export function determineMovementMode(t: TacticalState, s: Soldier, action: number): number {
  const st = states(t.content.animations);
  const byName = { WALKING: st.WALKING, RUNNING: st.RUNNING, SWATTING: st.SWATTING };
  if (isCreatureOrBloodcat(s)) return s.ai.alertStatus === AlertStatus.GREEN ? st.WALKING : st.RUNNING;
  if (s.bodyType === Body.COW || s.bodyType === Body.CROW) return st.WALKING;
  const table = MOVEMENT_MODE[action]?.[URGENCY[s.ai.alertStatus]?.[s.ai.morale] ?? 0] ?? 'WALKING';
  if (s.ai.cautious && table === 'RUNNING') return st.WALKING;
  if (action === AiAction.SEEK_NOISE && s.team === Team.CIV && !isMercBody(s)) return st.WALKING;
  if ((s.bodyType === HATKIDCIV || s.bodyType === KIDCIV) && s.ai.alertStatus === AlertStatus.GREEN && t.rng.int(KID_SKIP_CHANCE) === 0)
    return t.content.animations.stateIndex.get('KID_SKIPPING') ?? st.WALKING;
  return byName[table];
}

export function setNewSituation(t: TacticalState, s: Soldier): void {
  if (s.team === Team.OUR) return;
  if (s.quoteRecord !== 0 || (s.neutral && t.engagedInConv)) return;
  s.ai.newSituation = Situation.IS_NEW;
  if (!t.inCombat) s.ai.counter = t.clockMs + t.rng.int(NEW_SITUATION_DELAY_RANGE);
}

export function checkForChangingOrders(s: Soldier): void {
  const ai = s.ai;
  if (ai.alertStatus === AlertStatus.GREEN) {
    if (isCreatureOrBloodcat(s)) return;
    ai.nextAction = s.cowering ? AiAction.STOP_COWERING : AiAction.CHANGE_STANCE;
    ai.nextActionData = AnimHeight.STAND;
    return;
  }
  if (ai.alertStatus === AlertStatus.YELLOW) return;
  if (ai.orders === Orders.ONGUARD || ai.orders === Orders.CLOSEPATROL) ai.orders++;
  else if (s.team === Team.MILITIA) ai.orders = Orders.SEEKENEMY;
  else if (isCreatureOrBloodcat(s) && ai.orders !== Orders.STATIONARY && ai.orders !== Orders.ONCALL) ai.orders = Orders.SEEKENEMY;
}

function inWaterNow(t: TacticalState, s: Soldier): boolean {
  return isWater(t.pathWorld, s.gridNo);
}

export function decideAlertStatus(t: TacticalState, s: Soldier, hooks: AiHooks): void {
  if (isMonster(s)) {
    creatureDecideAlertStatus(t, s, hooks);
    return;
  }
  const ai = s.ai;
  const old = ai.alertStatus;
  if (ai.oppCount > 0) {
    ai.alertStatus = AlertStatus.BLACK;
    checkForChangingOrders(s);
  } else if (old === AlertStatus.BLACK) {
    ai.alertStatus = AlertStatus.RED;
  } else if (old === AlertStatus.YELLOW) {
    if (s.team !== Team.CIV && (hooks.awareOfOpposition(t, s.team) || ai.underFire)) ai.alertStatus = AlertStatus.RED;
    else if (hooks.mostImportantNoiseHeard(t, s) === NOWHERE && !ai.actionInProgress) {
      ai.alertStatus = AlertStatus.GREEN;
      checkForChangingOrders(s);
    }
  } else if (old === AlertStatus.GREEN) {
    if (s.team !== Team.CIV && (hooks.awareOfOpposition(t, s.team) || ai.underFire)) ai.alertStatus = AlertStatus.RED;
    else if (hooks.mostImportantNoiseHeard(t, s) !== NOWHERE) ai.alertStatus = AlertStatus.YELLOW;
  }
  if (boxingActive(t)) return;
  if (ai.alertStatus !== old) {
    if (old < AlertStatus.RED || ai.alertStatus < AlertStatus.RED) setNewSituation(t, s);
    if (old < AlertStatus.RED && ai.alertStatus >= AlertStatus.RED) checkForChangingOrders(s);
    return;
  }
  const tired =
    (ai.alertStatus === AlertStatus.GREEN && s.breath < REST_BREATH) ||
    (ai.alertStatus === AlertStatus.YELLOW && s.breath < YELLOW_REST_BREATH);
  if (tired && !inWaterNow(t, s)) {
    setNewSituation(t, s);
    if (ai.alertStatus === AlertStatus.YELLOW && hooks.mostImportantNoiseHeard(t, s) === NOWHERE) {
      ai.alertStatus = AlertStatus.GREEN;
      checkForChangingOrders(s);
    }
  }
}

export function isCivilianForGreen(s: Soldier): boolean {
  return s.team === Team.CIV && (s.civilianGroup === CivilianGroup.NONE || s.neutral || (FATCIV <= s.bodyType && s.bodyType <= CRIPPLECIV));
}

function spokeRecently(t: TacticalState, s: Soldier): boolean {
  if (s.timeSinceLastSpoke && t.clockMs < s.timeSinceLastSpoke + NAMED_NPC_IDLE_AFTER_TALK_MS) return true;
  s.timeSinceLastSpoke = 0;
  return false;
}

function patrolChance(s: Soldier): number {
  let chance = 25 + s.ai.bypassToGreen;
  switch (s.ai.orders) {
    case Orders.STATIONARY:
      chance -= 20;
      break;
    case Orders.ONGUARD:
      chance -= 15;
      break;
    case Orders.CLOSEPATROL:
      chance += 15;
      break;
    case Orders.RNDPTPATROL:
    case Orders.POINTPATROL:
      chance = 0;
      break;
    case Orders.FARPATROL:
      chance += 25;
      break;
    case Orders.SEEKENEMY:
      chance -= 10;
      break;
  }
  switch (s.ai.attitude) {
    case Attitude.DEFENSIVE:
      chance -= 10;
      break;
    case Attitude.BRAVESOLO:
    case Attitude.CUNNINGSOLO:
      chance += 5;
      break;
    case Attitude.AGGRESSIVE:
    case Attitude.ATTACKSLAYONLY:
      chance += 10;
      break;
  }
  return chance - (s.lifeMax - s.life) - (100 - s.breath);
}

function seekFriendChance(s: Soldier): number {
  let chance = 25 + s.ai.bypassToGreen;
  switch (s.ai.orders) {
    case Orders.STATIONARY:
      chance -= 20;
      break;
    case Orders.ONGUARD:
      chance -= 15;
      break;
    case Orders.CLOSEPATROL:
      chance += 10;
      break;
    case Orders.RNDPTPATROL:
    case Orders.POINTPATROL:
      chance = -10;
      break;
    case Orders.FARPATROL:
      chance += 20;
      break;
    case Orders.SEEKENEMY:
      chance -= 10;
      break;
  }
  switch (s.ai.attitude) {
    case Attitude.BRAVESOLO:
    case Attitude.CUNNINGSOLO:
      chance = Math.trunc(chance / 2);
      break;
    case Attitude.BRAVEAID:
    case Attitude.CUNNINGAID:
      chance += 10;
      break;
  }
  return chance - (s.lifeMax - s.life) - (100 - s.breath);
}

function lookChance(s: Soldier): number {
  let chance = 25 + s.ai.bypassToGreen;
  if (s.ai.orders === Orders.STATIONARY) chance += 25;
  if (s.ai.orders === Orders.ONGUARD) chance += 20;
  if (s.ai.attitude === Attitude.DEFENSIVE) chance += 25;
  return chance;
}

function asInt16(n: number): number {
  return (n << 16) >> 16;
}

export function decideActionGreen(t: TacticalState, s: Soldier, hooks: GreenHooks): number {
  const ai = s.ai;
  const stats = t.pathEnv.stats;
  const pathSearches = () => stats?.searches ?? 0;
  if (stats) stats.searches = 0;
  const boxing = decideActionGreenWhileBoxing(t, s);
  if (boxing !== null) return boxing;
  const mode = (soldier: Soldier, action: number) => determineMovementMode(t, soldier, action);
  const inWater = isWater(t.pathWorld, s.gridNo);
  const inGas = inGasOrSmoke(t, s, s.gridNo);
  if (isCivilianForGreen(s)) {
    if (s.cowering) {
      ai.actionData = AnimHeight.STAND;
      return AiAction.STOP_COWERING;
    }
    if (!t.inCombat) {
      if (ai.checkSchedule) {
        const scheduled = decideActionSchedule(t, s);
        if (scheduled !== AiAction.NONE) return scheduled;
      }
      if (s.profile !== NO_PROFILE) {
        const named = hooks.decideActionNamedNPC(t, s);
        if (named !== AiAction.NONE) return named;
        if (spokeRecently(t, s)) return AiAction.NONE;
      }
    }
    if (!inWater && t.pre.int(5) !== 0) return AiAction.NONE;
  }
  if (ai.orders === Orders.POINTPATROL && s.breath >= REST_BREATH) {
    if (pointPatrolAI(t, s, mode, AiAction.POINT_PATROL)) {
      if (!t.inCombat) {
        ai.nextAction = AiAction.WAIT;
        ai.nextActionData = realtimeDelay(t, s);
      }
      return AiAction.POINT_PATROL;
    }
    if (stats) stats.searches = 0;
  }
  if (ai.orders === Orders.RNDPTPATROL && s.breath >= REST_BREATH) {
    if (randomPointPatrolAI(t, s, mode, AiAction.POINT_PATROL)) {
      if (!t.inCombat) {
        ai.nextAction = AiAction.WAIT;
        ai.nextActionData = realtimeDelay(t, s);
      }
      return AiAction.POINT_PATROL;
    }
    if (stats) stats.searches = 0;
  }
  if (inWater || inGas) {
    ai.actionData = hooks.findNearestUngassedLand(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.LEAVE_WATER_GAS;
  }
  if (s.breath < REST_BREATH && !inWater) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  if (pathSearches() === 0) {
    const chance = patrolChance(s);
    if (inWater || asInt16(t.pre.int(100)) < chance) {
      ai.actionData = randDestWithinRange(t, s);
      if (ai.actionData !== NOWHERE) ai.actionData = goAsFarAsPossibleTowards(t, s, ai.actionData, AiAction.RANDOM_PATROL, mode);
      if (ai.actionData !== NOWHERE) {
        if (!t.inCombat) {
          ai.nextAction = AiAction.WAIT;
          ai.nextActionData = realtimeDelay(t, s);
        }
        return AiAction.RANDOM_PATROL;
      }
    }
  }
  if (pathSearches() === 0) {
    const chance = seekFriendChance(s);
    if (asInt16(t.pre.int(100)) < chance && randomFriendWithin(t, s)) {
      if (ai.actionData === goAsFarAsPossibleTowards(t, s, ai.actionData, AiAction.SEEK_FRIEND, mode)) {
        if (isCivOrMilitia(s) && !t.inCombat) {
          ai.nextAction = AiAction.WAIT;
          ai.nextActionData = realtimeCivDelay(t);
        }
        return AiAction.SEEK_FRIEND;
      }
    }
  }
  if (ai.lastAction !== AiAction.CHANGE_FACING && asInt16(t.pre.int(100)) < lookChance(s)) {
    do {
      if (ai.dominantDir >= 0 && ai.dominantDir <= 8 && s.direction !== ai.dominantDir && t.pre.int(2) !== 0)
        ai.actionData = ai.dominantDir;
      else ai.actionData = t.pre.int(8);
    } while (ai.actionData === s.direction);
    if (!t.inCombat) {
      ai.nextAction = AiAction.WAIT;
      ai.nextActionData = realtimeDelay(t, s);
    }
    return AiAction.CHANGE_FACING;
  }
  ai.actionData = NOWHERE;
  return AiAction.NONE;
}

export interface GreenHooks {
  decideActionNamedNPC(t: TacticalState, s: Soldier): number;
  findNearestUngassedLand(t: TacticalState, s: Soldier): number;
  decideActionYellow(t: TacticalState, s: Soldier): number;
  decideActionRed(t: TacticalState, s: Soldier): number;
  decideActionBlack(t: TacticalState, s: Soldier): number;
}

export const NO_GREEN_HOOKS: GreenHooks = {
  decideActionNamedNPC: () => AiAction.NONE,
  findNearestUngassedLand: () => NOWHERE,
  decideActionYellow: () => AiAction.NONE,
  decideActionRed: () => AiAction.NONE,
  decideActionBlack: () => AiAction.NONE,
};

export function decideAction(t: TacticalState, s: Soldier, hooks: GreenHooks): number {
  const ai = s.ai;
  ai.cautious = false;
  if (ai.bypassToGreen && ai.alertStatus < AlertStatus.BLACK) {
    const action = decideActionGreen(t, s, hooks);
    if (!t.inCombat) ai.bypassToGreen = 0;
    return action;
  }
  switch (ai.alertStatus) {
    case AlertStatus.GREEN:
      return decideActionGreen(t, s, hooks);
    case AlertStatus.YELLOW:
      return hooks.decideActionYellow(t, s);
    case AlertStatus.RED:
      return hooks.decideActionRed(t, s);
    case AlertStatus.BLACK:
      return hooks.decideActionBlack(t, s);
    default:
      return AiAction.NONE;
  }
}

export function stanceHeightOf(t: TacticalState, s: Soldier): number {
  return endHeight(t.content, s.state);
}

export function isStationaryAnimation(t: TacticalState, s: Soldier): boolean {
  return hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY);
}
