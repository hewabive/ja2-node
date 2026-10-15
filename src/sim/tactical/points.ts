// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Points.cc TerrainActionPoints, TerrainBreathPoints, ActionPointCost, MinAPsToStartMovement,
// @src PtsToMoveDirection, DeductPoints, AdjustBreathPts; Points.h; RT_Time_Defines.h. See docs/07 §3.6.

import { isDoorTravelCost, TravelCost } from '../../content/world/movement-costs.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { AnimHeight } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { doorObstacleIfClosed, doorState, isWater, type PathEnv, terrainCost } from './pathfinding.ts';
import { type Soldier, Team } from './soldier.ts';

export const AP = {
  MOVEMENT_FLAT: 3,
  MOVEMENT_GRASS: 4,
  MOVEMENT_BUSH: 5,
  MOVEMENT_RUBBLE: 6,
  MOVEMENT_SHORE: 7,
  MOVEMENT_LAKE: 9,
  MOVEMENT_OCEAN: 8,
  JUMPFENCE: 6,
  CROUCH: 2,
  PRONE: 2,
  START_RUN_COST: 1,
  STEALTH_MODIFIER: 2,
  REVERSE_MODIFIER: 1,
} as const;

export const BP = {
  MOVEMENT_FLAT: 5,
  MOVEMENT_GRASS: 10,
  MOVEMENT_BUSH: 20,
  MOVEMENT_RUBBLE: 35,
  MOVEMENT_SHORE: 50,
  MOVEMENT_LAKE: 75,
  MOVEMENT_OCEAN: 100,
  JUMPFENCE: 200,
  CROUCH: 10,
  PRONE: 10,
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

function walkingState(content: TacticalContent): number {
  return content.animations.controls.findIndex((c) => c.id === 'WALKING');
}

export function terrainBreathPoints(ctx: PointsContext, g: number, dir: number, mode: number): number {
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

export interface BreathState {
  breath: number;
  breathMax: number;
  breathRed: number;
  readonly life: number;
  readonly lifeMax: number;
  readonly stats: { readonly strength: number };
}

function adjustBreathPts(s: BreathState, cost: number): number {
  let factor = 100 + (100 - s.breath);
  factor += Math.trunc((100 * (s.lifeMax - s.life)) / s.lifeMax);
  if (s.stats.strength > 80) factor -= Math.trunc((s.stats.strength - 80) / 2);
  if (factor === 0) return 0;
  return cost > 0 ? Math.trunc((cost * factor) / 100) : Math.trunc((cost * 100) / factor);
}

export function deductBreath(s: BreathState, bpCost: number): void {
  if (!bpCost) return;
  const cost = adjustBreathPts(s, bpCost);
  s.breathRed = Math.min(MAX_BREATH_RED, Math.max(0, s.breathRed + cost));
  let breath = Math.trunc(Math.fround(s.breathMax - Math.fround(s.breathRed / 100)));
  if (breath > 100) breath = 100;
  if (breath < 0) breath = 0;
  if (breath > s.breathMax) breath = s.breathMax;
  s.breath = breath;
}
