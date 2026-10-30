// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/CreatureDecideAction.cc CreatureCall (with the call kind code 717 of Soldier_Ani.cc cries),
// @src CreatureDecideActionGreen/Yellow/Red/Black, CreatureDecideAction, CreatureDecideAlertStatus, CrowDecideActionGreen/Red,
// @src CrowDecideAction; Movement.cc TrackScent; AIUtils.cc ValidCreatureTurn; Attacks.cc AdvanceToFiringRange;
// @src Rotting_Corpses.cc FindNearestRottingCorpse; Realtime.cc REALTIME_CREATURE_AI_DELAY.

import { ItemClass, NOTHING, WEAPON_CLASSES } from '../../../content/items/items.ts';
import { pythSpacesAway, spacesAway, WORLD_COLS, WORLD_ROWS } from '../../../content/world/grid.ts';
import { i8, i16, u8 } from '../../../core/int.ts';
import type { CreatureCallName } from '../../events.ts';
import { ObjectFlags, USABLE_STATUS } from '../../items/object.ts';
import { anim } from '../anim-states.ts';
import { AnimHeight, initNewSoldierAnim } from '../animation.ts';
import { minAPsToAttack } from '../combat/ap.ts';
import { rangeInUnits } from '../combat/chance.ts';
import { findAdjacentGridEx } from '../combat/melee-reach.ts';
import { AimShot } from '../combat/types.ts';
import { quickestTurnIncrement } from '../directions.ts';
import { inGas } from '../explosions/smoke.ts';
import { findObjWithin, InvSlot, NO_SLOT, NUM_INV_SLOTS } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { isWater } from '../pathfinding.ts';
import { closestKnownOpponent, noiseHeard } from '../perception/knowledge.ts';
import { NoiseKind } from '../perception/noise.ts';
import { atan8 } from '../perception/opp.ts';
import { distanceVisible } from '../perception/sight.ts';
import { internalIsValidStance } from '../person-structure.ts';
import { apsToLook, minPtsToMove } from '../points.ts';
import { SmellKind, smellStrength, smellType } from '../smell.ts';
import { AlertStatus, Attitude, Body, isMonster, NOBODY, NOWHERE, OKLIFE, Orders, type Soldier, shownToPlayer } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import { findGridNoFromSweetSpot } from '../sweet-spots.ts';
import { heardOnly, loudestScream } from '../unseen-sources.ts';
import { AiAction } from './actions.ts';
import {
  type AttackChoice,
  calcBestShot,
  calcBestStab,
  calcTentacleAttack,
  canNPCAttack,
  emptyAttackChoice,
  NoShoot,
  rearrangePocket,
} from './attack-choice.ts';
import { findNearestUngassedLand, findSpotMaxDistFromOpponents } from './cover.ts';
import { type AiHooks, checkForChangingOrders, determineMovementMode, setNewSituation } from './decide.ts';
import {
  GoFlag,
  goAsFarAsPossibleTowards,
  internalGoAsFarAsPossibleTowards,
  legalNPCDestination,
  PathMode,
  pointPatrolAI,
  randDestWithinRange,
  randomPointPatrolAI,
} from './destinations.ts';
import { closestReachableDisturbance, findAIUsableObjClass, menInSector } from './utils.ts';

export interface CreatureDeciderHooks {
  readonly npcDoesAct: (t: TacticalState, s: Soldier) => void;
}

export const Mobility = { MOBILE: 0, CRAWLER: 1, IMMOBILE: 2 } as const;
export const CreatureCallKind = { NONE: 0, ONE_PREY: 1, MULTIPLE_PREY: 2, ATTACKED: 3, CRIPPLED: 4 } as const;

const CallerKind = { FEMALE: 0, MALE: 1, QUEEN: 2 } as const;
const CALL_PRIORITY: readonly (readonly number[])[] = [
  [0, 0, 0],
  [3, 5, 12],
  [5, 9, 12],
  [4, 7, 12],
  [6, 9, 12],
];
const HUNT_CALL_PRIORITY: readonly number[] = [0, 4, 5, 7, 8];
const NUM_CREATURE_CALLS = 5;
const PRIORITY_DECR_DISTANCE = 30;
const FRENZY_THRESHOLD = 8;
const MAX_EAT_DIST = 5;
const STOPSHORTDIST = 5;
const STRAIGHT = 13;
const SCENT_RADIUS = 3;
const NO_SCENT = 0;
const AP_RADIO = 5;
const REALTIME_CREATURE_DELAY_BASE = 10000;
const REALTIME_CREATURE_DELAY_STEP = 1000;
const REALTIME_CREATURE_DELAY_STEPS = 3;
const CROW_WAIT = 30000;
const CROW_PECK_RANGE = 2;
const CROW_SWEET_SPOT_RADIUS = 4;
const SPIT_SKIPS_BLADE_ODDS = 4;
const BLOODCAT_CLAW_ODDS = 3;
const STAB_PREFERENCE_NUMERATOR = 12;
const STAB_PREFERENCE_DENOMINATOR = 10;
const HEAD_SHOT_CHANCE = 50;
const ROTTING_STAGE2 = 'ROTTING_STAGE2';

const pre100 = (t: TacticalState) => i16(t.pre.int(100));
const ctx = (t: TacticalState) => ({ env: t.pathEnv, content: t.content, inCombat: t.inCombat });
const mode = (t: TacticalState) => (s: Soldier, action: number) => determineMovementMode(t, s, action);
const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const canCall = (s: Soldier) => s.bodyType !== Body.BLOODCAT && s.bodyType !== Body.LARVAE_MONSTER && s.bodyType !== Body.INFANT_MONSTER;
const canListenToCall = (s: Soldier) => s.bodyType !== Body.BLOODCAT && s.bodyType !== Body.LARVAE_MONSTER;
const crawlerResting = (s: Soldier) => s.ai.mobility === Mobility.CRAWLER && s.actionPoints < s.initialActionPoints;

export function realtimeCreatureDelay(t: TacticalState): number {
  return REALTIME_CREATURE_DELAY_BASE + REALTIME_CREATURE_DELAY_STEP * t.rng.int(REALTIME_CREATURE_DELAY_STEPS);
}

function pauseAfterRealtimeAction(t: TacticalState, s: Soldier, factor = 1): void {
  if (t.inCombat) return;
  s.ai.nextAction = AiAction.WAIT;
  s.ai.nextActionData = realtimeCreatureDelay(t) * factor;
}

function callerKind(s: Soldier): number {
  switch (s.bodyType) {
    case Body.QUEENMONSTER:
      return CallerKind.QUEEN;
    case Body.AM_MONSTER:
    case Body.YAM_MONSTER:
      return CallerKind.MALE;
    default:
      return CallerKind.FEMALE;
  }
}

function fullCallPriority(s: Soldier): number {
  const call = s.ai.actionData;
  if (call < 0 || call >= NUM_CREATURE_CALLS) return 0;
  if (s.hunting) return HUNT_CALL_PRIORITY[call] ?? 0;
  return CALL_PRIORITY[call]?.[callerKind(s)] ?? 0;
}

function playCallAnimation(t: TacticalState, s: Soldier): void {
  switch (s.bodyType) {
    case Body.ADULTFEMALEMONSTER:
    case Body.YAF_MONSTER:
    case Body.AM_MONSTER:
    case Body.YAM_MONSTER:
      initNewSoldierAnim(t, s, anim(t.content, 'MONSTER_UP'), 0, false);
      break;
    case Body.QUEENMONSTER:
      initNewSoldierAnim(t, s, anim(t.content, 'QUEEN_CALL'), 0, false);
      break;
  }
}

function hearsCall(caller: Soldier, r: Soldier): boolean {
  if (!r.placed || r.life < OKLIFE || r === caller || r.ai.alertStatus >= AlertStatus.BLACK) return false;
  return r.bodyType !== Body.LARVAE_MONSTER && r.bodyType !== Body.INFANT_MONSTER && r.bodyType !== Body.QUEENMONSTER;
}

const CALL_NAMES: Readonly<Record<number, CreatureCallName>> = {
  [CreatureCallKind.ONE_PREY]: 'onePrey',
  [CreatureCallKind.MULTIPLE_PREY]: 'multiplePrey',
  [CreatureCallKind.ATTACKED]: 'attacked',
  [CreatureCallKind.CRIPPLED]: 'crippled',
};

export function creatureCall(t: TacticalState, caller: Soldier): void {
  t.perception.awareOfOpposition[caller.team] = true;
  const full = fullCallPriority(caller);
  const call = CALL_NAMES[caller.ai.actionData];
  if (call) {
    const where = shownToPlayer(caller)
      ? {}
      : { unseen: { bodyType: caller.bodyType }, ...heardOnly(t, caller, loudestScream(caller), NoiseKind.SCREAM) };
    t.events.push({ type: 'creatureCall', soldier: caller.id, call, ...where });
  }
  playCallAnimation(t, caller);
  for (const r of teamMembers(t, caller.team)) {
    if (!hearsCall(caller, r)) continue;
    const priority = i8(full - Math.trunc(pythSpacesAway(r.gridNo, caller.gridNo) / PRIORITY_DECR_DISTANCE));
    if (priority <= r.ai.callPriority) continue;
    r.ai.callPriority = u8(priority);
    r.ai.alertStatus = AlertStatus.RED;
    r.ai.caller = caller.id;
    r.ai.callerGridNo = caller.gridNo;
    r.ai.callActedUpon = false;
    t.turnHooks.cancelAIAction(t, r);
    if (priority > FRENZY_THRESHOLD && (r.bodyType === Body.ADULTFEMALEMONSTER || r.bodyType === Body.YAF_MONSTER)) r.ai.frenzied = true;
  }
}

export function validCreatureTurn(t: TacticalState, s: Soldier, newDirection: number): boolean {
  let change = quickestTurnIncrement(s.direction, newDirection);
  for (let loop = 0; loop < 2; loop++) {
    let found = true;
    let direction = s.direction;
    do {
      direction += change;
      if (direction < 0) direction = 7;
      else if (direction > 7) direction = 0;
      if (!internalIsValidStance(t, s, direction, AnimHeight.STAND)) {
        found = false;
        break;
      }
    } while (direction !== newDirection);
    if (found) return true;
    if (loop > 0) return false;
    change = -change;
  }
  return true;
}

function directionDifference(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return diff > 4 ? 8 - diff : diff;
}

interface ScentTrail {
  gridNo: number;
  strength: number;
  directionDiff: number;
}

function sniffTile(t: TacticalState, s: Soldier, g: number, dx: number, dy: number, trail: ScentTrail): void {
  const info = t.smell.smell[g] ?? 0;
  if (!info || smellType(info) !== SmellKind.HUMAN) return;
  const strength = smellStrength(info);
  const x = s.gridNo % WORLD_COLS;
  const y = Math.trunc(s.gridNo / WORLD_COLS);
  if (strength > trail.strength) {
    trail.gridNo = g;
    trail.strength = strength;
    trail.directionDiff = directionDifference(s.direction, atan8(x, y, x + dx, y + dy));
  } else if (strength === trail.strength) {
    if (trail.gridNo === NOWHERE) {
      trail.gridNo = g;
      trail.strength = strength;
      return;
    }
    const diff = directionDifference(s.direction, atan8(x, y, x + dx, y + dy));
    if (diff < trail.directionDiff || (diff === trail.directionDiff && t.rng.int(2))) trail.directionDiff = diff;
  }
}

export function trackScent(t: TacticalState, s: Soldier): number {
  const x = s.gridNo % WORLD_COLS;
  const y = Math.trunc(s.gridNo / WORLD_COLS);
  const trail: ScentTrail = { gridNo: NOWHERE, strength: 0, directionDiff: 5 };
  for (let dy = -SCENT_RADIUS; dy <= SCENT_RADIUS; dy++) {
    if (y + dy < 0) continue;
    if (y + dy > WORLD_ROWS) break;
    const step = dy === -SCENT_RADIUS || dy === SCENT_RADIUS ? 1 : SCENT_RADIUS * 2;
    for (let dx = -SCENT_RADIUS; dx <= SCENT_RADIUS; dx += step) {
      const g = s.gridNo + dx + dy * WORLD_ROWS;
      if (Math.abs((g % WORLD_ROWS) - x) > SCENT_RADIUS) continue;
      if (!legalNPCDestination(t, s, s.ai.actionData, PathMode.ENSURE_PATH, true, 0)) continue;
      sniffTile(t, s, g, dx, dy, trail);
    }
  }
  if (trail.gridNo === NOWHERE) return NO_SCENT;
  s.ai.actionData = trail.gridNo;
  return trail.gridNo;
}

export function findNearestRottingCorpse(t: TacticalState, s: Soldier): number {
  let lowest = Number.POSITIVE_INFINITY;
  let gridNo = NOWHERE;
  for (const c of t.corpses) {
    if (t.content.corpses.table.types[c.type] !== ROTTING_STAGE2) continue;
    const range = rangeInUnits(s.gridNo, c.gridNo);
    if (range < lowest) {
      gridNo = c.gridNo;
      lowest = range;
    }
  }
  return gridNo;
}

function advanceToFiringRange(t: TacticalState, s: Soldier, closest: number): number {
  const attackCost = i8(minAPsToAttack(t, s, closest, true, true));
  if (attackCost >= s.actionPoints) return goAsFarAsPossibleTowards(t, s, closest, AiAction.SEEK_OPPONENT, mode(t));
  const trueActionPoints = s.actionPoints;
  s.actionPoints -= attackCost;
  const data = goAsFarAsPossibleTowards(t, s, closest, AiAction.SEEK_OPPONENT, mode(t));
  s.actionPoints = trueActionPoints;
  return data;
}

const findObj = (s: Soldier, item: number) => findObjWithin(s.inv, item, 0, NUM_INV_SLOTS - 1);

function findObjClass(t: TacticalState, s: Soldier, itemClass: number): number {
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) {
    const def = t.content.items.byIndex.get(s.inv[slot]?.item ?? NOTHING);
    if ((def?.itemClass ?? ItemClass.NONE) & itemClass) return slot;
  }
  return NO_SLOT;
}

function randomPatrolChance(s: Soldier): number {
  let chance = 25;
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
      chance += 10;
      break;
  }
  return chance - (s.lifeMax - s.life) - (100 - s.breath);
}

function lookAroundChance(s: Soldier): number {
  let chance = 25;
  if (s.ai.orders === Orders.STATIONARY) chance += 25;
  if (s.ai.orders === Orders.ONGUARD) chance += 20;
  if (s.ai.attitude === Attitude.DEFENSIVE) chance += 25;
  return chance;
}

function seekNoiseChance(s: Soldier, noiseValue: number): number {
  let chance = 75 + noiseValue;
  switch (s.ai.orders) {
    case Orders.STATIONARY:
      chance -= 20;
      break;
    case Orders.ONGUARD:
      chance -= 15;
      break;
    case Orders.CLOSEPATROL:
      chance -= 10;
      break;
    case Orders.FARPATROL:
      chance += 10;
      break;
    case Orders.SEEKENEMY:
      chance += 25;
      break;
  }
  switch (s.ai.attitude) {
    case Attitude.DEFENSIVE:
      chance -= 10;
      break;
    case Attitude.BRAVESOLO:
      chance += 10;
      break;
    case Attitude.BRAVEAID:
    case Attitude.CUNNINGSOLO:
      chance += 5;
      break;
    case Attitude.AGGRESSIVE:
      chance += 20;
      break;
  }
  return chance - (100 - s.breath);
}

function patrolAlongPoints(t: TacticalState, s: Soldier): number | null {
  const ai = s.ai;
  if (ai.orders === Orders.POINTPATROL && s.breath >= 50 && pointPatrolAI(t, s, mode(t), AiAction.POINT_PATROL)) {
    pauseAfterRealtimeAction(t, s);
    return AiAction.POINT_PATROL;
  }
  if (ai.orders === Orders.RNDPTPATROL && s.breath >= 50 && randomPointPatrolAI(t, s, mode(t), AiAction.POINT_PATROL)) {
    pauseAfterRealtimeAction(t, s);
    return AiAction.POINT_PATROL;
  }
  return null;
}

function randomLookDirection(t: TacticalState, s: Soldier): number {
  const ai = s.ai;
  let direction: number;
  do {
    if (ai.dominantDir >= 0 && ai.dominantDir <= 8 && s.direction !== ai.dominantDir && t.pre.int(2)) direction = ai.dominantDir;
    else direction = t.pre.int(8);
  } while (direction === s.direction);
  return direction;
}

function creatureDecideActionGreen(t: TacticalState, s: Soldier): number {
  const ai = s.ai;
  if (crawlerResting(s)) return AiAction.NONE;
  const gas = inGas(t, s, s.gridNo);
  if (ai.mobility === Mobility.MOBILE) {
    if (trackScent(t, s)) return AiAction.TRACK;
    const patrol = patrolAlongPoints(t, s);
    if (patrol !== null) return patrol;
    if (gas) {
      ai.actionData = findNearestUngassedLand(t, s);
      if (ai.actionData !== NOWHERE) return AiAction.LEAVE_WATER_GAS;
    }
  }
  if (s.breath < 75) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  if (ai.mobility !== Mobility.IMMOBILE) {
    if (pre100(t) < randomPatrolChance(s)) {
      ai.actionData = randDestWithinRange(t, s);
      if (ai.actionData !== NOWHERE) {
        pauseAfterRealtimeAction(t, s, ai.mobility === Mobility.CRAWLER ? 2 : 1);
        return AiAction.RANDOM_PATROL;
      }
    }
    if (ai.lastAction !== AiAction.CHANGE_FACING && apsToLook(t.content, s) <= s.actionPoints && pre100(t) < lookAroundChance(s)) {
      ai.actionData = randomLookDirection(t, s);
      if (validCreatureTurn(t, s, ai.actionData)) {
        pauseAfterRealtimeAction(t, s);
        return AiAction.CHANGE_FACING;
      }
    }
  }
  ai.actionData = NOWHERE;
  return AiAction.NONE;
}

function creatureDecideActionYellow(t: TacticalState, s: Soldier): number {
  const ai = s.ai;
  if (crawlerResting(s)) return AiAction.NONE;
  const noise = noiseHeard(t, s);
  if (noise.gridNo === NOWHERE) return AiAction.NONE;
  if (ai.mobility !== Mobility.IMMOBILE) {
    const noiseDir = directionToward(s.gridNo, noise.gridNo);
    if (apsToLook(t.content, s) <= s.actionPoints && s.direction !== noiseDir && pythSpacesAway(s.gridNo, noise.gridNo) <= STRAIGHT) {
      let chance = ai.orders === Orders.STATIONARY || ai.orders === Orders.ONGUARD ? 60 : 35;
      if (ai.attitude === Attitude.DEFENSIVE) chance += 15;
      if (pre100(t) < chance) {
        ai.actionData = noiseDir;
        if (validCreatureTurn(t, s, noiseDir)) return AiAction.CHANGE_FACING;
      }
    }
  }
  if (s.breath < 25) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  if (ai.mobility !== Mobility.IMMOBILE && noise.reachable) {
    if (pre100(t) < seekNoiseChance(s, noise.value)) {
      ai.actionData = goAsFarAsPossibleTowards(t, s, noise.gridNo, AiAction.SEEK_NOISE, mode(t));
      if (ai.actionData !== NOWHERE) return AiAction.SEEK_NOISE;
    }
    if (trackScent(t, s)) return AiAction.TRACK;
  }
  ai.actionData = NOWHERE;
  return AiAction.NONE;
}

function canRadio(t: TacticalState, s: Soldier): boolean {
  return s.actionPoints >= AP_RADIO && menInSector(t, s.team) > 1;
}

function callForHelpWhenHurt(t: TacticalState, s: Soldier, crippledCall: boolean): number | null {
  if (!canCall(s) || !canRadio(t, s) || s.life >= s.oldLife) return null;
  if (crippledCall && s.oldLife === s.lifeMax && s.oldLife - s.life > 10) return creatureCallAction(s, CreatureCallKind.CRIPPLED);
  if (Math.trunc(s.lifeMax / s.life) > 2) return creatureCallAction(s, CreatureCallKind.ATTACKED);
  return null;
}

function creatureCallAction(s: Soldier, call: number): number {
  s.ai.actionData = call;
  s.oldLife = s.life;
  return AiAction.CREATURE_CALL;
}

function closestOpponentTurn(t: TacticalState, s: Soldier): number | null {
  if (apsToLook(t.content, s) > s.actionPoints) return null;
  const closest = closestKnownOpponent(t, s);
  if (closest === NOWHERE) return null;
  const dir = directionToward(s.gridNo, closest);
  const visible = distanceVisible(t, s, -1, -1, closest, 0);
  if (s.direction === dir || pythSpacesAway(s.gridNo, closest) > visible) return null;
  let chance = s.ai.orders === Orders.STATIONARY || s.ai.orders === Orders.ONGUARD ? 50 : 25;
  if (s.ai.attitude === Attitude.DEFENSIVE) chance += 25;
  if (pre100(t) < chance && validCreatureTurn(t, s, dir)) {
    s.ai.actionData = dir;
    return AiAction.CHANGE_FACING;
  }
  return null;
}

function answerCall(t: TacticalState, s: Soldier): number | null {
  const ai = s.ai;
  if (!canListenToCall(s) || ai.caller === NOBODY) return null;
  if (pythSpacesAway(s.gridNo, ai.callerGridNo) <= STOPSHORTDIST) {
    ai.caller = NOBODY;
    return null;
  }
  ai.actionData = internalGoAsFarAsPossibleTowards(t, s, ai.callerGridNo, -1, AiAction.SEEK_FRIEND, GoFlag.STOPSHORT, mode(t));
  return ai.actionData !== NOWHERE ? AiAction.SEEK_FRIEND : null;
}

function approachCorpse(t: TacticalState, s: Soldier): number | null {
  const ai = s.ai;
  if (!s.hunting) return null;
  ai.actionData = findNearestRottingCorpse(t, s);
  if (ai.actionData === NOWHERE || pythSpacesAway(s.gridNo, ai.actionData) >= MAX_EAT_DIST) return null;
  const spot = findAdjacentGridEx(t, s, ai.actionData, false);
  if (!spot) return null;
  ai.actionData = spot.actionGridNo;
  return AiAction.APPROACH_MERC;
}

function creatureDecideActionRed(t: TacticalState, s: Soldier): number {
  const ai = s.ai;
  if (!s.actionPoints) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  if (crawlerResting(s)) return AiAction.NONE;
  const canMove = ai.mobility !== Mobility.IMMOBILE && s.actionPoints >= minPtsToMove(ctx(t), s, s.uiMovementMode);
  if (inGas(t, s, s.gridNo) && canMove) {
    ai.actionData = findNearestUngassedLand(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.LEAVE_WATER_GAS;
  }
  const hurt = callForHelpWhenHurt(t, s, true);
  if (hurt !== null) return hurt;
  if (s.breath < 25 && !ai.underFire) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  if (canCall(s) && !t.perception.awareOfOpposition[s.team] && canRadio(t, s) && pre100(t) < 20) {
    ai.actionData = CreatureCallKind.ONE_PREY;
    return AiAction.CREATURE_CALL;
  }
  if (ai.mobility !== Mobility.IMMOBILE) {
    if (findAIUsableObjClass(t, s, WEAPON_CLASSES) === NO_SLOT) {
      ai.actionData = findSpotMaxDistFromOpponents(t, s);
      return ai.actionData !== NOWHERE ? AiAction.RUN_AWAY : AiAction.NONE;
    }
    const answer = answerCall(t, s);
    if (answer !== null) return answer;
    const disturbance = closestReachableDisturbance(t, s).gridNo;
    if (disturbance !== NOWHERE) {
      ai.actionData = goAsFarAsPossibleTowards(t, s, disturbance, AiAction.SEEK_OPPONENT, mode(t));
      if (ai.actionData !== NOWHERE) return AiAction.SEEK_OPPONENT;
    }
    const corpse = approachCorpse(t, s);
    if (corpse !== null) return corpse;
    if (trackScent(t, s)) return AiAction.TRACK;
    const turn = closestOpponentTurn(t, s);
    if (turn !== null) return turn;
  }
  ai.actionData = NOWHERE;
  return AiAction.NONE;
}

function blackCall(t: TacticalState, s: Soldier): number | null {
  if (!canCall(s) || !canRadio(t, s)) return null;
  if (s.life < s.oldLife) return Math.trunc(s.lifeMax / s.life) > 2 ? creatureCallAction(s, CreatureCallKind.ATTACKED) : null;
  if (t.perception.awareOfOpposition[s.team]) return null;
  const chance = s.bodyType === Body.QUEENMONSTER ? 100 : 20 * s.ai.oppCount;
  if (t.rng.int(100) >= chance) return null;
  s.ai.actionData = s.ai.oppCount > 1 ? CreatureCallKind.MULTIPLE_PREY : CreatureCallKind.ONE_PREY;
  return AiAction.CREATURE_CALL;
}

interface CreatureAttackPlan {
  canAttack: boolean;
  runAway: boolean;
}

function readyCreatureWeapon(t: TacticalState, s: Soldier, gas: boolean): CreatureAttackPlan {
  if (s.actionPoints < 2 || gas) return { canAttack: false, runAway: false };
  const result = canNPCAttack(t, s);
  if (result === 1) return { canAttack: true, runAway: false };
  if (result !== NoShoot.NOAMMO) return { canAttack: false, runAway: false };
  const hand = s.inv[InvSlot.HAND];
  if (hand) hand.flags |= ObjectFlags.AI_UNUSABLE;
  const fallback = findObjClass(t, s, s.bodyType === Body.QUEENMONSTER ? ItemClass.TENTACLES : ItemClass.BLADE);
  if (fallback === NO_SLOT) return { canAttack: false, runAway: true };
  rearrangePocket(s, InvSlot.HAND, fallback);
  return { canAttack: true, runAway: false };
}

interface ShotPlan {
  readonly shot: AttackChoice;
  readonly spitIn: number;
  readonly fallBackToRed: boolean;
}

function planSpit(t: TacticalState, s: Soldier, hooks: CreatureDeciderHooks): ShotPlan {
  const none = { shot: emptyAttackChoice(), spitIn: NO_SLOT, fallBackToRed: false };
  const weaponIn = findObjClass(t, s, ItemClass.GUN);
  if (weaponIn === NO_SLOT) return none;
  const gun = s.inv[weaponIn];
  if (t.content.items.byIndex.get(gun?.item ?? NOTHING)?.itemClass !== ItemClass.GUN || (gun?.status[0] ?? 0) < USABLE_STATUS) return none;
  if ((gun?.gunShotsLeft ?? 0) <= 0) return none;
  if (weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, weaponIn);
  let shot = emptyAttackChoice();
  if (s.actionPoints >= minAPsToAttack(t, s, s.lastTarget, false)) {
    shot = calcBestShot(t, s);
    if (shot.possible) {
      shot.weaponIn = weaponIn;
      const opp = shot.opponent;
      if (opp && opp.life < OKLIFE && s.ai.attitude !== Attitude.AGGRESSIVE && closestReachableDisturbance(t, s).gridNo !== NOWHERE)
        return { shot, spitIn: weaponIn, fallBackToRed: true };
      hooks.npcDoesAct(t, s);
    }
  }
  if (weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, weaponIn);
  return { shot, spitIn: weaponIn, fallBackToRed: false };
}

function stabWeaponSlot(t: TacticalState, s: Soldier, spitIn: number): number {
  if (s.bodyType === Body.QUEENMONSTER) return findObjClass(t, s, ItemClass.TENTACLES);
  if (s.bodyType === Body.BLOODCAT)
    return findObj(s, itemIndex(t, t.pre.int(BLOODCAT_CLAW_ODDS) ? 'BLOODCAT_CLAW_ATTACK' : 'BLOODCAT_BITE'));
  if (spitIn !== NO_SLOT && t.rng.int(SPIT_SKIPS_BLADE_ODDS)) return NO_SLOT;
  return findObjClass(t, s, ItemClass.BLADE);
}

function planStab(t: TacticalState, s: Soldier, hooks: CreatureDeciderHooks, spitIn: number): AttackChoice {
  let best = emptyAttackChoice();
  const weaponIn = stabWeaponSlot(t, s, spitIn);
  if (weaponIn === NO_SLOT) return best;
  if (weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, weaponIn);
  if (s.actionPoints < minAPsToAttack(t, s, s.lastTarget, false)) return best;
  const current = s.bodyType === Body.QUEENMONSTER ? calcTentacleAttack(t, s) : calcBestStab(t, s, true);
  if (current.possible) hooks.npcDoesAct(t, s);
  if (weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, weaponIn);
  if (current.attackValue > best.attackValue) best = { ...current, weaponIn };
  return best;
}

function launchCreatureAttack(s: Soldier, action: number, best: AttackChoice): number {
  if (best.weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, best.weaponIn);
  s.ai.actionData = best.target;
  s.aimTime = best.aimTime;
  s.aimShotLocation = action === AiAction.FIRE_GUN && best.chanceToReallyHit > HEAD_SHOT_CHANCE ? AimShot.HEAD : AimShot.RANDOM;
  return action;
}

function closeOnOpponent(t: TacticalState, s: Soldier, canMove: boolean, spitIn: number): number | null {
  const ai = s.ai;
  if (apsToLook(t.content, s) > s.actionPoints) return null;
  const closest = closestKnownOpponent(t, s);
  if (closest === NOWHERE) return null;
  if (canMove && pythSpacesAway(s.gridNo, closest) > 2) {
    if (spitIn !== NO_SLOT) {
      ai.actionData = advanceToFiringRange(t, s, closest);
      if (ai.actionData === NOWHERE) ai.actionData = goAsFarAsPossibleTowards(t, s, closest, AiAction.SEEK_OPPONENT, mode(t));
    } else ai.actionData = goAsFarAsPossibleTowards(t, s, closest, AiAction.SEEK_OPPONENT, mode(t));
  } else ai.actionData = NOWHERE;
  if (ai.actionData !== NOWHERE) return AiAction.SEEK_OPPONENT;
  if (apsToLook(t.content, s) > s.actionPoints) return null;
  const dir = directionToward(s.gridNo, closest);
  if (s.direction !== dir && validCreatureTurn(t, s, dir)) {
    ai.actionData = dir;
    return AiAction.CHANGE_FACING;
  }
  return null;
}

function creatureDecideActionBlack(t: TacticalState, s: Soldier, hooks: CreatureDeciderHooks): number {
  const ai = s.ai;
  if (!s.actionPoints) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  if (crawlerResting(s)) return AiAction.NONE;
  const call = blackCall(t, s);
  if (call !== null) return call;
  const canMove = ai.mobility !== Mobility.IMMOBILE && s.actionPoints >= minPtsToMove(ctx(t), s, s.uiMovementMode);
  const gas = inGas(t, s, s.gridNo);
  if ((gas || s.breath < 5) && canMove) {
    ai.actionData = findSpotMaxDistFromOpponents(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.RUN_AWAY;
  }
  if (gas && canMove) {
    ai.actionData = findNearestUngassedLand(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.LEAVE_WATER_GAS;
  }
  const plan = readyCreatureWeapon(t, s, gas);
  let spitIn = NO_SLOT;
  if (plan.canAttack) {
    s.aimShotLocation = AimShot.RANDOM;
    const spit = planSpit(t, s, hooks);
    if (spit.fallBackToRed) return creatureDecideActionRed(t, s);
    spitIn = spit.spitIn;
    const stab = planStab(t, s, hooks, spitIn);
    let action: number = spit.shot.possible ? AiAction.FIRE_GUN : AiAction.NONE;
    const shotValue = spit.shot.possible ? spit.shot.attackValue : 0;
    if (stab.possible && stab.attackValue > Math.trunc((shotValue * STAB_PREFERENCE_NUMERATOR) / STAB_PREFERENCE_DENOMINATOR))
      action = AiAction.KNIFE_MOVE;
    if (action !== AiAction.NONE) return launchCreatureAttack(s, action, action === AiAction.FIRE_GUN ? spit.shot : stab);
  }
  if (!plan.runAway) {
    const close = closeOnOpponent(t, s, canMove, spitIn);
    if (close !== null) return close;
  } else if (canMove) {
    ai.actionData = findSpotMaxDistFromOpponents(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.RUN_AWAY;
  }
  ai.actionData = NOWHERE;
  return AiAction.NONE;
}

export function creatureDecideAction(t: TacticalState, s: Soldier, hooks: CreatureDeciderHooks): number {
  switch (s.ai.alertStatus) {
    case AlertStatus.GREEN:
      return creatureDecideActionGreen(t, s);
    case AlertStatus.YELLOW:
      return creatureDecideActionYellow(t, s);
    case AlertStatus.RED:
      return creatureDecideActionRed(t, s);
    case AlertStatus.BLACK:
      return creatureDecideActionBlack(t, s, hooks);
    default:
      return AiAction.NONE;
  }
}

function mobilityOf(s: Soldier): number | null {
  switch (s.bodyType) {
    case Body.ADULTFEMALEMONSTER:
    case Body.YAF_MONSTER:
    case Body.AM_MONSTER:
    case Body.YAM_MONSTER:
    case Body.INFANT_MONSTER:
      return Mobility.MOBILE;
    case Body.QUEENMONSTER:
      return Mobility.IMMOBILE;
    case Body.LARVAE_MONSTER:
      return Mobility.CRAWLER;
    default:
      return null;
  }
}

function alertStatusFromSenses(t: TacticalState, s: Soldier, hooks: AiHooks): void {
  const ai = s.ai;
  const old = ai.alertStatus;
  if (ai.oppCount > 0) {
    ai.alertStatus = AlertStatus.BLACK;
    return;
  }
  if (old === AlertStatus.BLACK) ai.alertStatus = AlertStatus.RED;
  else if (old === AlertStatus.YELLOW) {
    if (hooks.awareOfOpposition(t, s.team) || ai.underFire) ai.alertStatus = AlertStatus.RED;
    else if (hooks.mostImportantNoiseHeard(t, s) === NOWHERE && !ai.actionInProgress) ai.alertStatus = AlertStatus.GREEN;
  } else if (old === AlertStatus.GREEN) {
    if (hooks.awareOfOpposition(t, s.team) || ai.underFire) ai.alertStatus = AlertStatus.RED;
    else if (hooks.mostImportantNoiseHeard(t, s) !== NOWHERE) ai.alertStatus = AlertStatus.YELLOW;
  }
}

export function creatureDecideAlertStatus(t: TacticalState, s: Soldier, hooks: AiHooks): void {
  const ai = s.ai;
  const mobility = mobilityOf(s);
  if (mobility !== null) ai.mobility = mobility;
  if (s.bodyType === Body.LARVAE_MONSTER) {
    ai.alertStatus = AlertStatus.GREEN;
    return;
  }
  const old = ai.alertStatus;
  alertStatusFromSenses(t, s, hooks);
  if (ai.alertStatus !== old) {
    if (old < AlertStatus.RED || ai.alertStatus < AlertStatus.RED) setNewSituation(t, s);
    if (old < AlertStatus.RED && ai.alertStatus >= AlertStatus.RED) checkForChangingOrders(s);
    return;
  }
  const tired = (ai.alertStatus === AlertStatus.GREEN && s.breath < 75) || (ai.alertStatus === AlertStatus.YELLOW && s.breath < 50);
  if (!tired || isWater(t.pathWorld, s.gridNo)) return;
  setNewSituation(t, s);
  if (ai.alertStatus === AlertStatus.YELLOW && hooks.mostImportantNoiseHeard(t, s) === NOWHERE) {
    ai.alertStatus = AlertStatus.GREEN;
    checkForChangingOrders(s);
  }
}

function crowDecideActionGreen(t: TacticalState, s: Soldier): number {
  const corpse = findNearestRottingCorpse(t, s);
  if (corpse === NOWHERE) return AiAction.NONE;
  if (spacesAway(s.gridNo, corpse) < CROW_PECK_RANGE) {
    const facing = directionToward(s.gridNo, corpse);
    if (facing !== s.direction) {
      s.ai.actionData = facing;
      return AiAction.CHANGE_FACING;
    }
    if (!t.inCombat) {
      s.ai.actionData = CROW_WAIT;
      return AiAction.WAIT;
    }
    return AiAction.NONE;
  }
  s.ai.actionData = findGridNoFromSweetSpot(t, s, corpse, CROW_SWEET_SPOT_RADIUS);
  return s.ai.actionData !== NOWHERE ? AiAction.GET_CLOSER : AiAction.NONE;
}

function crowDecideActionRed(t: TacticalState, s: Soldier): number {
  if (t.inCombat) return AiAction.NONE;
  s.ai.actionData = CROW_WAIT;
  return AiAction.WAIT;
}

export function crowDecideAction(t: TacticalState, s: Soldier): number {
  if (s.state === anim(t.content, 'CROW_FLY')) return AiAction.NONE;
  return s.ai.alertStatus <= AlertStatus.YELLOW ? crowDecideActionGreen(t, s) : crowDecideActionRed(t, s);
}

export function isCrow(s: Soldier): boolean {
  return s.bodyType === Body.CROW;
}

export function decidesAsCreature(s: Soldier): boolean {
  return isMonster(s) || s.bodyType === Body.BLOODCAT;
}
