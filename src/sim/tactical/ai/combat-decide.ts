// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/DecideAction.cc DecideActionYellow, DecideActionRed, DecideActionBlack. See docs/13 §3, §5, §6.

import { ItemClass, NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, newGridNo, pythSpacesAway, spacesAway, WORLD_COLS } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { ObjectFlags } from '../../items/object.ts';
import { civGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { AnimHeight, endHeight, height } from '../animation.ts';
import { calcAPsToBurst, minAPsToAttack } from '../combat/ap.ts';
import { soldierDifficultyLevel } from '../combat/chance.ts';
import { okFallDirection } from '../combat/hit.ts';
import { AiMorale } from '../combat/types.ts';
import { inGasOrSmoke } from '../explosions/smoke.ts';
import { calcMaxTossRange } from '../explosions/throwing.ts';
import { autoPlaceObject, InvSlot } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { CivGroupHostility } from '../narrative/constants.ts';
import { isWater } from '../pathfinding.ts';
import { closestKnownOpponent, noiseHeard, whatIKnowThatPublicDont } from '../perception/knowledge.ts';
import { distanceVisible } from '../perception/sight.ts';
import { internalIsValidStance, isValidStance } from '../person-structure.ts';
import { apsToChangeStance, apsToLook, apsToReadyWeapon, calcActionPoints, MAX_AP_CARRIED, minPtsToMove } from '../points.ts';
import { AlertStatus, Attitude, Body, CivilianGroup, NO_PROFILE, NOWHERE, OKLIFE, Orders, type Soldier, Team } from '../soldier.ts';
import { soldierInventoryContext } from '../soldier-inventory.ts';
import type { TacticalState } from '../state.ts';
import { AiAction, Situation } from './actions.ts';
import {
  type AttackChoice,
  calcBestShot,
  calcBestStab,
  calcSpreadBurst,
  canNPCAttack,
  checkIfTossPossible,
  emptyAttackChoice,
  NoShoot,
  rearrangePocket,
  shootingStanceChange,
  stanceChange,
} from './attack-choice.ts';
import {
  findBestNearbyCover,
  findNearbyDarkerSpot,
  findNearestUngassedLand,
  findSpotMaxDistFromOpponents,
  inLightAtNight,
} from './cover.ts';
import { determineMovementMode, realtimeCivDelay } from './decide.ts';
import { GoFlag, goAsFarAsPossibleTowards, internalGoAsFarAsPossibleTowards } from './destinations.ts';
import { ItemSearch, searchForItems } from './item-search.ts';
import { calcMorale, rangeChangeDesire } from './morale.ts';
import {
  closestReachableDisturbance,
  closestReachableFriendInTrouble,
  closestSeenOpponent,
  findAIUsableObjClass,
  getHighestVisibleWatchedLoc,
  getHighestWatchedLocPoints,
  locationToLocationLos,
  menInSector,
  watchedLocGridNo,
} from './utils.ts';

export interface CombatDeciderHooks {
  readonly decideActionGreen: (t: TacticalState, s: Soldier) => number;
  readonly npcDoesAct: (t: TacticalState, s: Soldier) => void;
}

const FATCIV = 11;
const CRIPPLECIV = 17;
const ELDIN = 61;
const MAX_DISTANCE_VISIBLE = 26;
const BURSTING = 5;
const MIN_PRONE_RANGE = 50;
const MIN_BLEEDING_THRESHOLD = 12;
const AP_RADIO = 5;
const AP_CROUCH = 2;
const RADIO_RED_ALERT_BY_DIFFICULTY = [50, 65, 80, 90, 95];

const i8 = (v: number) => ((v & 0xff) << 24) >> 24;
const i16 = (v: number) => ((v & 0xffff) << 16) >> 16;
const u8 = (v: number) => v & 0xff;
const isTank = (s: Soldier) => s.bodyType === Body.TANK_NW || s.bodyType === Body.TANK_NE;
const inWater = (s: Soldier) => s.overTerrain >= Terrain.LOW_WATER && s.overTerrain <= Terrain.DEEP_WATER;
const deepWater = (t: TacticalState, g: number) => (t.world.terrain[g] ?? 0) === Terrain.DEEP_WATER;
const ctx = (t: TacticalState) => ({ env: t.pathEnv, content: t.content, inCombat: t.inCombat });
const mode = (t: TacticalState) => (s: Soldier, action: number) => determineMovementMode(t, s, action);

const groupStillNeutral = (t: TacticalState, s: Soldier) => civGroupHostility(t.civGroups, s.civilianGroup) === CivGroupHostility.NEUTRAL;

function civilianForYellow(t: TacticalState, s: Soldier): boolean {
  return (
    s.team === Team.CIV &&
    (s.civilianGroup === CivilianGroup.NONE || (s.neutral && groupStillNeutral(t, s)) || (FATCIV <= s.bodyType && s.bodyType <= CRIPPLECIV))
  );
}

function civilianForRed(t: TacticalState, s: Soldier): boolean {
  return (
    s.team === Team.CIV &&
    (s.civilianGroup === CivilianGroup.NONE || (s.neutral && groupStillNeutral(t, s)) || (FATCIV <= s.bodyType && s.bodyType <= CRIPPLECIV))
  );
}

function ordersAdjust(orders: number, table: readonly number[]): number {
  return table[orders] ?? 0;
}

const ORDER_INDEX = (o: Record<keyof typeof Orders, number>) => {
  const table: number[] = [];
  table[Orders.STATIONARY] = o.STATIONARY;
  table[Orders.ONGUARD] = o.ONGUARD;
  table[Orders.CLOSEPATROL] = o.CLOSEPATROL;
  table[Orders.FARPATROL] = o.FARPATROL;
  table[Orders.POINTPATROL] = o.POINTPATROL;
  table[Orders.ONCALL] = o.ONCALL;
  table[Orders.SEEKENEMY] = o.SEEKENEMY;
  table[Orders.RNDPTPATROL] = o.RNDPTPATROL;
  return table;
};

const ATTITUDE_INDEX = (a: Record<keyof typeof Attitude, number>) => {
  const table: number[] = [];
  for (const [k, v] of Object.entries(a)) table[Attitude[k as keyof typeof Attitude]] = v;
  return table;
};

const YELLOW_RADIO_ORDERS = ORDER_INDEX({
  STATIONARY: 20,
  ONGUARD: 15,
  ONCALL: 10,
  CLOSEPATROL: 0,
  RNDPTPATROL: 0,
  POINTPATROL: 0,
  FARPATROL: -10,
  SEEKENEMY: -20,
});
const RADIO_ATTITUDES = ATTITUDE_INDEX({
  DEFENSIVE: 20,
  BRAVESOLO: -10,
  BRAVEAID: 0,
  CUNNINGSOLO: -5,
  CUNNINGAID: 0,
  AGGRESSIVE: -20,
  ATTACKSLAYONLY: 0,
});
const SEEK_NOISE_ORDERS = ORDER_INDEX({
  STATIONARY: -20,
  ONGUARD: -15,
  ONCALL: 0,
  CLOSEPATROL: -10,
  RNDPTPATROL: 0,
  POINTPATROL: 0,
  FARPATROL: 10,
  SEEKENEMY: 25,
});
const SEEK_NOISE_ATTITUDES = ATTITUDE_INDEX({
  DEFENSIVE: -10,
  BRAVESOLO: 10,
  BRAVEAID: 5,
  CUNNINGSOLO: 5,
  CUNNINGAID: 0,
  AGGRESSIVE: 20,
  ATTACKSLAYONLY: 20,
});
const SEEK_FRIEND_ORDERS = ORDER_INDEX({
  STATIONARY: -20,
  ONGUARD: -15,
  ONCALL: 20,
  CLOSEPATROL: -10,
  RNDPTPATROL: -10,
  POINTPATROL: -10,
  FARPATROL: 0,
  SEEKENEMY: 10,
});
const SEEK_FRIEND_ATTITUDES = ATTITUDE_INDEX({
  DEFENSIVE: -10,
  BRAVESOLO: 0,
  BRAVEAID: 20,
  CUNNINGSOLO: 0,
  CUNNINGAID: 20,
  AGGRESSIVE: -20,
  ATTACKSLAYONLY: -20,
});
const COVER_ORDERS = ORDER_INDEX({
  STATIONARY: 20,
  ONGUARD: 15,
  ONCALL: 0,
  CLOSEPATROL: 10,
  RNDPTPATROL: 0,
  POINTPATROL: 0,
  FARPATROL: -5,
  SEEKENEMY: -20,
});
const COVER_ATTITUDES = ATTITUDE_INDEX({
  DEFENSIVE: 10,
  BRAVESOLO: -15,
  BRAVEAID: -20,
  CUNNINGSOLO: 20,
  CUNNINGAID: 15,
  AGGRESSIVE: -10,
  ATTACKSLAYONLY: -10,
});
const RED_RADIO_ORDERS = ORDER_INDEX({
  STATIONARY: 20,
  ONGUARD: 15,
  ONCALL: 10,
  CLOSEPATROL: 0,
  RNDPTPATROL: -5,
  POINTPATROL: -5,
  FARPATROL: -10,
  SEEKENEMY: -20,
});

function pre100(t: TacticalState): number {
  return i16(t.pre.int(100));
}

export function decideActionYellow(t: TacticalState, s: Soldier, hooks: CombatDeciderHooks): number {
  const ai = s.ai;
  const civilian = civilianForYellow(t, s);
  if (civilian && s.cowering) {
    ai.actionData = AnimHeight.STAND;
    return AiAction.STOP_COWERING;
  }
  const noise = noiseHeard(t, s);
  if (noise.gridNo === NOWHERE) return AiAction.NONE;
  let reachable = noise.reachable;
  const noiseDir = directionToward(s.gridNo, noise.gridNo);
  if (!t.inCombat || apsToLook(t.content, s) <= s.actionPoints) {
    if (s.direction !== noiseDir && pythSpacesAway(s.gridNo, noise.gridNo) <= MAX_DISTANCE_VISIBLE) {
      let chance = ai.orders === Orders.STATIONARY || ai.orders === Orders.ONGUARD ? 60 : 35;
      if (ai.attitude === Attitude.DEFENSIVE) chance += 15;
      if (pre100(t) < chance && internalIsValidStance(t, s, noiseDir, endHeight(t.content, s.state))) {
        ai.actionData = noiseDir;
        return AiAction.CHANGE_FACING;
      }
    }
  }
  if (!civilian && s.actionPoints >= AP_RADIO && menInSector(t, s.team) > 1) {
    let chance = 5 * whatIKnowThatPublicDont(t, s, false);
    if (chance && !deepWater(t, s.gridNo)) {
      chance += Math.trunc((RADIO_RED_ALERT_BY_DIFFICULTY[soldierDifficultyLevel(t, s)] ?? 0) / 2);
      chance += ordersAdjust(ai.orders, YELLOW_RADIO_ORDERS);
      if (ai.attitude === Attitude.ATTACKSLAYONLY) chance = 0;
      else chance += RADIO_ATTITUDES[ai.attitude] ?? 0;
      if (pre100(t) < chance) return AiAction.YELLOW_ALERT;
    }
  }
  if (isTank(s)) return AiAction.NONE;
  if (s.breath < 25 && !inWater(s)) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  if (!(s.team === Team.CIV && s.profile !== NO_PROFILE && s.profile !== ELDIN)) {
    if (
      reachable &&
      !noise.climb &&
      !t.inCombat &&
      (s.team === Team.MILITIA || s.team === Team.CIV) &&
      pythSpacesAway(s.gridNo, noise.gridNo) < 5
    ) {
      if (locationToLocationLosFrom(t, s, noise.gridNo)) {
        reachable = false;
        ai.noiseGridNo = NOWHERE;
        ai.noiseVolume = 0;
      }
    }
    if (reachable) {
      let chance = 95 + Math.trunc(noise.value / 3);
      chance += ordersAdjust(ai.orders, SEEK_NOISE_ORDERS);
      chance += SEEK_NOISE_ATTITUDES[ai.attitude] ?? 0;
      chance -= 100 - s.breath;
      if (pre100(t) < chance) {
        ai.actionData = goAsFarAsPossibleTowards(t, s, noise.gridNo, AiAction.SEEK_NOISE, mode(t));
        if (ai.actionData !== NOWHERE) return noise.climb && ai.actionData === noise.gridNo ? AiAction.MOVE_TO_CLIMB : AiAction.SEEK_NOISE;
      }
    }
    const friend = closestReachableFriendInTrouble(t, s);
    if (friend && friend.gridNo !== NOWHERE) {
      let chance = 50 - spacesAway(s.gridNo, friend.gridNo);
      chance += ordersAdjust(ai.orders, SEEK_FRIEND_ORDERS);
      chance += SEEK_FRIEND_ATTITUDES[ai.attitude] ?? 0;
      chance -= 100 - s.breath;
      if (pre100(t) < chance) {
        ai.actionData = goAsFarAsPossibleTowards(t, s, friend.gridNo, AiAction.SEEK_FRIEND, mode(t));
        if (ai.actionData !== NOWHERE)
          return friend.climb && ai.actionData === friend.gridNo ? AiAction.MOVE_TO_CLIMB : AiAction.SEEK_FRIEND;
      }
    }
    if (!t.turn.skipCoverCheck && t.inCombat) {
      let chance = 25 + ordersAdjust(ai.orders, COVER_ORDERS) + (COVER_ATTITUDES[ai.attitude] ?? 0);
      chance -= 100 - s.breath;
      if (pre100(t) < chance) {
        ai.morale = calcMorale(t, s);
        ai.actionData = findBestNearbyCover(t, s, ai.morale).gridNo;
        if (ai.actionData !== NOWHERE) return AiAction.TAKE_COVER;
      }
    }
  }
  if (pre100(t) < 50) {
    ai.bypassToGreen = 15;
    return hooks.decideActionGreen(t, s);
  }
  if (!civilian && height(t.content, s.state) !== AnimHeight.CROUCH && isValidStance(t, s, AnimHeight.CROUCH)) {
    if (!t.inCombat || apsToChangeStance(t.content, s, AnimHeight.CROUCH) <= s.actionPoints) {
      ai.actionData = AnimHeight.CROUCH;
      return AiAction.CHANGE_STANCE;
    }
  }
  ai.actionData = NOWHERE;
  return AiAction.NONE;
}

function locationToLocationLosFrom(t: TacticalState, s: Soldier, g: number): boolean {
  return locationToLocationLos(t, s.gridNo, s.level, g, s.level, 6, true) !== 0;
}

function mortarRoomOrBackOff(t: TacticalState, s: Soldier, target: number): number | null {
  const dir = directionToward(s.gridNo, target);
  const ahead = newGridNo(s.gridNo, DIRECTION_INCREMENT[dir] ?? 0);
  if (okFallDirection(t, s, ahead, s.level, dir, s.state)) return null;
  const back = (dir + 4) % 8;
  const behind = newGridNo(s.gridNo, DIRECTION_INCREMENT[back] ?? 0);
  if (okFallDirection(t, s, behind, s.level, back, s.state)) {
    s.ai.actionData = behind;
    return AiAction.GET_CLOSER;
  }
  return AiAction.NONE;
}

function longRangeToss(t: TacticalState, s: Soldier): number | null {
  const toss = checkIfTossPossible(t, s);
  if (toss.possible) {
    if (s.inv[toss.weaponIn]?.item === itemIndexOf(t, 'MORTAR')) {
      const blocked = mortarRoomOrBackOff(t, s, toss.target);
      if (blocked === AiAction.GET_CLOSER) return blocked;
      if (blocked === AiAction.NONE) toss.possible = false;
    }
  }
  if (toss.possible) {
    if (toss.weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, toss.weaponIn);
    s.ai.actionData = toss.target;
    s.aimTime = toss.aimTime;
    return AiAction.TOSS_PROJECTILE;
  }
  const weapon = toss.weaponIn === -1 ? NOTHING : (s.inv[toss.weaponIn]?.item ?? NOTHING);
  if (
    toss.weaponIn !== -1 &&
    calcMaxTossRange(t, s, weapon, true) > MAX_DISTANCE_VISIBLE &&
    menInSector(t, s.team) > 1 &&
    t.turn.spottersCalledForBy === -1
  ) {
    t.turn.spottersCalledForBy = s.id;
    s.actionPoints = 0;
    s.ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  return null;
}

function civilianCower(t: TacticalState, s: Soldier): number | null {
  const ai = s.ai;
  if (s.bodyType === Body.COW || s.bodyType === Body.CRIPPLECIV) return null;
  if (findAIUsableObjClass(t, s, WEAPON_CLASSES) !== -1) return null;
  if (s.cowering) {
    if (t.inCombat || t.turn.enemyInSector) {
      if (ai.lastAction === AiAction.COWER) {
        ai.actionData = NOWHERE;
        return AiAction.NONE;
      }
      ai.nextActionData = findSpotMaxDistFromOpponents(t, s);
      if (ai.nextActionData !== NOWHERE) {
        ai.nextAction = AiAction.RUN_AWAY;
        ai.actionData = AnimHeight.STAND;
        return AiAction.STOP_COWERING;
      }
      return AiAction.NONE;
    }
    if (ai.newSituation === Situation.NOT_NEW) {
      ai.alertStatus = AlertStatus.GREEN;
      return AiAction.STOP_COWERING;
    }
    return AiAction.NONE;
  }
  if (t.inCombat || t.turn.enemyInSector) {
    ai.actionData = AnimHeight.CROUCH;
    return AiAction.COWER;
  }
  ai.nextAction = AiAction.WAIT;
  ai.nextActionData = realtimeCivDelay(t);
  ai.actionData = AnimHeight.CROUCH;
  return AiAction.COWER;
}

const WEAPON_CLASSES = ItemClass.GUN | ItemClass.BLADE | ItemClass.THROWING_KNIFE | ItemClass.LAUNCHER | ItemClass.TENTACLES;

function moraleRadioChance(chance: number, morale: number): number {
  switch (morale) {
    case AiMorale.HOPELESS:
      return i16(chance * 3);
    case AiMorale.WORRIED:
      return i16(chance * 2);
    case AiMorale.CONFIDENT:
      return Math.trunc(chance / 2);
    case AiMorale.FEARLESS:
      return Math.trunc(chance / 3);
    default:
      return chance;
  }
}

export function decideActionRed(t: TacticalState, s: Soldier, hooks: CombatDeciderHooks): number {
  const ai = s.ai;
  const civilian = civilianForRed(t, s);
  if (!s.actionPoints) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  const canMove = s.actionPoints >= minPtsToMove(ctx(t), s, s.uiMovementMode);
  const water = isWater(t.pathWorld, s.gridNo);
  const deep = deepWater(t, s.gridNo);
  const gas = inGasOrSmoke(t, s, s.gridNo);
  if (gas && canMove) {
    ai.actionData = findNearestUngassedLand(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.LEAVE_WATER_GAS;
  }
  if (civilian) {
    const cower = civilianCower(t, s);
    if (cower !== null) return cower;
  }
  if (canMove && inLightAtNight(t, s.gridNo, s.level) && ai.orders !== Orders.STATIONARY) {
    ai.actionData = findNearbyDarkerSpot(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.LEAVE_WATER_GAS;
  }
  if (t.inCombat && !civilian && !water && !gas && canNPCAttack(t, s) === 1) {
    const toss = longRangeToss(t, s);
    if (toss !== null) return toss;
  }
  if (s.breath < 25 && !water && !ai.underFire) {
    if (!civilian && height(t.content, s.state) !== AnimHeight.CROUCH && isValidStance(t, s, AnimHeight.CROUCH)) {
      if (!t.inCombat || apsToChangeStance(t.content, s, AnimHeight.CROUCH) <= s.actionPoints) {
        ai.actionData = AnimHeight.CROUCH;
        return AiAction.CHANGE_STANCE;
      }
    }
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  ai.morale = calcMorale(t, s);
  if (ai.morale === AiMorale.HOPELESS && canMove) {
    ai.actionData = findSpotMaxDistFromOpponents(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.RUN_AWAY;
  }
  if (!civilian && s.actionPoints >= AP_RADIO && menInSector(t, s.team) > 1) {
    let chance = !t.perception.awareOfOpposition[s.team]
      ? (RADIO_RED_ALERT_BY_DIFFICULTY[soldierDifficultyLevel(t, s)] ?? 0)
      : i16(10 * whatIKnowThatPublicDont(t, s, false));
    if (chance && !deep) {
      chance = i16(chance + ordersAdjust(ai.orders, RED_RADIO_ORDERS));
      if (ai.attitude === Attitude.ATTACKSLAYONLY) chance = 0;
      else chance = i16(chance + (RADIO_ATTITUDES[ai.attitude] ?? 0));
      chance = moraleRadioChance(chance, ai.morale);
      if (pre100(t) < chance) return AiAction.RED_ALERT;
    }
  }
  if (!isTank(s)) {
    if (canMove && s.actionPoints > MAX_AP_CARRIED && !civilian) {
      const r = redMainChoice(t, s);
      if (r !== null) return r;
    }
    if (ai.underFire || civilian) {
      if (s.shock > 0 || civilian) {
        ai.actionData = findSpotMaxDistFromOpponents(t, s);
        if (ai.actionData !== NOWHERE) return AiAction.RUN_AWAY;
      }
      if (!civilian) {
        if (height(t.content, s.state) === AnimHeight.STAND && isValidStance(t, s, AnimHeight.CROUCH)) {
          if (!t.inCombat || apsToChangeStance(t.content, s, AnimHeight.CROUCH) <= s.actionPoints) {
            ai.actionData = AnimHeight.CROUCH;
            return AiAction.CHANGE_STANCE;
          }
        } else if (height(t.content, s.state) !== AnimHeight.PRONE) {
          if (t.pre.int(2) === 0 && isValidStance(t, s, AnimHeight.PRONE)) {
            ai.actionData = AnimHeight.PRONE;
            return AiAction.CHANGE_STANCE;
          }
        }
      }
    }
  }
  if (!t.inCombat || apsToLook(t.content, s) <= s.actionPoints) {
    const opponent = closestKnownOpponent(t, s);
    if (opponent !== NOWHERE) {
      const dir = directionToward(s.gridNo, opponent);
      const visible = distanceVisible(t, s, -1, -1, opponent, 0);
      if (s.direction !== dir && pythSpacesAway(s.gridNo, opponent) <= visible) {
        let chance = ai.orders === Orders.STATIONARY || ai.orders === Orders.ONGUARD ? 50 : 25;
        if (ai.attitude === Attitude.DEFENSIVE) chance += 25;
        if (isTank(s)) chance += 50;
        if (pre100(t) < chance && internalIsValidStance(t, s, dir, endHeight(t.content, s.state))) {
          ai.actionData = dir;
          return AiAction.CHANGE_FACING;
        }
      }
    }
  }
  if (isTank(s)) return AiAction.NONE;
  if (canMove && !s.neutral && (t.inCombat || s.team === Team.ENEMY)) {
    const found = searchForItems(t, s, ItemSearch.GENERAL, handItem(s));
    if (found.action !== AiAction.NONE) {
      ai.actionData = found.gridNo;
      return found.action;
    }
  }
  if (
    ai.alertStatus !== AlertStatus.BLACK &&
    !ai.underFire &&
    canMove &&
    (!t.inCombat || s.actionPoints >= s.initialActionPoints) &&
    closestReachableDisturbance(t, s).gridNo === NOWHERE
  ) {
    if (s.bleeding > MIN_BLEEDING_THRESHOLD) {
      s.bleeding = Math.max(0, s.bleeding - s.actionPoints);
      return AiAction.NONE;
    }
    ai.bypassToGreen = 30;
    return hooks.decideActionGreen(t, s);
  }
  if (!civilian && !water && height(t.content, s.state) === AnimHeight.STAND && isValidStance(t, s, AnimHeight.CROUCH)) {
    const opponent = closestKnownOpponent(t, s);
    if ((opponent !== NOWHERE && pythSpacesAway(s.gridNo, opponent) < Math.trunc((MAX_DISTANCE_VISIBLE * 3) / 2)) || t.pre.int(4) === 0) {
      if (!t.inCombat || apsToChangeStance(t.content, s, AnimHeight.CROUCH) <= s.actionPoints) {
        ai.actionData = AnimHeight.CROUCH;
        return AiAction.CHANGE_STANCE;
      }
    }
  }
  if (
    !civilian &&
    ai.underFire &&
    s.actionPoints >= s.initialActionPoints - apsToLook(t.content, s) &&
    isValidStance(t, s, AnimHeight.PRONE)
  ) {
    const d = noiseHeard(t, s).gridNo;
    if (d !== NOWHERE) {
      const dir = directionToward(s.gridNo, d);
      if (s.direction !== dir) {
        if (!t.inCombat || apsToLook(t.content, s) <= s.actionPoints) {
          ai.actionData = dir;
          return AiAction.CHANGE_FACING;
        }
      } else if (
        (!t.inCombat || apsToChangeStance(t.content, s, AnimHeight.PRONE) <= s.actionPoints) &&
        internalIsValidStance(t, s, dir, AnimHeight.PRONE)
      ) {
        ai.nextAction = AiAction.END_TURN;
        ai.actionData = AnimHeight.PRONE;
        return AiAction.CHANGE_STANCE;
      }
    }
  }
  ai.actionData = NOWHERE;
  return AiAction.NONE;
}

function redMainChoice(t: TacticalState, s: Soldier): number | null {
  const ai = s.ai;
  let seek = 0;
  let help = 0;
  let hide = 0;
  let watch = getHighestWatchedLocPoints(t, s);
  if (watch <= 0) watch = -99;
  switch (ai.morale) {
    case AiMorale.HOPELESS:
      seek = -99;
      help = -99;
      hide = 1;
      watch = -99;
      break;
    case AiMorale.WORRIED:
      seek -= 1;
      hide += 1;
      watch += 1;
      break;
    case AiMorale.CONFIDENT:
      seek += 1;
      hide -= 1;
      break;
    case AiMorale.FEARLESS:
      seek += 1;
      hide = -1;
      break;
  }
  const ord = ai.orders;
  if (ord === Orders.STATIONARY) [seek, help, hide, watch] = [seek - 1, help - 1, hide + 1, watch + 1];
  else if (ord === Orders.ONGUARD) [seek, hide, watch] = [seek - 1, hide + 1, watch + 1];
  else if (ord === Orders.ONCALL) [help, hide] = [help + 1, hide - 1];
  else if (ord === Orders.SEEKENEMY) [seek, hide, watch] = [seek + 1, hide - 1, watch - 1];
  switch (ai.attitude) {
    case Attitude.DEFENSIVE:
      [seek, hide, watch] = [seek - 1, hide + 1, watch + 1];
      break;
    case Attitude.BRAVESOLO:
      [seek, help, hide, watch] = [seek + 1, help - 1, hide - 1, watch - 1];
      break;
    case Attitude.BRAVEAID:
      [seek, help, hide, watch] = [seek + 1, help + 1, hide - 1, watch - 1];
      break;
    case Attitude.CUNNINGSOLO:
      [help, hide] = [help - 1, hide + 1];
      break;
    case Attitude.CUNNINGAID:
      [help, hide] = [help + 1, hide + 1];
      break;
    case Attitude.AGGRESSIVE:
    case Attitude.ATTACKSLAYONLY:
      [seek, hide] = [seek + 1, hide - 1];
      break;
  }
  seek = i8(seek);
  help = i8(help);
  hide = i8(hide);
  watch = i8(watch);
  if (!t.inCombat) hide = -99;
  while (seek > -90 || help > -90 || hide > -90) {
    if (seek > -90 && seek >= help && seek >= hide && seek >= watch) {
      const d = closestReachableDisturbance(t, s);
      if (d.gridNo !== NOWHERE) {
        ai.actionData = goAsFarAsPossibleTowards(t, s, d.gridNo, AiAction.SEEK_OPPONENT, mode(t));
        if (ai.actionData !== NOWHERE) {
          if (d.climb && ai.actionData === d.gridNo) return AiAction.MOVE_TO_CLIMB;
          if (ai.attitude === Attitude.DEFENSIVE || ai.attitude === Attitude.CUNNINGSOLO || ai.attitude === Attitude.CUNNINGAID) {
            if (
              pythSpacesAway(ai.actionData, d.gridNo) < 5 ||
              locationToLocationLos(t, ai.actionData, s.level, d.gridNo, s.level, MAX_DISTANCE_VISIBLE, true)
            ) {
              const reserve = i8(minAPsToAttack(t, s, d.gridNo, true, true) + AP_CROUCH);
              ai.actionData = internalGoAsFarAsPossibleTowards(t, s, d.gridNo, reserve, AiAction.SEEK_OPPONENT, GoFlag.CAUTIOUS, mode(t));
              if (ai.actionData !== NOWHERE) {
                ai.cautious = true;
                ai.nextAction = AiAction.END_TURN;
                return AiAction.SEEK_OPPONENT;
              }
            } else return AiAction.SEEK_OPPONENT;
          } else return AiAction.SEEK_OPPONENT;
        }
      }
      seek = -99;
    }
    if (watch > -90 && watch >= seek && watch >= help && watch >= hide) {
      const loc = getHighestVisibleWatchedLoc(t, s);
      if (loc !== -1) {
        const dir = directionToward(s.gridNo, watchedLocGridNo(t, s, loc));
        if (s.direction !== dir && internalIsValidStance(t, s, dir, endHeight(t.content, s.state))) {
          ai.actionData = dir;
          ai.nextAction = AiAction.END_TURN;
          return AiAction.CHANGE_FACING;
        }
        if (endHeight(t.content, s.state) === AnimHeight.STAND && internalIsValidStance(t, s, dir, AnimHeight.CROUCH)) {
          ai.actionData = AnimHeight.CROUCH;
          ai.nextAction = AiAction.END_TURN;
          return AiAction.CHANGE_STANCE;
        }
        if (height(t.content, s.state) !== AnimHeight.PRONE) {
          if (t.pre.int(2) === 0 && internalIsValidStance(t, s, dir, AnimHeight.PRONE)) {
            ai.actionData = AnimHeight.PRONE;
            ai.nextAction = AiAction.END_TURN;
            return AiAction.CHANGE_STANCE;
          }
          return AiAction.END_TURN;
        }
      }
      watch = -99;
    }
    if (help > -90 && help >= seek && help >= hide && help >= watch) {
      const friend = closestReachableFriendInTrouble(t, s);
      if (friend && friend.gridNo !== NOWHERE) {
        ai.actionData = goAsFarAsPossibleTowards(t, s, friend.gridNo, AiAction.SEEK_OPPONENT, mode(t));
        if (ai.actionData !== NOWHERE)
          return friend.climb && ai.actionData === friend.gridNo ? AiAction.MOVE_TO_CLIMB : AiAction.SEEK_FRIEND;
      }
      help = -99;
    }
    if (hide > -90 && hide >= seek && hide >= help && hide >= watch) {
      const opponent = closestKnownOpponent(t, s);
      if (!t.turn.skipCoverCheck && opponent !== NOWHERE) {
        ai.actionData = findBestNearbyCover(t, s, ai.morale).gridNo;
        if (ai.actionData !== NOWHERE) {
          const d = closestReachableDisturbance(t, s);
          if (
            d.gridNo !== NOWHERE &&
            (spacesAway(ai.actionData, d.gridNo) < 5 || spacesAway(ai.actionData, d.gridNo) + 5 < spacesAway(s.gridNo, d.gridNo))
          ) {
            const reserve = i8(minAPsToAttack(t, s, opponent, true, true) + AP_CROUCH);
            if (internalGoAsFarAsPossibleTowards(t, s, ai.actionData, reserve, AiAction.TAKE_COVER, 0, mode(t)) === ai.actionData)
              return AiAction.TAKE_COVER;
          } else return AiAction.TAKE_COVER;
        }
      }
      hide = -99;
    }
  }
  return null;
}

const itemIndexOf = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const handItem = (s: Soldier) => s.inv[InvSlot.HAND]?.item ?? NOTHING;

function stowUselessGun(t: TacticalState, s: Soldier): boolean {
  const hand = s.inv[InvSlot.HAND];
  if (!hand || hand.item === NOTHING) return false;
  hand.flags |= ObjectFlags.AI_UNUSABLE;
  return autoPlaceObject(soldierInventoryContext(t, s), s, hand) && s.inv[InvSlot.HAND]?.item === NOTHING;
}

export function decideActionBlack(t: TacticalState, s: Soldier, hooks: CombatDeciderHooks): number {
  const ai = s.ai;
  const civilian = civilianForYellow(t, s);
  if (!s.actionPoints) {
    ai.actionData = NOWHERE;
    return AiAction.NONE;
  }
  const canMove = s.actionPoints >= minPtsToMove(ctx(t), s, s.uiMovementMode);
  const deep = deepWater(t, s.gridNo);
  const gas = inGasOrSmoke(t, s, s.gridNo);
  ai.morale = calcMorale(t, s);
  if (gas || s.breath < 5) {
    if (canMove) {
      ai.actionData = findSpotMaxDistFromOpponents(t, s);
      if (ai.actionData !== NOWHERE) return AiAction.RUN_AWAY;
    }
    ai.morale = AiMorale.HOPELESS;
  }
  if ((deep || gas) && canMove) {
    ai.actionData = findNearestUngassedLand(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.LEAVE_WATER_GAS;
    ai.actionData = findSpotMaxDistFromOpponents(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.RUN_AWAY;
    ai.morale = AiMorale.HOPELESS;
  }
  let canAttack: number;
  let tryPunching = false;
  if (s.actionPoints < 2 || deep || gas) canAttack = 0;
  else {
    for (;;) {
      canAttack = canNPCAttack(t, s);
      if (canAttack === 1) break;
      if (civilian && canAttack === NoShoot.NOWEAPON && s.bodyType !== Body.COW && s.bodyType !== Body.CRIPPLECIV) {
        if (s.cowering) {
          if (ai.lastAction === AiAction.COWER) {
            ai.actionData = NOWHERE;
            return AiAction.NONE;
          }
          ai.nextActionData = findSpotMaxDistFromOpponents(t, s);
          if (ai.nextActionData !== NOWHERE) {
            ai.nextAction = AiAction.RUN_AWAY;
            ai.actionData = AnimHeight.STAND;
            return AiAction.STOP_COWERING;
          }
          return AiAction.NONE;
        }
        ai.actionData = AnimHeight.CROUCH;
        return AiAction.COWER;
      }
      if (!civilian && canAttack === NoShoot.NOAMMO && canMove && !s.neutral) {
        const ammo = searchForItems(t, s, ItemSearch.AMMO, handItem(s));
        if (ammo.action !== AiAction.NONE) {
          ai.actionData = ammo.gridNo;
          return ammo.action;
        }
        if (stowUselessGun(t, s)) continue;
      }
      canAttack = 0;
      break;
    }
    if (!canAttack) {
      if (ai.morale > AiMorale.WORRIED) ai.morale = AiMorale.WORRIED;
      if (!civilian) {
        canAttack = 1;
        tryPunching = true;
      }
    }
  }
  if (findAIUsableObjClass(t, s, ItemClass.GUN) === -1 && canMove && !s.neutral) {
    const weapon = searchForItems(t, s, ItemSearch.WEAPONS, handItem(s));
    if (weapon.action !== AiAction.NONE) {
      ai.actionData = weapon.gridNo;
      return weapon.action;
    }
  }
  let bestShot = emptyAttackChoice();
  let bestStab = emptyAttackChoice();
  let bestThrow = emptyAttackChoice();
  let bestAttack = emptyAttackChoice();
  let bestAction: number = AiAction.NONE;
  if (canAttack) {
    s.aimShotLocation = 0;
    let weaponIn = findAIUsableObjClass(t, s, ItemClass.GUN);
    if (weaponIn !== -1) {
      if (weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, weaponIn);
      const hand = s.inv[InvSlot.HAND];
      const def = t.content.items.byIndex.get(hand?.item ?? NOTHING);
      if (def?.itemClass === ItemClass.GUN && (hand?.status[0] ?? 0) >= 10) {
        const minAP = minAPsToAttack(t, s, s.lastTarget, false);
        if (s.actionPoints >= minAP) {
          bestShot = { ...calcBestShot(t, s), weaponIn };
          if (s.team === Team.OUR && bestShot.chanceToReallyHit < 30) bestShot.possible = false;
          if (bestShot.possible) {
            const opp = bestShot.opponent;
            if (opp && opp.life < OKLIFE && (ai.attitude !== Attitude.AGGRESSIVE || bestShot.chanceToReallyHit < 60)) {
              if (closestReachableDisturbance(t, s).gridNo !== NOWHERE) return decideActionRed(t, s, hooks);
            }
            hooks.npcDoesAct(t, s);
          }
        }
      }
      if (weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, weaponIn);
    }
    bestThrow = checkIfTossPossible(t, s);
    if (bestThrow.possible) hooks.npcDoesAct(t, s);
    weaponIn = findAIUsableObjClass(t, s, ItemClass.BLADE | ItemClass.THROWING_KNIFE);
    if (weaponIn !== -1) {
      if (weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, weaponIn);
      const minAP = minAPsToAttack(t, s, s.lastTarget, false);
      if (s.actionPoints >= minAP) {
        const throwingKnife = t.content.items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? NOTHING)?.itemClass === ItemClass.THROWING_KNIFE;
        bestStab = { ...(throwingKnife ? throwingKnifeAttackNotPorted() : calcBestStab(t, s, true)), weaponIn };
        if (bestStab.possible) hooks.npcDoesAct(t, s);
      }
      if (weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, weaponIn);
    }
    let value = 0;
    if (bestShot.possible) {
      value = bestShot.attackValue;
      bestAction = AiAction.FIRE_GUN;
    }
    if (bestStab.possible && (bestStab.attackValue > value || bestAction === AiAction.NONE)) {
      value = bestStab.attackValue;
      bestAction = AiAction.KNIFE_MOVE;
    }
    if (bestThrow.possible && (bestThrow.attackValue > value || bestAction === AiAction.NONE)) bestAction = AiAction.TOSS_PROJECTILE;
    if (bestAction === AiAction.NONE && tryPunching) {
      const fist = s.inv.findIndex((o, k) => k <= InvSlot.SMALLPOCK8 && o.item === NOTHING);
      if (fist !== -1) {
        if (fist !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, fist);
        const minAP = minAPsToAttack(t, s, s.lastTarget, false);
        if (s.actionPoints >= minAP) {
          bestStab = { ...calcBestStab(t, s, false), weaponIn: fist };
          if (bestStab.possible) {
            hooks.npcDoesAct(t, s);
            bestAction = AiAction.KNIFE_MOVE;
          }
        }
        if (fist !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, fist);
      }
    }
    bestAttack =
      bestAction === AiAction.FIRE_GUN
        ? bestShot
        : bestAction === AiAction.TOSS_PROJECTILE
          ? bestThrow
          : bestAction === AiAction.KNIFE_MOVE
            ? bestStab
            : emptyAttackChoice();
  }
  let allowCoverCheck = false;
  if (
    s.actionPoints === s.initialActionPoints &&
    bestAction === AiAction.FIRE_GUN &&
    s.shock === 0 &&
    s.life >= Math.trunc(s.lifeMax / 2) &&
    bestAttack.chanceToReallyHit < 30 &&
    pythSpacesAway(s.gridNo, bestAttack.target) >
      Math.trunc((t.content.items.byIndex.get(s.inv[bestAttack.weaponIn]?.item ?? NOTHING)?.weapon?.range ?? 0) / 10) &&
    rangeChangeDesire(t, s) >= 4
  ) {
    if (canMove && ai.orders !== Orders.STATIONARY && !t.turn.hiddenInterrupt) {
      const roll = s.team === Team.MILITIA ? t.pre.int(20) : t.pre.int(40);
      if (roll > bestAttack.chanceToReallyHit) {
        allowCoverCheck = true;
        if (t.pre.int(10) > bestAttack.chanceToReallyHit) bestAction = AiAction.NONE;
      }
    }
  }
  let bestCover = NOWHERE;
  let coverBetter = 0;
  if (
    (canMove &&
      !t.turn.skipCoverCheck &&
      !t.turn.hiddenInterrupt &&
      (bestAction === AiAction.NONE || s.lastAttackHit) &&
      s.team !== Team.OUR) ||
    allowCoverCheck
  ) {
    const cover = findBestNearbyCover(t, s, ai.morale);
    bestCover = cover.gridNo;
    coverBetter = cover.percentBetter;
  }
  if (bestAction !== AiAction.NONE && bestCover !== NOWHERE) {
    let offense = bestAttack.chanceToReallyHit;
    let defense = coverBetter;
    switch (ai.morale) {
      case AiMorale.FEARLESS:
        offense += Math.trunc(offense / 2);
        break;
      case AiMorale.CONFIDENT:
        offense += Math.trunc(offense / 4);
        break;
      case AiMorale.WORRIED:
        defense += Math.trunc(defense / 4);
        break;
      case AiMorale.HOPELESS:
        defense += Math.trunc(defense / 2);
        break;
    }
    if (s.stats.wisdom >= 80) defense += 10;
    else if (s.stats.wisdom < 50) defense -= 10;
    if (ai.orders === Orders.SEEKENEMY) offense += 10;
    else if (ai.orders === Orders.STATIONARY || ai.orders === Orders.ONGUARD) defense += 10;
    switch (ai.attitude) {
      case Attitude.DEFENSIVE:
        defense += 20;
        break;
      case Attitude.BRAVESOLO:
      case Attitude.BRAVEAID:
        defense -= 10;
        break;
      case Attitude.CUNNINGSOLO:
      case Attitude.CUNNINGAID:
        defense += 10;
        break;
      case Attitude.AGGRESSIVE:
        offense += 20;
        break;
      case Attitude.ATTACKSLAYONLY:
        offense += 30;
        break;
    }
    if (defense > offense) bestAction = AiAction.NONE;
  }
  if (bestAction !== AiAction.NONE) return executeAttackChoice(t, s, hooks, bestAction, bestAttack, bestShot);
  if (isTank(s)) return AiAction.NONE;
  if (bestCover !== NOWHERE) {
    ai.actionData = bestCover;
    return AiAction.TAKE_COVER;
  }
  if (canMove && s.team !== Team.OUR && (ai.morale === AiMorale.HOPELESS || !canAttack)) {
    ai.actionData = findSpotMaxDistFromOpponents(t, s);
    if (ai.actionData !== NOWHERE) return AiAction.RUN_AWAY;
  }
  if (
    t.turn.spottersCalledForBy !== -1 &&
    s.actionPoints >= AP_RADIO &&
    ai.oppCount > 1 &&
    !civilian &&
    menInSector(t, s.team) > 1 &&
    !deep
  ) {
    const chance = 25 * whatIKnowThatPublicDont(t, s, true);
    if (chance && pre100(t) < chance) return AiAction.RED_ALERT;
  }
  if (!t.inCombat || apsToChangeStance(t.content, s, AnimHeight.CROUCH) <= s.actionPoints) {
    if (!civilian && !t.turn.hiddenInterrupt && isValidStance(t, s, AnimHeight.CROUCH)) {
      ai.actionData = stanceChange(t, s, bestAttack.apCost);
      if (ai.actionData !== 0) {
        if (ai.actionData === AnimHeight.PRONE) {
          if (
            (!t.inCombat || apsToLook(t.content, s) <= s.actionPoints - apsToChangeStance(t.content, s, ai.actionData)) &&
            (ai.morale > AiMorale.HOPELESS || canMove)
          ) {
            const opponent = closestSeenOpponent(t, s);
            if (opponent !== NOWHERE) {
              const dir = directionToward(s.gridNo, opponent);
              if (s.direction !== dir) {
                if (internalIsValidStance(t, s, dir, ai.actionData)) {
                  ai.nextAction = AiAction.CHANGE_STANCE;
                  ai.nextActionData = ai.actionData;
                  ai.actionData = dir;
                  return AiAction.CHANGE_FACING;
                }
                if (ai.actionData === AnimHeight.PRONE && internalIsValidStance(t, s, dir, AnimHeight.CROUCH)) {
                  ai.actionData = AnimHeight.CROUCH;
                  ai.nextAction = AiAction.END_TURN;
                  return AiAction.CHANGE_STANCE;
                }
              }
            }
          }
        }
        ai.nextAction = AiAction.END_TURN;
        return AiAction.CHANGE_STANCE;
      }
    }
  }
  if (!t.inCombat || apsToLook(t.content, s) <= s.actionPoints) {
    if (!t.turn.hiddenInterrupt && (ai.morale > AiMorale.HOPELESS || canMove)) {
      const opponent = closestSeenOpponent(t, s);
      if (opponent !== NOWHERE) {
        const dir = directionToward(s.gridNo, opponent);
        if (s.direction !== dir && internalIsValidStance(t, s, dir, endHeight(t.content, s.state))) {
          ai.actionData = dir;
          return AiAction.CHANGE_FACING;
        }
      }
    }
  }
  if (s.team === Team.MILITIA && s.actionPoints >= AP_RADIO && menInSector(t, s.team) > 1) {
    let chance = !t.perception.awareOfOpposition[s.team]
      ? (RADIO_RED_ALERT_BY_DIFFICULTY[soldierDifficultyLevel(t, s)] ?? 0)
      : i16(10 * whatIKnowThatPublicDont(t, s, false));
    if (chance && !deep) {
      chance = i16(chance + ordersAdjust(ai.orders, RED_RADIO_ORDERS));
      if (ai.attitude === Attitude.ATTACKSLAYONLY) chance = 0;
      else chance = i16(chance + (RADIO_ATTITUDES[ai.attitude] ?? 0));
      if (!t.perception.awareOfOpposition[s.team]) chance = moraleRadioChance(chance, ai.morale);
      chance = Math.trunc(chance / 2);
      if (pre100(t) < chance) return AiAction.RED_ALERT;
    }
  }
  ai.actionData = NOWHERE;
  return AiAction.NONE;
}

function executeAttackChoice(
  t: TacticalState,
  s: Soldier,
  _hooks: CombatDeciderHooks,
  action: number,
  best: AttackChoice,
  bestShot: AttackChoice,
): number {
  const ai = s.ai;
  let changeStanceFirst = false;
  let bestStance = u8(-1);
  s.aimTime = best.aimTime;
  s.doBurst = 0;
  if (action === AiAction.FIRE_GUN) {
    if (!isTank(s) && s.actionPoints - (best.apCost - best.aimTime) >= AP_CROUCH + apsToReadyWeapon(t.content, s)) {
      let chance: number;
      if (endHeight(t.content, s.state) !== AnimHeight.STAND) chance = 100;
      else {
        chance = 50;
        switch (ai.attitude) {
          case Attitude.DEFENSIVE:
            chance += 20;
            break;
          case Attitude.BRAVESOLO:
          case Attitude.BRAVEAID:
            chance -= 10;
            break;
          case Attitude.CUNNINGSOLO:
          case Attitude.CUNNINGAID:
            chance += 10;
            break;
          case Attitude.AGGRESSIVE:
            chance -= 20;
            break;
          case Attitude.ATTACKSLAYONLY:
            chance -= 30;
            break;
        }
      }
      if (t.pre.int(100) < chance || rangeInCells(s.gridNo, best.target) <= MIN_PRONE_RANGE) {
        const dir = directionToward(s.gridNo, best.target);
        bestStance = shootingStanceChange(t, s, best, dir);
        if (bestStance !== 0) {
          if (s.direction !== dir && internalIsValidStance(t, s, dir, endHeight(t.content, s.state))) {
            ai.actionData = dir;
            return AiAction.CHANGE_FACING;
          }
          changeStanceFirst = true;
          const stanceCost = u8(apsToChangeStance(t.content, s, bestStance));
          if (best.apCost + stanceCost > s.actionPoints) best.aimTime = u8(best.aimTime - (best.aimTime - stanceCost));
          else best.apCost = u8(best.apCost + apsToChangeStance(t.content, s, bestStance));
        }
      }
    }
    const gun = s.inv[best.weaponIn];
    const burstCapable = (t.content.items.byIndex.get(gun?.item ?? NOTHING)?.weapon?.shotsPerBurst ?? 0) > 0;
    if (burstCapable && (bestShot.opponent?.life ?? 0) >= OKLIFE && (gun?.gunShotsLeft ?? 0) > 1 && s.team !== Team.OUR && gun) {
      const burstAPs = calcAPsToBurst(t, calcActionPoints(t.content, s), gun);
      let reraise = 0;
      if (changeStanceFirst && hasFireReady(t, s)) reraise = t.content.items.byIndex.get(gun.item)?.weapon?.readyTime ?? 0;
      if (s.actionPoints - (best.apCost - best.aimTime) - reraise >= burstAPs) {
        let chance: number;
        if (isTank(s)) chance = 100;
        else {
          chance = Math.trunc(25 / (best.aimTime + 1));
          switch (ai.attitude) {
            case Attitude.DEFENSIVE:
              chance -= 5;
              break;
            case Attitude.BRAVESOLO:
            case Attitude.BRAVEAID:
              chance += 5;
              break;
            case Attitude.AGGRESSIVE:
              chance += 10;
              break;
            case Attitude.ATTACKSLAYONLY:
              chance += 30;
              break;
          }
          const dist = pythSpacesAway(s.gridNo, best.target);
          if (dist < 10) {
            chance += (10 - dist) * (1 + soldierDifficultyLevel(t, s));
            if (ai.attitude === Attitude.ATTACKSLAYONLY) chance += 5 * (10 - dist);
          }
        }
        if (t.pre.int(100) < chance) {
          best.aimTime = BURSTING;
          best.apCost = u8(
            best.apCost - best.aimTime + calcAPsToBurst(t, calcActionPoints(t.content, s), s.inv[InvSlot.HAND] as typeof gun),
          );
          if (ai.attitude !== Attitude.ATTACKSLAYONLY) calcSpreadBurst(t, s, best.target, best.targetLevel);
        }
      }
    }
    if (best.aimTime === BURSTING) {
      s.aimTime = 0;
      s.doBurst = 1;
    }
  }
  if (best.weaponIn !== InvSlot.HAND && best.weaponIn >= 0) rearrangePocket(s, InvSlot.HAND, best.weaponIn);
  if (changeStanceFirst) {
    ai.nextAction = AiAction.FIRE_GUN;
    ai.nextActionData = best.target;
    ai.nextTargetLevel = best.targetLevel;
    ai.actionData = bestStance;
    return AiAction.CHANGE_STANCE;
  }
  ai.actionData = best.target;
  s.targetLevel = best.targetLevel;
  return action;
}

function throwingKnifeAttackNotPorted(): AttackChoice {
  return emptyAttackChoice();
}

function hasFireReady(t: TacticalState, s: Soldier): boolean {
  const flags = t.content.animations.controls[s.state]?.flags ?? 0;
  return (flags & (0x40 | 0x20000000)) !== 0;
}

function rangeInCells(a: number, b: number): number {
  const dx = (a % WORLD_COLS) - (b % WORLD_COLS);
  const dy = Math.trunc(a / WORLD_COLS) - Math.trunc(b / WORLD_COLS);
  return Math.trunc(Math.sqrt(dx * dx + dy * dy) * 10);
}
