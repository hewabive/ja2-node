// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIUtils.cc ClosestReachableDisturbance, ClosestReachableFriendInTrouble,
// @src EstimatePathCostToLocation (with the climb estimates), ClosestSeenOpponent, ClosestPC; Tactical/PathAI.cc PlotPath,
// @src EstimatePlotPath, RecalculatePathCost;
// @src Tactical/Items.cc FindAIUsableObjClass(Within); Tactical/OppList.cc GetHighestVisibleWatchedLoc, GetHighestWatchedLocPoints;
// @src Tactical/LOS.cc LocationToLocationLineOfSightTest.

import { ItemClass } from '../../../content/items/items.ts';
import { pythSpacesAway, spacesAway, WORLD_MAX } from '../../../content/world/grid.ts';
import { ObjectFlags, USABLE_STATUS } from '../../items/object.ts';
import { climbingNecessary, findClosestClimbPointAvailableToAI } from '../buildings.ts';
import { rangeInUnits } from '../combat/chance.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { findBestPath, PathCopy } from '../pathfinding.ts';
import { guySawEnemyThisTurnOrBefore, noiseStillUseful } from '../perception/knowledge.ts';
import { landHeightUnits, lineOfSightTest, STANDING_TREE_REDUCTION } from '../perception/los.ts';
import { Opp } from '../perception/opp.ts';
import { distanceVisible, knowledge } from '../perception/sight.ts';
import { plotPathSteps } from '../plot-path.ts';
import { AP, stateName } from '../points.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers, whoIsThere } from '../state.ts';
import { NUM_WATCHED_LOCS } from '../turns/turn-state.ts';

const IRRELEVANT = -1;
const STANDING_LOS_POS = 175;
const HEIGHT_UNITS = 256;
const UNSEEN_PC_DISTANCE_PENALTY = 10;
const DEGRADED_NOISE_TILES_WEST = 2;
const ADJACENT = 1;

export function findAIUsableObjClass(t: TacticalState, s: Soldier, itemClass: number): number {
  return findAIUsableObjClassWithin(t, s, itemClass, 0, s.inv.length - 1);
}

export function findAIUsableObjClassWithin(t: TacticalState, s: Soldier, itemClass: number, lower: number, upper: number): number {
  for (let k = lower; k <= upper; k++) {
    const o = s.inv[k];
    if (!o) continue;
    const def = t.content.items.byIndex.get(o.item);
    if (!def || !(def.itemClass & itemClass) || o.flags & ObjectFlags.AI_UNUSABLE || (o.status[0] ?? 0) < USABLE_STATUS) continue;
    if (itemClass === ItemClass.GUN && isExplosiveGun(t, o.item)) continue;
    return k;
  }
  return -1;
}

export function isExplosiveGun(t: TacticalState, item: number): boolean {
  return item === t.content.items.byName.get('ROCKET_LAUNCHER')?.index || item === t.content.items.byName.get('TANK_CANNON')?.index;
}

export function plotPathCost(t: TacticalState, s: Soldier, dest: number, mode: number): number {
  const route = findBestPath(t.pathEnv, s, dest, s.level, { copy: PathCopy.NONE, mode: moveModeName(t, mode) });
  return route.length === 0 ? 0 : routeCost(t, s, route.steps, mode);
}

export function estimatePlotPathCost(t: TacticalState, s: Soldier, dest: number, mode: number): number {
  const route = findBestPath(t.pathEnv, s, dest, s.level, { copy: PathCopy.NONE, mode: moveModeName(t, mode), estimate: true });
  return route.length === 0 ? 0 : routeCost(t, s, route.steps, mode);
}

export function recalculatePathCost(t: TacticalState, s: Soldier, mode: number): number {
  if (!s.pathStored || s.pathSize === 0) return 0;
  return routeCost(t, s, s.path.slice(0, s.pathSize), mode);
}

function routeCost(t: TacticalState, s: Soldier, steps: readonly number[], mode: number): number {
  return plotPathSteps(t, s, steps, mode, { plot: false, budget: 0 }).points;
}

function moveModeName(t: TacticalState, mode: number): 'WALKING' | 'RUNNING' | 'SWATTING' | 'CRAWLING' {
  const name = stateName(t.content, mode);
  return name === 'RUNNING' || name === 'SWATTING' || name === 'CRAWLING' ? name : 'WALKING';
}

export interface PathCostToLocation {
  readonly cost: number;
  readonly climb: boolean;
  readonly climbGridNo: number;
}

const WALK_ESTIMATE_PER_TILE = 2;
const NO_CLIMB_COST: PathCostToLocation = { cost: 0, climb: false, climbGridNo: NOWHERE };

export function estimatePathCostToLocation(
  t: TacticalState,
  s: Soldier,
  dest: number,
  destLevel: number,
  addAfterClimbUp: boolean,
): PathCostToLocation {
  const walking = t.content.animations.stateIndex.get('WALKING') ?? 0;
  const sameLevel = s.level === destLevel;
  if (sameLevel && !climbingNecessary(t, s, dest, destLevel))
    return { cost: estimatePlotPathCost(t, s, dest, walking), climb: false, climbGridNo: NOWHERE };
  const climbUp = !sameLevel && s.level === 0;
  const climbGridNo = findClosestClimbPointAvailableToAI(t, s, s.gridNo, climbUp ? dest : s.gridNo, climbUp);
  if (climbGridNo === NOWHERE) return NO_CLIMB_COST;
  let cost = plotPathCost(t, s, climbGridNo, walking);
  if (cost === 0) return NO_CLIMB_COST;
  const walkAfter = WALK_ESTIMATE_PER_TILE * pythSpacesAway(climbGridNo, dest);
  if (sameLevel) {
    cost += addAfterClimbUp ? AP.CLIMBOFFROOF + AP.CLIMBROOF + walkAfter : AP.CLIMBOFFROOF + Math.trunc(walkAfter / 2);
  } else if (climbUp) cost += AP.CLIMBROOF + (addAfterClimbUp ? walkAfter : 0);
  else cost += AP.CLIMBOFFROOF + walkAfter;
  return { cost, climb: true, climbGridNo };
}

const considered = (s: Soldier, opp: Soldier) => (opp.neutral && s.team !== Team.CREATURE) || s.side === opp.side;

export interface Disturbance {
  readonly gridNo: number;
  readonly climb: boolean;
}

export function closestReachableDisturbance(t: TacticalState, s: Soldier): Disturbance {
  let closestEnemy = NOWHERE;
  let closestLevel = 0;
  let closestDist = 1000;
  let disturbance = NOWHERE;
  let climb = false;
  for (const opp of t.mercSlots) {
    if (!opp?.placed || considered(s, opp)) continue;
    const personal = s.oppList[opp.id] ?? 0;
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (personal === Opp.NOT_HEARD_OR_SEEN && publicValue === Opp.NOT_HEARD_OR_SEEN) continue;
    if (personal === Opp.SEEN_CURRENTLY && opp.life >= OKLIFE) return { gridNo: NOWHERE, climb: false };
    const g =
      knowledge(publicValue, personal) > 0 || personal === publicValue
        ? (s.lastKnownOpp[opp.id] ?? NOWHERE)
        : (t.perception.publicLastKnown[s.team]?.[opp.id] ?? NOWHERE);
    if (g === s.gridNo || g === NOWHERE) continue;
    const d = pythSpacesAway(s.gridNo, g);
    if (d < closestDist) {
      closestEnemy = g;
      closestLevel = opp.level;
      closestDist = d;
    }
  }
  if (closestEnemy !== NOWHERE) {
    const r = estimatePathCostToLocation(t, s, closestEnemy, closestLevel, false);
    if (r.cost !== 0) {
      disturbance = r.climb ? r.climbGridNo : closestEnemy;
      climb = r.climb;
    }
  }
  if (s.ai.noiseGridNo !== NOWHERE && s.ai.noiseGridNo !== disturbance) {
    if (s.ai.noiseGridNo === s.gridNo) {
      s.ai.noiseGridNo = NOWHERE;
      s.ai.noiseVolume = 0;
    } else {
      const r = estimatePathCostToLocation(t, s, s.ai.noiseGridNo, s.ai.noiseLevel, false);
      if (r.cost !== 0) {
        disturbance = r.climb ? r.climbGridNo : s.ai.noiseGridNo;
        climb = r.climb;
      }
    }
  }
  const publicNoise = t.perception.publicNoiseGridNo[s.team] ?? NOWHERE;
  if (publicNoise !== NOWHERE && publicNoise !== disturbance) {
    const level = t.perception.publicNoiseLevel[s.team] ?? 0;
    if (noiseStillUseful(t, s, publicNoise, level)) {
      const r = estimatePathCostToLocation(t, s, publicNoise, level, false);
      if (r.cost !== 0) {
        disturbance = r.climb ? r.climbGridNo : publicNoise;
        climb = r.climb;
      }
    } else degradePublicNoise(t, s.team, publicNoise);
  }
  return { gridNo: disturbance, climb };
}

function degradePublicNoise(t: TacticalState, team: number, noise: number): void {
  t.perception.publicNoiseGridNo[team] = noise - DEGRADED_NOISE_TILES_WEST;
}

export function closestReachableFriendInTrouble(t: TacticalState, s: Soldier): Disturbance | null {
  if (s.team === Team.CIV) return null;
  let closest = NOWHERE;
  let shortest = 1000;
  let climb = false;
  for (const friend of t.mercSlots) {
    if (!friend?.placed || friend.neutral || s.side !== friend.side || friend === s) continue;
    if (!friend.ai.underFire && (friend !== t.perception.lastMercToRadio[friend.team] || !guySawEnemyThisTurnOrBefore(t, friend))) continue;
    if (spacesAway(s.gridNo, friend.gridNo) === ADJACENT) continue;
    const r = estimatePathCostToLocation(t, s, friend.gridNo, friend.level, true);
    if (r.cost !== 0 && r.cost < shortest) {
      closest = r.climb ? r.climbGridNo : friend.gridNo;
      shortest = r.cost;
      climb = r.climb;
    }
  }
  return { gridNo: closest, climb };
}

export function getHighestWatchedLocPoints(t: TacticalState, s: Soldier): number {
  let best = 0;
  for (let k = 0; k < NUM_WATCHED_LOCS; k++) {
    const i = s.id * NUM_WATCHED_LOCS + k;
    if ((t.turn.watched.gridNo[i] ?? NOWHERE) === NOWHERE) continue;
    best = Math.max(best, t.turn.watched.points[i] ?? 0);
  }
  return best;
}

export function getHighestVisibleWatchedLoc(t: TacticalState, s: Soldier): number {
  let bestLoc = -1;
  let bestPoints = 0;
  for (let k = 0; k < NUM_WATCHED_LOCS; k++) {
    const i = s.id * NUM_WATCHED_LOCS + k;
    const loc = t.turn.watched.gridNo[i] ?? NOWHERE;
    if (loc === NOWHERE) continue;
    const pts = t.turn.watched.points[i] ?? 0;
    if (pts <= bestPoints) continue;
    const level = t.turn.watched.level[i] ?? 0;
    const visible = distanceVisible(t, s, IRRELEVANT, IRRELEVANT, loc, level);
    if (soldierTo3DLocationLos(t, s, loc, level, 3, visible, true)) {
      bestLoc = k;
      bestPoints = pts;
    }
  }
  return bestLoc;
}

export function watchedLocGridNo(t: TacticalState, s: Soldier, k: number): number {
  return t.turn.watched.gridNo[s.id * NUM_WATCHED_LOCS + k] ?? NOWHERE;
}

export function locationToLocationLos(
  t: TacticalState,
  start: number,
  startLevel: number,
  end: number,
  endLevel: number,
  limit: number,
  aware: boolean,
): number {
  const soldier = whoIsThere(t, start, startLevel);
  if (soldier) return soldierTo3DLocationLos(t, soldier, end, endLevel, 0, limit, aware);
  const world = { structures: t.world.structures, heights: t.world.level.heights };
  const startZ = STANDING_LOS_POS + startLevel * HEIGHT_UNITS + landHeightUnits(world, start);
  const endZ = STANDING_LOS_POS + endLevel * HEIGHT_UNITS + landHeightUnits(world, end);
  return lineOfSightTest(world, start, startZ, end, endZ, {
    tileLimit: limit,
    treeReduction: STANDING_TREE_REDUCTION,
    aware,
    camo: 0,
    disallowSight: t.perception.disallowSight,
  });
}

export function menInSector(t: TacticalState, team: number): number {
  let n = 0;
  for (const s of t.mercSlots) if ((s?.placed || s?.offMap) && s.team === team && !s.dead) n++;
  return n;
}

export function closestSeenOpponent(t: TacticalState, s: Soldier): number {
  let closest = NOWHERE;
  let closestRange = 1500;
  for (const opp of t.mercSlots) {
    if (!opp?.placed || considered(s, opp)) continue;
    if ((s.oppList[opp.id] ?? 0) !== Opp.SEEN_CURRENTLY || opp.gridNo === s.gridNo) continue;
    const range = rangeInUnits(s.gridNo, opp.gridNo);
    if (range < closestRange) {
      closestRange = range;
      closest = opp.gridNo;
    }
  }
  return closest;
}

export function closestPC(t: TacticalState, s: Soldier): number {
  let closestDistance = WORLD_MAX;
  let closest = NOWHERE;
  for (const pc of teamMembers(t, Team.OUR)) {
    if (pc.life < OKLIFE || t.narrative.isEpc(pc)) continue;
    let distance = pythSpacesAway(s.gridNo, pc.gridNo);
    if (pc.team !== s.team && s.oppList[pc.id] !== Opp.SEEN_CURRENTLY) distance += UNSEEN_PC_DISTANCE_PENALTY;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = pc.gridNo;
    }
  }
  return closest;
}
