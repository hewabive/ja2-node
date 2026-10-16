// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/FindLocations.cc CalcPercentBetter, AICenterXY, CalcWorstCTGTForPosition,
// @src CalcAverageCTGTForPosition, CalcBestCTGT, CalcCoverValue, NumberOfTeamMatesAdjacent, FindBestNearbyCover,
// @src FindSpotMaxDistFromOpponents, FindNearestUngassedLand, FindNearbyDarkerSpot; AIUtils.cc InGas, InGasOrSmoke,
// @src InWaterOrGas, InWaterGasOrSmoke, InLightAtNight, GetTraversalQuoteActionID; TileEngine/Isometric_Utils.cc
// @src GridNoOnEdgeOfMap; TileEngine/WorldMan.cc WaterTooDeepForAttacks. See docs/13 §8.

import {
  CELL_X_SIZE,
  DIRECTION_COUNT,
  DIRECTION_INCREMENT,
  Direction,
  directionIncrement,
  newGridNo,
  pythSpacesAway,
  spacesAway,
  WORLD_COLS,
  WORLD_MAX,
  WORLD_ROWS,
} from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { clamp, i16, idiv, u8 } from '../../../core/int.ts';
import { AnimHeight, states } from '../animation.ts';
import { soldierToLocationChanceToGetThrough } from '../combat/bullets.ts';
import { rangeInUnits, soldierDifficultyLevel } from '../combat/chance.ts';
import { inGas, inSmoke } from '../explosions/smoke.ts';
import { aiPathCostIndex, findBestPath, MoveMode, NOWHERE, newOKDestination, PathCopy, type PathEnv } from '../pathfinding.ts';
import { AP, apsToChangeStance, calcActionPoints, minAPsToStartMovement, stateName } from '../points.ts';
import { AlertStatus, cellCentre, type Soldier, Team } from '../soldier.ts';
import { mercs, type TacticalState, whoIsThere } from '../state.ts';
import { AiAction, MAX_ROAMING_RANGE } from './actions.ts';
import { determineMovementMode } from './decide.ts';
import { legalNPCDestination, PathMode, roamingRange } from './destinations.ts';
import {
  bestGuessLocation,
  calcManThreatValue,
  ignoredByBountyHunter,
  isKnowableOpponent,
  isUnknown,
  mostRecentOpplistValue,
  NO_THREAT,
  opponentKnowledge,
  rangeChangeDesire,
  threatPercent,
} from './morale.ts';
import { plotPathCost } from './utils.ts';

export const QuoteAction = { NONE: 0, TRAVERSE_EAST: 5, TRAVERSE_SOUTH: 6, TRAVERSE_WEST: 7, TRAVERSE_NORTH: 8 } as const;

const DIFF_MAX_COVER_RANGE = [4, 6, 8, 10, 13];
const MAX_THREAT_RANGE = 400;
const MIN_PERCENT_BETTER = 5;
const SEE_THRU_COVER_THRESHOLD = 5;
const AIM_PENALTY_TARGET_CROUCHED = 20;
const MAX_DIFFICULTY_LEVEL_PLUS_ONE = 5;
const NO_ROAM_LIMIT = -1;
const FAR_AWAY = 1500;
const FLEE_ROAM_RANGE = 100;
const FLEE_RT_HALVING_THRESHOLD = 4;
const UNGASSED_SEARCH_STEP = 5;
const UNGASSED_SEARCH_MAX = 25;
const SHORTEST_PATH_START = 1000;
const NO_ESCAPE = -1;
const PRONE_CUBE = 1;
const CROUCH_CUBE = 2;
const STAND_CUBE = 3;
const FULL_CHANCE = 100;

export interface CoverChoice {
  readonly gridNo: number;
  readonly percentBetter: number;
}

export interface FleeSpot {
  readonly gridNo: number;
  readonly traversalQuoteAction: number;
}

interface Threat {
  readonly opponent: Soldier;
  readonly gridNo: number;
  readonly value: number;
  readonly certainty: number;
  readonly origRange: number;
  readonly aps: number;
}

interface CoverScore {
  readonly value: number;
  readonly scale: number;
}

interface Placement {
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
}

interface SearchSquare {
  readonly origin: number;
  readonly maxLeft: number;
  readonly maxRight: number;
  readonly maxUp: number;
  readonly maxDown: number;
}

interface SquareTile {
  readonly g: number;
  readonly dx: number;
  readonly dy: number;
}

export interface Flood {
  readonly reachable: Uint8Array;
  readonly apCosts: Int8Array | null;
}

const NO_COVER: CoverChoice = { gridNo: NOWHERE, percentBetter: 0 };
const NO_FLEE_SPOT: FleeSpot = { gridNo: NOWHERE, traversalQuoteAction: QuoteAction.NONE };

function waterTooDeepForAttacks(t: TacticalState, g: number): boolean {
  return t.world.terrain[g] === Terrain.DEEP_WATER;
}

function inWaterOrGas(t: TacticalState, s: Soldier, g: number): boolean {
  return waterTooDeepForAttacks(t, g) || inGas(t, s, g);
}

function inWaterGasOrSmoke(t: TacticalState, s: Soldier, g: number): boolean {
  return waterTooDeepForAttacks(t, g) || inSmoke(t, s, g) || inGas(t, s, g);
}

export function inLightAtNight(_t: TacticalState, _g: number, _level: number): boolean {
  return false;
}

export function findNearbyDarkerSpot(_t: TacticalState, _s: Soldier): number {
  return NOWHERE;
}

export function calcPercentBetter(oldValue: number, newValue: number, oldScale: number, newScale: number): number {
  const change = newValue - oldValue;
  if (change <= 0) return 0;
  const scaleSum = oldScale + newScale;
  if (scaleSum <= 0) return 0;
  return idiv(change * 100, scaleSum);
}

function placementOf(s: Soldier): Placement {
  return { gridNo: s.gridNo, x: s.x, y: s.y };
}

function restorePlacement(s: Soldier, p: Placement): void {
  s.gridNo = p.gridNo;
  s.x = p.x;
  s.y = p.y;
}

function placeAtCentre(s: Soldier, g: number): void {
  const centre = cellCentre(g);
  s.gridNo = g;
  s.x = Math.fround(centre.x);
  s.y = Math.fround(centre.y);
}

function cubeLevelAffordable(cubeLevel: number, aps: number): boolean {
  if (cubeLevel === PRONE_CUBE) return aps >= AP.CROUCH + AP.PRONE;
  if (cubeLevel === CROUCH_CUBE) return aps >= AP.CROUCH;
  return true;
}

function calcWorstCTGTForPosition(t: TacticalState, shooter: Soldier, target: Soldier, g: number, level: number, aps: number): number {
  let worst = FULL_CHANCE;
  for (let cube = PRONE_CUBE; cube <= STAND_CUBE; cube++) {
    if (!cubeLevelAffordable(cube, aps)) continue;
    const chance = soldierToLocationChanceToGetThrough(t, shooter, g, level, cube, target);
    if (chance < worst) {
      worst = chance;
      if (worst === 0) break;
    }
  }
  return worst;
}

function calcAverageCTGTForPosition(t: TacticalState, shooter: Soldier, target: Soldier, g: number, level: number, aps: number): number {
  let total = 0;
  let cubes = 0;
  for (let cube = PRONE_CUBE; cube <= STAND_CUBE; cube++) {
    if (!cubeLevelAffordable(cube, aps)) continue;
    total += soldierToLocationChanceToGetThrough(t, shooter, g, level, cube, target);
    cubes++;
  }
  return idiv(total, cubes);
}

function sideStepCheckSpot(direction: number, adjacent: number, north: number, south: number, previous: number): number {
  switch (direction) {
    case Direction.NORTH:
    case Direction.EAST:
    case Direction.SOUTH:
    case Direction.WEST:
      return adjacent;
    case Direction.NORTHEAST:
    case Direction.NORTHWEST:
      return north;
    case Direction.SOUTHEAST:
    case Direction.SOUTHWEST:
      return south;
    default:
      return previous;
  }
}

function calcBestCTGT(t: TacticalState, him: Soldier, me: Soldier, myGrid: number, myLevel: number, myAps: number): number {
  const central = him.gridNo;
  const north = newGridNo(central, directionIncrement(Direction.NORTH));
  const south = newGridNo(central, directionIncrement(Direction.SOUTH));
  let checkSpot = NOWHERE;
  let best = 0;
  for (let direction = 1; direction <= DIRECTION_COUNT; direction++) {
    const adjacent = newGridNo(central, directionIncrement(direction));
    if (adjacent === central) continue;
    if (!newOKDestination(t.pathEnv, him, adjacent, false, myLevel) || inWaterOrGas(t, him, adjacent)) continue;
    checkSpot = sideStepCheckSpot(direction, adjacent, north, south, checkSpot);
    if (!newOKDestination(t.pathEnv, him, checkSpot, false, myLevel)) continue;
    placeAtCentre(him, adjacent);
    const chance = calcWorstCTGTForPosition(t, him, me, myGrid, myLevel, myAps);
    if (chance > best) {
      best = chance;
      if (best === FULL_CHANCE) break;
    }
  }
  return best;
}

function hisChanceToGetThrough(t: TacticalState, him: Soldier, hisGrid: number, me: Soldier, myGrid: number, myAps: number): number {
  const actual = inWaterOrGas(t, him, hisGrid) ? 0 : calcWorstCTGTForPosition(t, him, me, myGrid, me.level, myAps);
  if (actual >= FULL_CHANCE) return actual;
  const best = calcBestCTGT(t, him, me, myGrid, me.level, myAps);
  return best > actual ? idiv(2 * best + actual, 3) : actual;
}

function myChanceToGetThrough(t: TacticalState, me: Soldier, myGrid: number, him: Soldier, hisGrid: number, myAps: number): number {
  if (inWaterGasOrSmoke(t, me, myGrid)) return 0;
  if (him.gridNo !== hisGrid) placeAtCentre(him, hisGrid);
  const chance = calcAverageCTGTForPosition(t, me, him, hisGrid, him.level, myAps);
  return chance < SEE_THRU_COVER_THRESHOLD ? 0 : chance;
}

function chancesToGetThrough(
  t: TacticalState,
  me: Soldier,
  myGrid: number,
  myAps: number,
  him: Soldier,
  hisGrid: number,
): { readonly his: number; readonly mine: number } {
  const myReal = placementOf(me);
  const hisReal = placementOf(him);
  if (me.gridNo !== myGrid) placeAtCentre(me, myGrid);
  if (him.gridNo !== hisGrid) placeAtCentre(him, hisGrid);
  const his = hisChanceToGetThrough(t, him, hisGrid, me, myGrid, myAps);
  const mine = myChanceToGetThrough(t, me, myGrid, him, hisGrid, myAps);
  restorePlacement(me, myReal);
  restorePlacement(him, hisReal);
  return { his, mine };
}

function calcCoverValue(
  t: TacticalState,
  me: Soldier,
  myGrid: number,
  myThreat: number,
  myAps: number,
  threat: Threat,
  range: number,
): CoverScore {
  const him = threat.opponent;
  const chances = chancesToGetThrough(t, me, myGrid, myAps, him, threat.gridNo);
  let hisPosValue = chances.his * threat.value * threat.aps;
  let myPosValue = chances.mine * myThreat * myAps;
  if (him.ai.oppCount > 1) hisPosValue = idiv(hisPosValue, him.ai.oppCount);
  if (me.ai.oppCount > 1) myPosValue = idiv(myPosValue, me.ai.oppCount);
  if (myPosValue > 0 && myAps < AP.CROUCH) myPosValue -= idiv(myPosValue * (AIM_PENALTY_TARGET_CROUCHED + idiv(range, CELL_X_SIZE)), 100);
  const multiplier = rangeChangeDesire(t, me);
  const rangeChange = threat.origRange - range;
  if (multiplier && rangeChange) {
    const factor = idiv(rangeChange * multiplier, 2);
    myPosValue += idiv(100 * factor * (MAX_DIFFICULTY_LEVEL_PLUS_ONE - soldierDifficultyLevel(t, me)), MAX_DIFFICULTY_LEVEL_PLUS_ONE);
    if (factor > 0) {
      myPosValue = idiv(myPosValue * (100 + factor), 100);
      hisPosValue = idiv(100 * hisPosValue, 100 + factor);
    } else if (factor < 0) {
      myPosValue = idiv(100 * myPosValue, 100 - factor);
      hisPosValue = idiv(hisPosValue * (100 - factor), 100);
    }
  }
  const reduction = idiv((MAX_THREAT_RANGE - range) * threat.certainty, MAX_THREAT_RANGE);
  return {
    value: idiv(idiv(myPosValue - hisPosValue, 100) * reduction, 100),
    scale: idiv(idiv(Math.max(myPosValue, hisPosValue), 100) * reduction, 100),
  };
}

function numberOfTeamMatesAdjacent(t: TacticalState, s: Soldier, g: number): number {
  let count = 0;
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const adjacent = newGridNo(g, DIRECTION_INCREMENT[direction] ?? 0);
    if (adjacent === g) continue;
    const who = whoIsThere(t, adjacent, s.level);
    if (who && who !== s && who.team === s.team) count++;
  }
  return count;
}

function searchSquare(origin: number, range: number): SearchSquare {
  const x = origin % WORLD_COLS;
  const y = Math.trunc(origin / WORLD_ROWS);
  return {
    origin,
    maxLeft: Math.min(range, x),
    maxRight: Math.min(range, WORLD_COLS - (x + 1)),
    maxUp: Math.min(range, y),
    maxDown: Math.min(range, WORLD_ROWS - (y + 1)),
  };
}

function* squareTiles(square: SearchSquare): Generator<SquareTile> {
  for (let dy = -square.maxUp; dy <= square.maxDown; dy++) {
    for (let dx = -square.maxLeft; dx <= square.maxRight; dx++) {
      const g = square.origin + dx + WORLD_COLS * dy;
      if (g < 0 || g >= WORLD_MAX) continue;
      yield { g, dx, dy };
    }
  }
}

function pathMoveMode(t: TacticalState, movementMode: number): MoveMode {
  switch (stateName(t.content, movementMode)) {
    case 'RUNNING':
    case 'ADULTMONSTER_WALKING':
      return MoveMode.RUNNING;
    case 'SWATTING':
      return MoveMode.SWATTING;
    case 'CRAWLING':
      return MoveMode.CRAWLING;
    default:
      return MoveMode.WALKING;
  }
}

export function reachabilityFlood(
  t: TacticalState,
  s: Soldier,
  movementMode: number,
  copy: number,
  distLimit: number,
  budget: number,
  includeOwnTile = false,
): Flood {
  const env: PathEnv = { ...t.pathEnv, minAPsToStartMovement: () => minAPsToStartMovement(t.content, s, movementMode) };
  const result = findBestPath(env, s, NOWHERE, s.level, {
    mode: pathMoveMode(t, movementMode),
    copy,
    distLimit: u8(distLimit),
    budget: u8(budget),
  });
  const reachable = result.reachable ?? new Uint8Array(WORLD_MAX);
  if (!includeOwnTile) reachable[s.gridNo] = 0;
  return { reachable, apCosts: result.apCosts ?? null };
}

function opponentThreat(t: TacticalState, s: Soldier, opp: Soldier, maxThreatRange: number): Threat | null {
  if (!isKnowableOpponent(s, opp)) return null;
  const known = opponentKnowledge(t, s, opp);
  if (isUnknown(known) || ignoredByBountyHunter(s, opp)) return null;
  const gridNo = bestGuessLocation(t, s, opp, known);
  const certainty = threatPercent(mostRecentOpplistValue(known));
  const origRange = rangeInUnits(s.gridNo, gridNo);
  if (origRange > maxThreatRange) return null;
  const value = calcManThreatValue(t, opp, s.gridNo, false, s);
  if (value === NO_THREAT) return null;
  return { opponent: opp, gridNo, value, certainty, origRange, aps: calcActionPoints(t.content, opp) };
}

function coverThreats(t: TacticalState, s: Soldier, maxThreatRange: number): Threat[] {
  const threats: Threat[] = [];
  for (const opp of mercs(t)) {
    const threat = opponentThreat(t, s, opp, maxThreatRange);
    if (threat) threats.push(threat);
  }
  return threats;
}

function coverSearchRange(t: TacticalState, s: Soldier): number {
  let range = DIFF_MAX_COVER_RANGE[soldierDifficultyLevel(t, s)] ?? 0;
  range = Math.min(range, idiv(s.stats.wisdom, 8));
  if (!t.inCombat) range = idiv(range, 2);
  if (s.ai.alertStatus >= AlertStatus.RED) {
    const movementMode = determineMovementMode(t, s, AiAction.TAKE_COVER);
    const tilesLeft = Math.max(0, s.actionPoints - minAPsToStartMovement(t.content, s, movementMode));
    if (tilesLeft < range) range = tilesLeft;
  }
  return range;
}

function coverAt(t: TacticalState, s: Soldier, g: number, myThreat: number, myAps: number, threats: readonly Threat[]): CoverScore {
  let value = 0;
  let scale = 0;
  for (const threat of threats) {
    const range = rangeInUnits(g, threat.gridNo);
    if (range > MAX_THREAT_RANGE) continue;
    const score = calcCoverValue(t, s, g, myThreat, myAps, threat, range);
    value += score.value;
    scale += score.scale;
  }
  return { value, scale };
}

function crowdedCover(value: number, mates: number): number {
  return value >= 0 ? value - idiv(value, 10) * mates : value + idiv(value, 10) * mates;
}

function distanceFromOrigin(s: Soldier, roam: number, origin: number): number {
  if (s.ai.alertStatus !== AlertStatus.BLACK && roam < MAX_ROAMING_RANGE && origin !== NOWHERE) return spacesAway(origin, s.gridNo);
  return NO_ROAM_LIMIT;
}

export function findBestNearbyCover(t: TacticalState, s: Soldier, _morale: number): CoverChoice {
  const range = coverSearchRange(t, s);
  if (range <= 0) return NO_COVER;
  const myThreat = calcManThreatValue(t, s, NOWHERE, false, s);
  const threats = coverThreats(t, s, MAX_THREAT_RANGE + CELL_X_SIZE * range);
  if (threats.length === 0) return NO_COVER;
  const current = coverAt(t, s, s.gridNo, myThreat, s.actionPoints, threats);
  const currentValue = current.value - idiv(current.value, 10) * numberOfTeamMatesAdjacent(t, s, s.gridNo);
  const square = searchSquare(s.gridNo, range);
  const { range: roam, origin } = roamingRange(s);
  const fromOrigin = distanceFromOrigin(s, roam, origin);
  const budget = s.ai.alertStatus >= AlertStatus.RED ? s.actionPoints : calcActionPoints(t.content, s);
  const flood = reachabilityFlood(t, s, determineMovementMode(t, s, AiAction.TAKE_COVER), PathCopy.REACHABLE_AND_APS, range, budget);
  let bestValue = currentValue;
  let bestScale = 0;
  let bestTile = NOWHERE;
  for (const { g, dx, dy } of squareTiles(square)) {
    if (fromOrigin !== NO_ROAM_LIMIT) {
      const coverFromOrigin = spacesAway(origin, g);
      if (coverFromOrigin > roam && fromOrigin <= coverFromOrigin) continue;
    }
    if (!flood.reachable[g] || inGas(t, s, g) || g === s.ai.blackList) continue;
    const pathCost = flood.apCosts?.[aiPathCostIndex(dx, dy)] ?? 0;
    const cover = coverAt(t, s, g, myThreat, s.actionPoints - pathCost, threats);
    const value = crowdedCover(cover.value, numberOfTeamMatesAdjacent(t, s, g));
    if (value > bestValue) {
      bestValue = value;
      bestScale = cover.scale;
      bestTile = g;
    }
  }
  if (bestTile === NOWHERE) return NO_COVER;
  const percentBetter = calcPercentBetter(currentValue, bestValue, current.scale, bestScale);
  return { gridNo: percentBetter >= MIN_PERCENT_BETTER ? bestTile : NOWHERE, percentBetter };
}

function edgeOfMapDirection(t: TacticalState, g: number): number {
  for (let direction = Direction.NORTHEAST; direction < DIRECTION_COUNT; direction += 2) {
    if (t.world.costs.get(g + (DIRECTION_INCREMENT[direction] ?? 0), direction, 0) === TravelCost.OFF_MAP) return direction;
  }
  return NO_ESCAPE;
}

export function traversalQuoteActionID(direction: number): number {
  switch (direction) {
    case Direction.NORTHEAST:
      return QuoteAction.TRAVERSE_EAST;
    case Direction.SOUTHEAST:
      return QuoteAction.TRAVERSE_SOUTH;
    case Direction.SOUTHWEST:
      return QuoteAction.TRAVERSE_WEST;
    case Direction.NORTHWEST:
      return QuoteAction.TRAVERSE_NORTH;
    default:
      return QuoteAction.NONE;
  }
}

function fleeThreatLocations(t: TacticalState, s: Soldier): number[] {
  const locations: number[] = [];
  for (const opp of mercs(t)) {
    if (!isKnowableOpponent(s, opp)) continue;
    const known = opponentKnowledge(t, s, opp);
    if (isUnknown(known) || ignoredByBountyHunter(s, opp)) continue;
    if (calcManThreatValue(t, opp, s.gridNo, false, s) === NO_THREAT) continue;
    locations.push(bestGuessLocation(t, s, opp, known));
  }
  return locations;
}

function closestThreatRange(g: number, locations: readonly number[]): number {
  let closest = FAR_AWAY;
  for (const location of locations) closest = Math.min(closest, rangeInUnits(g, location));
  return closest;
}

function fleeSearch(t: TacticalState, s: Soldier): { readonly range: number; readonly budget: number } {
  let range: number;
  let budget: number;
  if (s.ai.alertStatus === AlertStatus.BLACK) {
    range = idiv(s.actionPoints, 2);
    budget = u8(s.actionPoints);
  } else {
    budget = u8(Math.min(idiv(s.actionPoints, 2), calcActionPoints(t.content, s)));
    range = idiv(budget, 2);
  }
  if (!t.inCombat && range > FLEE_RT_HALVING_THRESHOLD) {
    range = idiv(range, 2);
    budget = idiv(budget, 2);
  }
  return { range, budget: clamp(budget - apsToChangeStance(t.content, s, AnimHeight.STAND), 0, 255) };
}

export function findFleeSpot(t: TacticalState, s: Soldier): FleeSpot {
  const threats = fleeThreatLocations(t, s);
  if (threats.length === 0) return NO_FLEE_SPOT;
  let closest = closestThreatRange(s.gridNo, threats);
  let roam = FLEE_ROAM_RANGE;
  let origin = s.gridNo;
  if (s.team === Team.CIV) {
    ({ range: roam, origin } = roamingRange(s));
    if (roam === 0) return NO_FLEE_SPOT;
  }
  const { range, budget } = fleeSearch(t, s);
  const square = searchSquare(s.gridNo, range);
  const flood = reachabilityFlood(t, s, determineMovementMode(t, s, AiAction.RUN_AWAY), PathCopy.REACHABLE, range, budget);
  let best = NOWHERE;
  let bestEscape = NO_ESCAPE;
  for (const { g } of squareTiles(square)) {
    if (!flood.reachable[g] || g === s.ai.blackList || inGas(t, s, g)) continue;
    if (s.team === Team.CIV && pythSpacesAway(origin, g) > roam) continue;
    const escapeDirection = s.team === Team.ENEMY ? edgeOfMapDirection(t, g) : NO_ESCAPE;
    const value = escapeDirection !== NO_ESCAPE ? FAR_AWAY - pythSpacesAway(s.gridNo, g) : closestThreatRange(g, threats);
    if (value > closest) {
      closest = value;
      best = g;
      bestEscape = escapeDirection;
    }
  }
  return { gridNo: best, traversalQuoteAction: traversalQuoteActionID(bestEscape) };
}

export function findSpotMaxDistFromOpponents(t: TacticalState, s: Soldier): number {
  return findFleeSpot(t, s).gridNo;
}

export function findNearestUngassedLand(t: TacticalState, s: Soldier): number {
  const walking = states(t.content.animations).WALKING;
  let closestLand = NOWHERE;
  let shortestPath = SHORTEST_PATH_START;
  for (let range = UNGASSED_SEARCH_STEP; range <= UNGASSED_SEARCH_MAX; range += UNGASSED_SEARCH_STEP) {
    const square = searchSquare(s.gridNo, range);
    const flood = reachabilityFlood(t, s, determineMovementMode(t, s, AiAction.LEAVE_WATER_GAS), PathCopy.REACHABLE, range, 0);
    for (const { g } of squareTiles(square)) {
      if (!flood.reachable[g] || g === s.ai.blackList) continue;
      if (!legalNPCDestination(t, s, g, PathMode.IGNORE_PATH, false, 0)) continue;
      const pathCost = i16(plotPathCost(t, s, g, walking));
      if (!pathCost) continue;
      if (pathCost < shortestPath) {
        shortestPath = pathCost;
        closestLand = g;
      }
    }
    if (closestLand !== NOWHERE) break;
  }
  return closestLand;
}
