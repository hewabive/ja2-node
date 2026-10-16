// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIUtils.cc ClosestReachableDisturbance, ClosestReachableFriendInTrouble,
// @src EstimatePathCostToLocation (with the climb estimates), ClosestSeenOpponent; Tactical/PathAI.cc PlotPath, EstimatePlotPath, RecalculatePathCost;
// @src Tactical/Items.cc FindAIUsableObjClass(Within); Tactical/OppList.cc GetHighestVisibleWatchedLoc, GetHighestWatchedLocPoints;
// @src Tactical/LOS.cc LocationToLocationLineOfSightTest. See docs/13 §2, §4.4.

import { ItemClass } from '../../../content/items/items.ts';
import { newGridNo, pythSpacesAway, WORLD_COLS } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { ObjectFlags, USABLE_STATUS } from '../../items/object.ts';
import { climbingNecessary, findClosestClimbPointAvailableToAI } from '../buildings.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { DIRECTION_INCREMENT } from '../directions.ts';
import { findBestPath, isWater, PathCopy } from '../pathfinding.ts';
import { guySawEnemyThisTurnOrBefore } from '../perception/knowledge.ts';
import { landHeightUnits, lineOfSightTest, STANDING_TREE_REDUCTION } from '../perception/los.ts';
import { Opp } from '../perception/opp.ts';
import { distanceVisible, knowledge } from '../perception/sight.ts';
import { AP, minAPsToStartMovement, stateName, terrainActionPoints } from '../points.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { NUM_WATCHED_LOCS } from '../turns/turn-state.ts';

const MAX_DISTANCE_VISIBLE = 26;
const IRRELEVANT = -1;
const STANDING_LOS_POS = 175;
const HEIGHT_UNITS = 256;
const RUNDIVISOR = 1.8;

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
  const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
  const walking = t.content.animations.stateIndex.get('WALKING') ?? -1;
  const running = t.content.animations.stateIndex.get('RUNNING') ?? -1;
  let pts = minAPsToStartMovement(t.content, s, mode);
  const first = newGridNo(s.gridNo, DIRECTION_INCREMENT[steps[0] ?? 0] ?? 0);
  if (t.world.costs.get(first, steps[0] ?? 0, s.level) === TravelCost.FENCE && mode === running && s.state !== running) pts -= 1;
  let ignoreNext = false;
  let g = s.gridNo;
  const n = steps.length;
  for (let i = 0; i < n; i++) {
    const d = steps[i] ?? 0;
    g = newGridNo(g, DIRECTION_INCREMENT[d] ?? 0);
    const sw = t.world.costs.get(g, d, s.level);
    const tile = terrainActionPoints(ctx, s, g, d, s.level);
    const m = isWater(t.pathWorld, g) ? walking : mode;
    const cls = stateName(t.content, m);
    if (ignoreNext) ignoreNext = false;
    else if (sw === TravelCost.FENCE) {
      pts += tile;
      ignoreNext = true;
      if ((cls === 'RUNNING' || cls === 'WALKING') && i + 2 < n) pts += 2 + (cls === 'RUNNING' ? 1 : 0);
      if (cls === 'SWATTING') pts += 2;
    } else if (tile > 0) {
      const extra = sw === TravelCost.NOT_STANDING && (cls === 'RUNNING' || cls === 'WALKING') ? 2 : 0;
      if (cls === 'RUNNING') pts += Math.trunc(tile / RUNDIVISOR) + extra;
      else if (cls === 'WALKING') pts += tile - 1 + extra;
      else if (cls === 'CRAWLING') pts += tile + 1;
      else pts += tile;
    }
  }
  return pts;
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
    if (
      s.level !== level ||
      pythSpacesAway(s.gridNo, publicNoise) >= 6 ||
      soldierTo3DLocationLos(t, s, publicNoise, level, 0, MAX_DISTANCE_VISIBLE, false) === 0
    ) {
      const r = estimatePathCostToLocation(t, s, publicNoise, level, false);
      if (r.cost !== 0) {
        disturbance = r.climb ? r.climbGridNo : publicNoise;
        climb = r.climb;
      }
    } else t.perception.publicNoiseGridNo[s.team] = publicNoise - 2;
  }
  return { gridNo: disturbance, climb };
}

export function closestReachableFriendInTrouble(t: TacticalState, s: Soldier): Disturbance | null {
  if (s.team === Team.CIV) return null;
  let closest = NOWHERE;
  let shortest = 1000;
  let climb = false;
  for (const friend of t.mercSlots) {
    if (!friend?.placed || friend.neutral || s.side !== friend.side || friend === s) continue;
    if (!friend.ai.underFire && (friend !== t.perception.lastMercToRadio[friend.team] || !guySawEnemyThisTurnOrBefore(t, friend))) continue;
    const dx = Math.abs((s.gridNo % WORLD_COLS) - (friend.gridNo % WORLD_COLS));
    const dy = Math.abs(Math.trunc(s.gridNo / WORLD_COLS) - Math.trunc(friend.gridNo / WORLD_COLS));
    if (Math.max(dx, dy) === 1) continue;
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
  for (const s of t.mercSlots) if (s?.placed && s.team === team && !s.dead) n++;
  return n;
}

export function closestSeenOpponent(t: TacticalState, s: Soldier): number {
  let closest = NOWHERE;
  let closestRange = 1500;
  for (const opp of t.mercSlots) {
    if (!opp?.placed || considered(s, opp)) continue;
    if ((s.oppList[opp.id] ?? 0) !== Opp.SEEN_CURRENTLY || opp.gridNo === s.gridNo) continue;
    const dx = (s.gridNo % WORLD_COLS) - (opp.gridNo % WORLD_COLS);
    const dy = Math.trunc(s.gridNo / WORLD_COLS) - Math.trunc(opp.gridNo / WORLD_COLS);
    const range = Math.trunc(Math.sqrt(dx * dx + dy * dy) * 10);
    if (range < closestRange) {
      closestRange = range;
      closest = opp.gridNo;
    }
  }
  return closest;
}
