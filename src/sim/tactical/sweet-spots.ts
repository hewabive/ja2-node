// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Add.cc FindGridNoFromSweetSpot, FindGridNoFromSweetSpotThroughPeople,
// @src FindGridNoFromSweetSpotWithStructData, FindGridNoFromSweetSpotWithStructDataFromSoldier (the bump's variant),
// @src FindGridNoFromSweetSpotExcludingSweetSpot; Tactical/PathAI.h SaveNPCBudgetAndDistLimit (the dummy soldier's
// @src flood); TileEngine/GridSquare.cc GridSquare.

import { cardinalSpacesAway, DIRECTION_COUNT, gridSquare, pythSpacesAway, rangeInCellCoords } from '../../content/world/grid.ts';
import { states } from './animation.ts';
import { pathMoveMode } from './movement-mode.ts';
import { findBestPath, NOWHERE, newOKDestination, PathCopy, PathFlags, type PathSoldier } from './pathfinding.ts';
import { animStructureDef } from './person-structure.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

const NO_RANGE = 999999;
const DUMMY_SOLDIER_ID = 0;
const SWEET_SPOT_FLOOD_FLAGS = PathFlags.IGNORE_PERSON_AT_DEST | PathFlags.THROUGH_PEOPLE;

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

export function dummySoldier(sweet: number, team: number, level: number): PathSoldier {
  return {
    id: DUMMY_SOLDIER_ID,
    team,
    bodyType: Body.REGMALE,
    gridNo: sweet,
    level,
    visible: 0,
    hasKeys: false,
    underAiControl: false,
    monsterOrAnimal: false,
  };
}

export interface FloodOptions {
  readonly flags: number;
  readonly circular?: boolean;
}

export function reachableAround(t: TacticalState, dummy: PathSoldier, radius: number, options: FloodOptions): number[] {
  const flood = findBestPath(t.pathEnv, dummy, NOWHERE, dummy.level, {
    copy: PathCopy.REACHABLE,
    flags: options.flags,
    distLimit: radius,
    circular: options.circular ?? false,
  });
  return gridSquare(dummy.gridNo, radius).filter((g) => flood.reachable?.[g]);
}

function lowestRanked(candidates: readonly number[], rangeOf: (g: number) => number | null): number {
  let lowest = NOWHERE;
  let lowestRange = NO_RANGE;
  for (const g of candidates) {
    const range = rangeOf(g);
    if (range !== null && range < lowestRange) {
      lowest = g;
      lowestRange = range;
    }
  }
  return lowest;
}

function freeFor(t: TacticalState, s: Soldier, g: number): boolean {
  return newOKDestination(t.pathEnv, s, g, true, s.level);
}

export function findGridNoFromSweetSpot(t: TacticalState, s: Soldier, sweet: number, radius: number): number {
  const reachable = reachableAround(t, dummySoldier(sweet, Team.ENEMY, s.level), radius, { flags: SWEET_SPOT_FLOOD_FLAGS });
  return lowestRanked(reachable, (g) => (freeFor(t, s, g) ? cardinalSpacesAway(sweet, g) : null));
}

export function findGridNoFromSweetSpotThroughPeople(t: TacticalState, s: Soldier, sweet: number, radius: number): number {
  const reachable = reachableAround(t, dummySoldier(sweet, s.team, 0), radius, { flags: SWEET_SPOT_FLOOD_FLAGS });
  return lowestRanked(reachable, (g) => (freeFor(t, s, g) ? rangeInCellCoords(sweet, g) : null));
}

function firstFittingDirection(t: TacticalState, s: Soldier, animState: number, g: number): number | null {
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const def = animStructureDef(t, s, animState, direction);
    if (!def || t.world.structures.okayToAdd(g, s.level, def, s.id)) return direction;
  }
  return null;
}

function structureFitsSomeDirection(t: TacticalState, s: Soldier, animState: number, g: number): boolean {
  return firstFittingDirection(t, s, animState, g) !== null;
}

function pathLength(t: TacticalState, s: Soldier, g: number): number {
  return findBestPath(t.pathEnv, s, g, s.level, { mode: pathMoveMode(t.content, s.uiMovementMode) }).length;
}

export interface StructDataSearch {
  readonly animState: number;
  readonly closestToMerc: boolean;
  readonly circular?: boolean;
}

export interface SweetSpot {
  readonly gridNo: number;
  readonly direction: number;
}

export function findSweetSpotWithStructData(
  t: TacticalState,
  s: Soldier,
  sweet: number,
  radius: number,
  search: StructDataSearch,
): SweetSpot | null {
  if (s.gridNo === sweet && !isVehicle(s)) return { gridNo: sweet, direction: s.direction };
  const flood = { flags: SWEET_SPOT_FLOOD_FLAGS, circular: search.circular ?? false };
  const reachable = reachableAround(t, dummySoldier(sweet, Team.ENEMY, 0), radius, flood);
  const gridNo = lowestRanked(reachable, (g) => {
    if (!freeFor(t, s, g) || !structureFitsSomeDirection(t, s, search.animState, g)) return null;
    if (!search.closestToMerc) return rangeInCellCoords(sweet, g);
    const steps = pathLength(t, s, g);
    return steps === 0 ? null : steps;
  });
  const direction = gridNo === NOWHERE ? null : firstFittingDirection(t, s, search.animState, gridNo);
  return direction === null ? null : { gridNo, direction };
}

export function findGridNoFromSweetSpotWithStructData(
  t: TacticalState,
  s: Soldier,
  sweet: number,
  radius: number,
  search: StructDataSearch,
): number {
  return findSweetSpotWithStructData(t, s, sweet, radius, search)?.gridNo ?? NOWHERE;
}

export function findGridNoFromSweetSpotNearSoldier(t: TacticalState, s: Soldier, radius: number): number {
  const sweet = s.gridNo;
  const standing = states(t.content.animations).STANDING;
  const reachable = reachableAround(t, dummySoldier(sweet, Team.ENEMY, 0), radius, { flags: SWEET_SPOT_FLOOD_FLAGS });
  let lowest = NOWHERE;
  let lowestRange = NO_RANGE;
  for (const g of reachable) {
    if (!freeFor(t, s, g) || !structureFitsSomeDirection(t, s, standing, g)) continue;
    const range = rangeInCellCoords(s.gridNo, g);
    if (range < lowestRange || (range === lowestRange && pythSpacesAway(s.gridNo, g) < pythSpacesAway(s.gridNo, lowest))) {
      lowest = g;
      lowestRange = range;
    }
  }
  return lowest;
}

export function findGridNoFromSweetSpotExcludingSweetSpot(t: TacticalState, s: Soldier, sweet: number, radius: number): number {
  return lowestRanked(gridSquare(sweet, radius), (g) => (g !== sweet && freeFor(t, s, g) ? rangeInCellCoords(sweet, g) : null));
}
