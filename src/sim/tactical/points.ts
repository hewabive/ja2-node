// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Points.cc TerrainActionPoints, TerrainBreathPoints, ActionPointCost, MinAPsToStartMovement,
// @src PtsToMoveDirection, DeductPoints, AdjustBreathPts; Points.h; RT_Time_Defines.h. See docs/07 §3.6.

import { AnimFlags } from '../../content/anim/tables.ts';
import { ItemClass } from '../../content/items/items.ts';
import { DIRECTION_INCREMENT, newGridNo } from '../../content/world/grid.ts';
import { isDoorTravelCost, TravelCost } from '../../content/world/movement-costs.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { AnimHeight } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { carriedWeightPercent, InvSlot, itemIn } from './inventory.ts';
import { doorObstacleIfClosed, doorState, isWater, type PathEnv, terrainCost } from './pathfinding.ts';
import { effectiveAgility, effectiveDexterity, effectiveExpLevel, effectiveLife, effectiveStrength } from './skills.ts';
import { Body, type Soldier, Team } from './soldier.ts';

export const AP = {
  MOVEMENT_FLAT: 3,
  MOVEMENT_GRASS: 4,
  MOVEMENT_BUSH: 5,
  MOVEMENT_RUBBLE: 6,
  MOVEMENT_SHORE: 7,
  MOVEMENT_LAKE: 9,
  MOVEMENT_OCEAN: 8,
  EXCHANGE_PLACES: 5,
  REVERSE_MODIFIER: 1,
  STEALTH_MODIFIER: 2,
  STEAL_ITEM: 10,
  TAKE_BLOOD: 10,
  TALK: 6,
  CHANGE_FACING: 1,
  CHANGE_TARGET: 1,
  CATCH_ITEM: 5,
  TOSS_ITEM: 8,
  REFUEL_VEHICLE: 10,
  MOVE_ITEM_FREE: 0,
  MOVE_ITEM_FAST: 2,
  MOVE_ITEM_AVG: 4,
  MOVE_ITEM_SLOW: 6,
  RADIO: 5,
  CROUCH: 2,
  PRONE: 2,
  LOOK_STANDING: 1,
  LOOK_CROUCHED: 2,
  LOOK_PRONE: 2,
  READY_KNIFE: 0,
  READY_PISTOL: 1,
  READY_RIFLE: 2,
  READY_SAW: 0,
  READY_DUAL: 1,
  MIN_AIM_ATTACK: 0,
  MAX_AIM_ATTACK: 4,
  BURST: 5,
  DROP_BOMB: 3,
  RELOAD_GUN: 5,
  START_FIRST_AID: 5,
  PER_HP_FIRST_AID: 1,
  STOP_FIRST_AID: 3,
  START_REPAIR: 5,
  GET_HIT: 2,
  GET_WOUNDED_DIVISOR: 4,
  FALL_DOWN: 4,
  GET_THROWN: 2,
  GET_UP: 5,
  ROLL_OVER: 2,
  PICKLOCK: 10,
  EXAMINE_DOOR: 5,
  BOOT_DOOR: 8,
  USE_CROWBAR: 10,
  UNLOCK_DOOR: 6,
  LOCK_DOOR: 6,
  EXPLODE_DOOR: 10,
  UNTRAP_DOOR: 10,
  USEWIRECUTTERS: 10,
  CLIMBROOF: 10,
  CLIMBOFFROOF: 6,
  JUMPFENCE: 6,
  OPEN_SAFE: 8,
  USE_REMOTE: 2,
  PULL_TRIGGER: 2,
  FORCE_LID_OPEN: 10,
  SEARCH_CONTAINER: 5,
  READ_NOTE: 10,
  USE_SURV_CAM: 5,
  START_RUN_COST: 1,
  JUMP_OVER: 6,
  PICKUP_ITEM: 3,
  GIVE_ITEM: 1,
  MERGE: 8,
} as const;

export const DOOR_APS = [0, 3, 4, 5] as const;

export const BP = {
  MOVEMENT_FLAT: 5,
  MOVEMENT_GRASS: 10,
  MOVEMENT_BUSH: 20,
  MOVEMENT_RUBBLE: 35,
  MOVEMENT_SHORE: 50,
  MOVEMENT_LAKE: 75,
  MOVEMENT_OCEAN: 100,
  RADIO: 0,
  USE_DETONATOR: 0,
  REVERSE_MODIFIER: 0,
  STEALTH_MODIFIER: -20,
  MINING_MODIFIER: -30,
  CHANGE_FACING: 10,
  CROUCH: 10,
  PRONE: 10,
  CLIMBROOF: 500,
  CLIMBOFFROOF: 250,
  JUMPFENCE: 200,
  MOVE_ITEM_FREE: 0,
  MOVE_ITEM_FAST: 0,
  MOVE_ITEM_AVG: 0,
  MOVE_ITEM_SLOW: 20,
  READY_KNIFE: 0,
  READY_PISTOL: 10,
  READY_RIFLE: 20,
  READY_SAW: 0,
  STEAL_ITEM: 50,
  PER_AP_AIMING: 5,
  RELOAD_GUN: 20,
  THROW_ITEM: 50,
  START_FIRST_AID: 0,
  PER_HP_FIRST_AID: -25,
  STOP_FIRST_AID: 0,
  GET_HIT: 200,
  GET_WOUNDED: 50,
  FALL_DOWN: 250,
  GET_UP: 50,
  ROLL_OVER: 20,
  OPEN_DOOR: 30,
  PICKLOCK: -250,
  EXAMINE_DOOR: -250,
  BOOT_DOOR: 200,
  USE_CROWBAR: 350,
  UNLOCK_DOOR: 50,
  EXPLODE_DOOR: -250,
  UNTRAP_DOOR: 150,
  LOCK_DOOR: 50,
  USEWIRECUTTERS: 200,
  PULL_TRIGGER: 0,
  FORCE_LID_OPEN: 50,
  SEARCH_CONTAINER: 0,
  OPEN_SAFE: -50,
  READ_NOTE: -250,
  USE_SURV_CAM: -100,
  BURY_MINE: 250,
  DISARM_MINE: 0,
  FIRE_HANDGUN: 25,
  FIRE_RIFLE: 50,
  FIRE_SHOTGUN: 100,
  STAB_KNIFE: 200,
  TAKE_PHOTOGRAPH: 0,
  MERGE: 50,
  FALLFROMROOF: 1000,
  JUMP_OVER: 250,
} as const;

const RUN_DIVISOR = 1.8;
const WALK_COST = -1;
const SWAT_COST = 0;
const CRAWL_COST = 1;
const RUN_ENERGY_FACTOR = 3;
const WALK_ENERGY_FACTOR = 1;
const SWAT_ENERGY_FACTOR = 2;
const CRAWL_ENERGY_FACTOR = 4;
const RT_BREATH_DEDUCT_MODIFIER = 1.25;
const MAX_BREATH_RED = 10000;
export const MAX_AP_CARRIED = 5;
export const MAX_AP_DEBT = 100;

export const AP_LIMITS = {
  MINIMUM: 10,
  MAXIMUM: 25,
  MONSTER_MAXIMUM: 40,
  VEHICLE_MAXIMUM: 50,
  YOUNG_MONST_FACTOR: 15,
  ADULT_MONST_FACTOR: 12,
  MONST_FRENZY_FACTOR: 13,
} as const;

export const BP_PER_AP = {
  NO_EFFORT: -200,
  MIN_EFFORT: -100,
  LT_EFFORT: -50,
  MOD_EFFORT: 25,
  HVY_EFFORT: 50,
  MAX_EFFORT: 100,
} as const;

const toInt8 = (v: number): number => ((v & 0xff) << 24) >> 24;
const BLOCKED_AP_COST = 100;

export type MoveClass = 'run' | 'walk' | 'swat' | 'crawl' | 'other';

const RUN_STATES = new Set(['RUNNING', 'ADULTMONSTER_WALKING', 'BLOODCAT_RUN']);
const WALK_STATES = new Set([
  'CROW_FLY',
  'SIDE_STEP',
  'WALK_BACKWARDS',
  'ROBOT_WALK',
  'BLOODCAT_WALK_BACKWARDS',
  'MONSTER_WALK_BACKWARDS',
  'LARVAE_WALK',
  'KID_SKIPPING',
  'WALKING',
]);
const SWAT_STATES = new Set(['CROW_WALK', 'START_SWAT', 'SWAT_BACKWARDS', 'SWATTING']);
const DUCKING_STATES = new Set(['RUNNING', 'WALKING', 'LARVAE_WALK', 'SIDE_STEP', 'WALK_BACKWARDS']);

export function stateName(content: TacticalContent, state: number): string {
  return content.animations.controls[state]?.id ?? '';
}

export function moveClassOf(content: TacticalContent, state: number): MoveClass {
  const name = stateName(content, state);
  if (RUN_STATES.has(name)) return 'run';
  if (WALK_STATES.has(name)) return 'walk';
  if (SWAT_STATES.has(name)) return 'swat';
  if (name === 'CRAWLING') return 'crawl';
  return 'other';
}

export interface PointsContext {
  readonly env: PathEnv;
  readonly content: TacticalContent;
  readonly inCombat: boolean;
}

export function doorTravelCost(
  ctx: PointsContext,
  s: Soldier,
  g: number,
  cost: number,
  perceived: boolean,
  returnDoorCost: boolean,
): number {
  if (!isDoorTravelCost(cost)) return cost;
  const ref = doorObstacleIfClosed(cost, g);
  let replacement = ref.obstacleIfClosed ? TravelCost.DOOR : cost;
  if (s.monsterOrAnimal) replacement = TravelCost.OBSTACLE;
  const state = doorState(ctx.env, ref.door, perceived);
  let open: boolean;
  if (ref.door2 === -1) {
    if (!has(state, StructureFlags.ANYDOOR)) return cost;
    open = has(state, StructureFlags.OPEN);
  } else {
    const state2 = doorState(ctx.env, ref.door2, perceived);
    if (!has(state, StructureFlags.ANYDOOR) && !has(state2, StructureFlags.ANYDOOR)) return cost;
    if (!has(state, StructureFlags.OPEN) || !has(state2, StructureFlags.OPEN)) return replacement;
    open = true;
  }
  if (open) return ref.obstacleIfClosed ? terrainCost(ctx.env.world, g) : replacement;
  if (!ref.obstacleIfClosed) return terrainCost(ctx.env.world, g);
  if (perceived || s.monsterOrAnimal) return replacement;
  const door = ctx.env.world.mapDoors.get(ref.door);
  return door && (!door.locked || s.hasKeys) && !returnDoorCost ? terrainCost(ctx.env.world, g) : replacement;
}

export function terrainActionPoints(ctx: PointsContext, s: Soldier, g: number, dir: number, level: number): number {
  let ap = (s.stealthMode ? AP.STEALTH_MODIFIER : 0) + (s.reverse ? AP.REVERSE_MODIFIER : 0);
  let sw = ctx.env.world.costs.get(g, dir, level);
  if (sw === TravelCost.NOT_STANDING) sw = terrainCost(ctx.env.world, g);
  else if (isDoorTravelCost(sw)) sw = doorTravelCost(ctx, s, g, sw, s.team === Team.OUR, false);
  if (sw >= TravelCost.BLOCKED && sw !== TravelCost.DOOR) return BLOCKED_AP_COST;
  switch (sw) {
    case TravelCost.DIRTROAD:
    case TravelCost.FLAT:
    case TravelCost.DOOR:
      ap += AP.MOVEMENT_FLAT;
      break;
    case TravelCost.GRASS:
      ap += AP.MOVEMENT_GRASS;
      break;
    case TravelCost.THICK:
      ap += AP.MOVEMENT_BUSH;
      break;
    case TravelCost.DEBRIS:
      ap += AP.MOVEMENT_RUBBLE;
      break;
    case TravelCost.SHORE:
      ap += AP.MOVEMENT_SHORE;
      break;
    case TravelCost.KNEEDEEP:
      ap += AP.MOVEMENT_LAKE;
      break;
    case TravelCost.DEEPWATER:
      ap += AP.MOVEMENT_OCEAN;
      break;
    case TravelCost.FENCE:
      return AP.JUMPFENCE;
    case TravelCost.NONE:
      return 0;
  }
  if (dir & 1) ap = Math.trunc((ap * 14) / 10);
  return ap;
}

export function actionPointCost(ctx: PointsContext, s: Soldier, g: number, dir: number, mode: number): number {
  const tile = terrainActionPoints(ctx, s, g, dir, s.level);
  const sw = ctx.env.world.costs.get(g, dir, s.level);
  if (sw === TravelCost.FENCE) return tile;
  const effective = isWater(ctx.env.world, g) ? walkingState(ctx.content) : mode;
  let points = 0;
  if (tile > 0) {
    switch (moveClassOf(ctx.content, effective)) {
      case 'run':
        points = Math.trunc(tile / RUN_DIVISOR);
        break;
      case 'walk':
        points = tile + WALK_COST;
        break;
      case 'swat':
        points = tile + SWAT_COST;
        break;
      case 'crawl':
        points = tile + CRAWL_COST;
        break;
      default:
        points = 1;
    }
  }
  if (sw === TravelCost.NOT_STANDING && DUCKING_STATES.has(stateName(ctx.content, effective))) points += AP.CROUCH;
  return points;
}

export function estimateActionPointCost(
  ctx: PointsContext,
  s: Soldier,
  g: number,
  dir: number,
  mode: number,
  pathIndex: number,
  pathLength: number,
): number {
  const tile = terrainActionPoints(ctx, s, g, dir, s.level);
  let points = 0;
  if (tile > 0) {
    switch (moveClassOf(ctx.content, mode)) {
      case 'run':
        points = Math.trunc(tile / RUN_DIVISOR);
        break;
      case 'walk':
        points = tile + WALK_COST;
        break;
      case 'swat':
        points = tile + SWAT_COST;
        break;
      case 'crawl':
        points = tile + CRAWL_COST;
        break;
      default:
        points = 1;
    }
  }
  const sw = ctx.env.world.costs.get(g, dir, s.level);
  const name = stateName(ctx.content, mode);
  if (sw === TravelCost.FENCE) {
    if (['SIDE_STEP', 'WALK_BACKWARDS', 'RUNNING', 'WALKING'].includes(name)) {
      if (pathIndex + 2 < pathLength) points += AP.CROUCH;
    } else if (['SWATTING', 'START_SWAT', 'SWAT_BACKWARDS'].includes(name)) points += AP.CROUCH;
  } else if (sw === TravelCost.NOT_STANDING && ['RUNNING', 'WALKING', 'SIDE_STEP', 'WALK_BACKWARDS'].includes(name)) points += AP.CROUCH;
  return points;
}

function walkingState(content: TacticalContent): number {
  return content.animations.controls.findIndex((c) => c.id === 'WALKING');
}

export function terrainBreathPoints(ctx: PointsContext, s: Soldier, g: number, dir: number, mode: number): number {
  const cost = ctx.env.world.costs.get(g, dir, 0);
  let points: number;
  switch (cost) {
    case TravelCost.DIRTROAD:
    case TravelCost.FLAT:
      points = BP.MOVEMENT_FLAT;
      break;
    case TravelCost.GRASS:
      points = BP.MOVEMENT_GRASS;
      break;
    case TravelCost.THICK:
      points = BP.MOVEMENT_BUSH;
      break;
    case TravelCost.DEBRIS:
      points = BP.MOVEMENT_RUBBLE;
      break;
    case TravelCost.SHORE:
      points = BP.MOVEMENT_SHORE;
      break;
    case TravelCost.KNEEDEEP:
      points = BP.MOVEMENT_LAKE;
      break;
    case TravelCost.DEEPWATER:
      points = BP.MOVEMENT_OCEAN;
      break;
    default:
      if (!isDoorTravelCost(cost)) return 0;
      points = BP.MOVEMENT_FLAT;
  }
  points = Math.trunc((points * breathAdjustmentForCarriedWeight(carriedWeightPercentOf(ctx.content, s))) / 100);
  const name = stateName(ctx.content, isWater(ctx.env.world, g) ? walkingState(ctx.content) : mode);
  if (RUN_STATES.has(name)) points *= RUN_ENERGY_FACTOR;
  else if (['SIDE_STEP', 'WALK_BACKWARDS', 'BLOODCAT_WALK_BACKWARDS', 'MONSTER_WALK_BACKWARDS', 'WALKING'].includes(name))
    points *= WALK_ENERGY_FACTOR;
  else if (['START_SWAT', 'SWATTING', 'SWAT_BACKWARDS'].includes(name)) points *= SWAT_ENERGY_FACTOR;
  else if (name === 'CRAWLING') points *= CRAWL_ENERGY_FACTOR;
  if (!ctx.inCombat) points = Math.trunc(points * RT_BREATH_DEDUCT_MODIFIER);
  return points;
}

export function minAPsToStartMovement(content: TacticalContent, s: Soldier, mode: number): number {
  const end = content.animations.controls[s.state]?.endHeight ?? AnimHeight.STAND;
  const cls = stateName(content, mode);
  let aps = 0;
  if (cls === 'RUNNING' || cls === 'WALKING') {
    if (end === AnimHeight.PRONE) aps += AP.CROUCH + AP.PRONE;
    else if (end === AnimHeight.CROUCH) aps += AP.CROUCH;
  } else if (cls === 'SWATTING') {
    if (end === AnimHeight.PRONE) aps += AP.PRONE;
    else if (end === AnimHeight.STAND) aps += AP.CROUCH;
  } else if (cls === 'CRAWLING') {
    if (end === AnimHeight.STAND) aps += AP.CROUCH + AP.PRONE;
    else if (end === AnimHeight.CROUCH) aps += AP.CROUCH;
  }
  if (cls === 'RUNNING' && stateName(content, s.state) !== 'RUNNING') aps += AP.START_RUN_COST;
  return aps;
}

function adjustBreathPts(s: Soldier, cost: number): number {
  let factor = 100 + (100 - s.breath);
  factor += Math.trunc((100 * (s.lifeMax - effectiveLife(s))) / s.lifeMax);
  if (s.stats.strength > 80) factor -= Math.trunc((s.stats.strength - 80) / 2);
  if (factor === 0) return 0;
  return cost > 0 ? Math.trunc((cost * factor) / 100) : Math.trunc((cost * 100) / factor);
}

export function enoughPoints(inCombat: boolean, s: Soldier, apCost: number): boolean {
  if (s.collapsed) return false;
  return s.actionPoints - (inCombat ? apCost : 0) >= 0;
}

export function deductPoints(inCombat: boolean, s: Soldier, apCost: number, bpCost: number): void {
  let ap = s.actionPoints - (inCombat ? apCost : 0);
  if (ap < 0 && s.actionPoints > 0) ap = 0;
  s.actionPoints = Math.max(ap, -MAX_AP_DEBT);
  if (!bpCost) return;
  const cost = adjustBreathPts(s, bpCost);
  s.breathRed = Math.min(MAX_BREATH_RED, Math.max(0, s.breathRed + cost));
  let breath = toInt8(Math.trunc(Math.fround(s.breathMax - Math.fround(s.breathRed / 100))));
  if (breath > 100) breath = 100;
  if (breath < 0) {
    s.actionPoints = Math.max(0, s.actionPoints + Math.trunc(breath / 5));
    breath = 0;
  }
  if (breath > s.breathMax) breath = s.breathMax;
  s.breath = breath;
}

export function breathAdjustmentForCarriedWeight(carriedPercent: number): number {
  if (carriedPercent < 101) return 100;
  if (carriedPercent < 151) return 100 + (carriedPercent - 100) * 3;
  if (carriedPercent < 201) return 100 + (carriedPercent - 100) * 3 + (carriedPercent - 150);
  return 100 + (carriedPercent - 100) * 3 + (carriedPercent - 150) + (carriedPercent - 200);
}

export function carriedWeightPercentOf(content: TacticalContent, s: Soldier): number {
  return carriedWeightPercent(content.items, s.inv, effectiveStrength(s));
}

function breathPerAP(ctx: PointsContext, s: Soldier, state: number): number {
  const flags = ctx.content.animations.controls[state]?.flags ?? 0;
  const name = stateName(ctx.content, state);
  let perAP = 0;
  if (flags & AnimFlags.VARIABLE_EFFORT) {
    perAP = BP_PER_AP.MIN_EFFORT;
    const inWater = isWater(ctx.env.world, s.gridNo);
    if (name === 'STANDING') perAP = inWater ? BP_PER_AP.LT_EFFORT : BP_PER_AP.NO_EFFORT;
    else if (name === 'WALKING') perAP = inWater ? BP_PER_AP.MOD_EFFORT : BP_PER_AP.LT_EFFORT;
  }
  if (flags & AnimFlags.NO_EFFORT) perAP = BP_PER_AP.NO_EFFORT;
  if (flags & AnimFlags.MIN_EFFORT) perAP = BP_PER_AP.MIN_EFFORT;
  if (flags & AnimFlags.LIGHT_EFFORT) perAP = BP_PER_AP.LT_EFFORT;
  if (flags & AnimFlags.MODERATE_EFFORT) perAP = BP_PER_AP.MOD_EFFORT;
  return perAP;
}

export function unusedAPsToBreath(ctx: PointsContext, s: Soldier, gassed: boolean): void {
  const adjustment = () => breathAdjustmentForCarriedWeight(carriedWeightPercentOf(ctx.content, s));
  if (!ctx.inCombat) {
    let change = 3 * Math.trunc((breathPerAP(ctx, s, s.state) * 100) / adjustment());
    if (change > 0) change = 0;
    else if (s.tilesMovedPerRTBreathUpdate > 0) {
      const moved = breathPerAP(ctx, s, s.lastMovementAnimPerRTBreathUpdate) * s.tilesMovedPerRTBreathUpdate;
      if (moved > 0) change += moved;
      if (change < 0) change = 0;
    }
    deductPoints(ctx.inCombat, s, 0, change);
    s.tilesMovedPerRTBreathUpdate = 0;
    return;
  }
  let change = 0;
  if (s.actionPoints > MAX_AP_CARRIED) {
    let perAP = breathPerAP(ctx, s, s.state);
    if (perAP < 0 && gassed) return;
    perAP = Math.trunc((perAP * 100) / adjustment());
    change = (s.actionPoints - MAX_AP_CARRIED) * perAP;
  }
  deductPoints(ctx.inCombat, s, 0, change);
}

export function maxActionPoints(bodyType: number): number {
  if (bodyType >= Body.ADULTFEMALEMONSTER && bodyType <= Body.QUEENMONSTER) return AP_LIMITS.MONSTER_MAXIMUM;
  if (bodyType >= Body.HUMVEE) return AP_LIMITS.VEHICLE_MAXIMUM;
  return AP_LIMITS.MAXIMUM;
}

export function calcActionPoints(content: TacticalContent, s: Soldier): number {
  if (!s.life) return 0;
  let points = 5 + Math.trunc((10 * effectiveExpLevel(s) + 3 * effectiveAgility(s) + 2 * s.lifeMax + 2 * effectiveDexterity(s) + 20) / 40);
  points &= 0xff;
  if (s.life < s.lifeMax) points = (points - Math.trunc((2 * points * (s.lifeMax - effectiveLife(s))) / (3 * s.lifeMax))) & 0xff;
  if (s.breath < 100) points = (points - Math.trunc((points * (100 - s.breath)) / 200)) & 0xff;
  if (s.weightCarriedAtTurnStart > 100) points = Math.trunc((points * 100) / s.weightCarriedAtTurnStart) & 0xff;
  if (points < AP_LIMITS.MINIMUM) points = AP_LIMITS.MINIMUM;
  points = Math.min(points, maxActionPoints(s.bodyType));
  if (s.bodyType === Body.BLOODCAT) points = Math.trunc((points * AP_LIMITS.YOUNG_MONST_FACTOR) / 10);
  else if (s.monsterOrAnimal && s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER) {
    if (s.bodyType === Body.YAF_MONSTER || s.bodyType === Body.YAM_MONSTER || s.bodyType === Body.INFANT_MONSTER)
      points = Math.trunc((points * AP_LIMITS.YOUNG_MONST_FACTOR) / 10);
  }
  return points & 0xff;
}

export function calcNewActionPoints(content: TacticalContent, s: Soldier): void {
  if (s.actionPoints > MAX_AP_CARRIED) s.actionPoints = MAX_AP_CARRIED;
  s.actionPoints += calcActionPoints(content, s);
  s.actionPoints = Math.min(s.actionPoints, maxActionPoints(s.bodyType));
  s.initialActionPoints = s.actionPoints;
}

export function apsToChangeStance(content: TacticalContent, s: Soldier, desired: number): number {
  const current = content.animations.controls[s.state]?.endHeight ?? AnimHeight.STAND;
  if (current === desired) return 0;
  if (current === AnimHeight.STAND) return desired === AnimHeight.PRONE ? AP.CROUCH + AP.PRONE : AP.CROUCH;
  if (current === AnimHeight.CROUCH) return desired === AnimHeight.PRONE ? AP.PRONE : AP.CROUCH;
  return desired === AnimHeight.STAND ? AP.PRONE + AP.CROUCH : AP.PRONE;
}

export function apsToLook(content: TacticalContent, s: Soldier): number {
  switch (content.animations.controls[s.state]?.endHeight) {
    case AnimHeight.STAND:
      return AP.LOOK_STANDING;
    case AnimHeight.CROUCH:
      return AP.LOOK_CROUCHED;
    case AnimHeight.PRONE:
      return AP.LOOK_PRONE + AP.PRONE + AP.PRONE;
    default:
      return 0;
  }
}

export function apsToReadyWeapon(content: TacticalContent, s: Soldier): number {
  const def = content.items.byIndex.get(itemIn(s.inv, InvSlot.HAND));
  return def?.itemClass === ItemClass.GUN ? (def.weapon?.readyTime ?? 0) : 0;
}

export function minPtsToMove(ctx: PointsContext, s: Soldier, mode: number): number {
  let lowest = 127;
  for (let dir = 0; dir <= 7; dir++) {
    const g = newGridNo(s.gridNo, DIRECTION_INCREMENT[dir] ?? 0);
    if (g === s.gridNo) continue;
    lowest = Math.min(lowest, actionPointCost(ctx, s, g, dir, mode));
  }
  return lowest;
}

export function ptsToMoveDirection(ctx: PointsContext, s: Soldier, dir: number, mode: number): number {
  const g = newGridNo(s.gridNo, DIRECTION_INCREMENT[dir] ?? 0);
  const running = stateName(ctx.content, mode) === 'RUNNING';
  const useMode = isWater(ctx.env.world, g) ? walkingState(ctx.content) : mode;
  let cost = actionPointCost(ctx, s, g, dir, useMode);
  if (ctx.env.world.costs.get(g, dir, s.level) !== TravelCost.FENCE) {
    if (running && !isWater(ctx.env.world, g) && stateName(ctx.content, s.state) !== 'RUNNING') cost += AP.START_RUN_COST;
  }
  return cost;
}
