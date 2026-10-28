// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc SoldierOKForSectorExit, PickGridNoNearestEdge, AdjustSoldierPathToGoOffEdge,
// @src PickGridNoToWalkIn, SetupTacticalTraversalInformation (mirror gridno);
// @src TileEngine/Exit_Grids.cc FindGridNoFromSweetSpotCloseToExitGrid; Tactical/Overhead.cc
// @src SetActionToDoOnceMercsGetToLocation, ExecuteOverhead (wait actions and the 2500 ms timer).

import {
  CELL_X_SIZE,
  CELL_Y_SIZE,
  DIRECTION_INCREMENT,
  Direction,
  newGridNo,
  outOfBounds,
  WORLD_COLS,
  WORLD_MAX,
} from '../../content/world/grid.ts';
import {
  absoluteScreenXY,
  mapPosFromAbsoluteScreenXY,
  renderedScreenSize,
  restrictedScrollIdOf,
} from '../../content/world/render-bounds.ts';
import { i16, u8 } from '../../core/int.ts';
import { plotPathCost } from './ai/utils.ts';
import { soldierGotoStationaryStance } from './animation.ts';
import { rangeInCellCoords } from './insertion.ts';
import { moveStateBasedOnStance } from './movement-mode.ts';
import { findBestPath, MAX_PATH_LIST_SIZE, NOWHERE, newOKDestination, PathCopy, PathFlags } from './pathfinding.ts';
import { enoughPoints } from './points.ts';
import { removeSoldierFromTacticalSector } from './sector-presence.ts';
import { type Soldier, Team } from './soldier.ts';
import { mercs, onVisibleWorldTile, sectorMapOf, type TacticalState, WaitForMercs } from './state.ts';

export const ExitDirection = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3, EXIT_GRID: -1 } as const;
export const DIRECTION_EXITGRID = 255;

const CHECK_DIR_X_DELTA = 160;
const CHECK_DIR_Y_DELTA = 200;
const WAIT_TIMEOUT_MS = 2500;
const MAX_ADJUSTED_DISTANCE = 255;
const MAX_WALK_IN_ATTEMPTS = 200;
const EXIT_SWEET_SPOT_RADIUS = 10;
const MIRROR_NORTH_Y = 1520;
const MIRROR_SOUTH_Y = 0;
const MIRROR_EAST_X = 0;
const MIRROR_WEST_X = 3160;
const OFF_EDGE_STEPS = 2;
const RESERVED_TAIL = 4;

export function exitGridAt(
  t: TacticalState,
  g: number,
): { readonly gridNo: number; readonly sector: { x: number; y: number; z: number } } | null {
  if (!t.world.exitGrids.has(g)) return null;
  const e = sectorMapOf(t).exitGrids.find((x) => x.mapIndex === g) ?? t.addedExitGrids.find((x) => x.mapIndex === g);
  return e ? { gridNo: e.gridNo, sector: { ...e.sector } } : null;
}

const sameSector = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x === b.x && a.y === b.y && a.z === b.z;

function exitGridProbe(s: Soldier) {
  return {
    id: s.id,
    team: Team.ENEMY,
    bodyType: 0,
    gridNo: s.gridNo,
    level: 0,
    visible: s.visible,
    hasKeys: s.hasKeys,
    underAiControl: s.underAiControl,
    monsterOrAnimal: s.monsterOrAnimal,
    multiTile: false,
  };
}

export function findGridNoFromSweetSpotCloseToExitGrid(t: TacticalState, s: Soldier, sweet: number, radius: number): number {
  const target = exitGridAt(t, sweet);
  if (!target) return NOWHERE;
  const probe = s.multiTile ? { ...s, team: Team.ENEMY, level: 0, bodyType: 0 } : exitGridProbe(s);
  const flood = findBestPath(t.pathEnv, probe, NOWHERE, 0, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.THROUGH_PEOPLE,
    distLimit: radius,
    plotToExitGrid: true,
  });
  const reachable = flood.reachable;
  if (!reachable) return NOWHERE;
  let lowest = NOWHERE;
  let lowestRange = 999999;
  for (let dy = -radius; dy <= radius; dy++) {
    const leftmost = Math.trunc((s.gridNo + WORLD_COLS * dy) / WORLD_COLS) * WORLD_COLS;
    for (let dx = -radius; dx <= radius; dx++) {
      const g = s.gridNo + WORLD_COLS * dy + dx;
      if (g < 0 || g >= WORLD_MAX || g < leftmost || g >= leftmost + WORLD_COLS || !reachable[g]) continue;
      if (!newOKDestination(t.pathEnv, s, g, true, s.level, true)) continue;
      const exit = exitGridAt(t, g);
      if (!exit || !sameSector(exit.sector, target.sector)) continue;
      const range = rangeInCellCoords(s.gridNo, g);
      if (range < lowestRange) {
        lowest = g;
        lowestRange = range;
      }
    }
  }
  return lowest;
}

export function soldierOKForSectorExit(t: TacticalState, s: Soldier, exitDirection: number, exitGridNo: number): boolean {
  if (!s.placed || s.gridNo === NOWHERE) return false;
  if (s.level > 0) return false;
  const restriction = restrictedScrollIdOf(t.world);
  const size = renderedScreenSize(restriction);
  const { x, y } = absoluteScreenXY(restriction, s.gridNo);
  switch (exitDirection) {
    case ExitDirection.EAST:
      return x >= size.width - CHECK_DIR_X_DELTA;
    case ExitDirection.WEST:
      return x <= CHECK_DIR_X_DELTA;
    case ExitDirection.SOUTH:
      return y >= size.height - CHECK_DIR_Y_DELTA;
    case ExitDirection.NORTH:
      return y <= CHECK_DIR_Y_DELTA;
    default: {
      if (!t.inCombat) s.uiMovementMode = moveStateBasedOnStance(t.content, s);
      const g = findGridNoFromSweetSpotCloseToExitGrid(t, s, exitGridNo, EXIT_SWEET_SPOT_RADIUS);
      if (g === NOWHERE) return false;
      if (t.inCombat && !enoughPoints(t.inCombat, s, plotPathCost(t, s, g, s.uiMovementMode))) return false;
      return true;
    }
  }
}

interface EdgeWalk {
  readonly toEdge: number;
  readonly altToEdge: number;
  readonly along: number;
  readonly altAlong: number;
}

const inc = (d: number) => DIRECTION_INCREMENT[d] ?? 0;

function nearestEdgeWalk(tacticalDirection: number): EdgeWalk {
  switch (tacticalDirection) {
    case Direction.WEST:
      return {
        toEdge: inc(Direction.SOUTH),
        altToEdge: inc(Direction.WEST),
        along: inc(Direction.NORTHWEST),
        altAlong: inc(Direction.SOUTHEAST),
      };
    case Direction.NORTH:
      return {
        toEdge: inc(Direction.NORTH),
        altToEdge: inc(Direction.WEST),
        along: inc(Direction.SOUTHWEST),
        altAlong: inc(Direction.NORTHEAST),
      };
    case Direction.SOUTH:
      return {
        toEdge: inc(Direction.SOUTH),
        altToEdge: inc(Direction.EAST),
        along: inc(Direction.SOUTHEAST),
        altAlong: inc(Direction.NORTHEAST),
      };
    default:
      return {
        toEdge: inc(Direction.NORTH),
        altToEdge: inc(Direction.EAST),
        along: inc(Direction.NORTHWEST),
        altAlong: inc(Direction.SOUTHEAST),
      };
  }
}

function lastVisibleTileToward(t: TacticalState, from: number, first: number, second: number): number {
  let g = from;
  let old = from;
  let toggle = true;
  while (onVisibleWorldTile(t, g)) {
    old = g;
    g += toggle ? first : second;
    toggle = !toggle;
  }
  return old;
}

function reachableDestination(t: TacticalState, s: Soldier, g: number): boolean {
  return (
    newOKDestination(t.pathEnv, s, g, true, s.level) &&
    findBestPath(t.pathEnv, s, g, s.level, { flags: PathFlags.THROUGH_PEOPLE }).length > 0
  );
}

export function pickGridNoNearestEdge(t: TacticalState, s: Soldier, tacticalDirection: number): number {
  const walk = nearestEdgeWalk(tacticalDirection);
  const start = lastVisibleTileToward(t, s.gridNo, walk.toEdge, walk.altToEdge);
  let g = start;
  let toggle = true;
  let adjusted = 0;
  do {
    if (g > 0 && g < WORLD_MAX && reachableDestination(t, s, g)) return g;
    g = start;
    if (toggle) {
      adjusted++;
      for (let n = 0; n < adjusted; n++) g = i16(g + walk.along);
    } else for (let n = 0; n < adjusted; n++) g = i16(g + walk.altAlong);
    toggle = !toggle;
  } while (adjusted !== MAX_ADJUSTED_DISTANCE);
  return NOWHERE;
}

const OFF_EDGE_DIRECTION: Readonly<Record<number, number>> = {
  [Direction.EAST]: Direction.NORTHEAST,
  [Direction.WEST]: Direction.SOUTHWEST,
  [Direction.NORTH]: Direction.NORTHWEST,
  [Direction.SOUTH]: Direction.SOUTHEAST,
};

export function adjustSoldierPathToGoOffEdge(s: Soldier, endGridNo: number, tacticalDirection: number): void {
  if (s.pathSize + OFF_EDGE_STEPS > MAX_PATH_LIST_SIZE) {
    let g = s.gridNo;
    for (let i = 0; i < s.pathSize; i++) g += inc(s.path[i] ?? 0);
    if (g === endGridNo) s.pathSize -= RESERVED_TAIL;
    return;
  }
  const direction = OFF_EDGE_DIRECTION[tacticalDirection];
  if (direction === undefined) return;
  let from = endGridNo;
  for (let step = 0; step < OFF_EDGE_STEPS; step++) {
    const next = newGridNo(from, inc(direction));
    if (outOfBounds(from, next)) return;
    s.path[s.pathSize] = direction;
    s.pathSize++;
    s.finalDestination = next;
    s.ai.actionData = next;
    from = next;
  }
}

interface WalkInPattern {
  readonly first: number;
  readonly second: number;
  readonly along: number;
  readonly altAlong: number;
}

const WALK_IN: Readonly<Record<number, WalkInPattern>> = {
  3: { first: WORLD_COLS, second: -1, along: -WORLD_COLS - 1, altAlong: WORLD_COLS + 1 },
  2: { first: -WORLD_COLS, second: 1, along: -WORLD_COLS - 1, altAlong: WORLD_COLS + 1 },
  0: { first: -WORLD_COLS, second: -1, along: -WORLD_COLS + 1, altAlong: WORLD_COLS - 1 },
  1: { first: WORLD_COLS, second: 1, along: -WORLD_COLS + 1, altAlong: WORLD_COLS - 1 },
};

export function pickGridNoToWalkIn(
  t: TacticalState,
  s: Soldier,
  insertionCode: number,
): { readonly gridNo: number; readonly attempts: number } {
  const pattern = WALK_IN[insertionCode];
  if (!pattern) return { gridNo: NOWHERE, attempts: 0 };
  const start = lastVisibleTileToward(t, s.gridNo, pattern.first, pattern.second);
  let g = start;
  let toggle = true;
  let adjusted = 0;
  let attempts = 0;
  while (attempts < MAX_WALK_IN_ATTEMPTS) {
    attempts++;
    if (t.ignoreAllObstacles || reachableDestination(t, s, g)) return { gridNo: g, attempts };
    g = start;
    if (toggle) {
      adjusted = u8(adjusted + 1);
      for (let n = 0; n < adjusted; n++) g = i16(g + pattern.along);
    } else for (let n = 0; n < adjusted; n++) g = i16(g + pattern.altAlong);
    toggle = !toggle;
  }
  return { gridNo: NOWHERE, attempts };
}

export function mirrorGridNo(t: TacticalState, s: Soldier, tacticalDirection: number): number {
  const restriction = restrictedScrollIdOf(t.world);
  const g = Math.trunc(Math.trunc(s.y) / CELL_Y_SIZE) * WORLD_COLS + Math.trunc(Math.trunc(s.x) / CELL_X_SIZE);
  let { x, y } = absoluteScreenXY(restriction, g);
  if (tacticalDirection === Direction.NORTH) y = MIRROR_NORTH_Y;
  else if (tacticalDirection === Direction.SOUTH) y = MIRROR_SOUTH_Y;
  else if (tacticalDirection === Direction.EAST) x = MIRROR_EAST_X;
  else if (tacticalDirection === Direction.WEST) x = MIRROR_WEST_X;
  return mapPosFromAbsoluteScreenXY(restriction, x, y);
}

export function setActionToDoOnceMercsGetToLocation(t: TacticalState, code: number, waiting: number): void {
  t.mercsWaiting = { code, remaining: waiting, sinceMs: t.clockMs };
  t.perception.disallowSight = true;
}

export function handleWaitActionOnArrival(t: TacticalState, s: Soldier): boolean {
  if (!s.waitActionToDo) return false;
  const code = t.mercsWaiting?.code ?? WaitForMercs.NONE;
  if (s.waitActionToDo === 2) {
    s.waitActionToDo = 1;
    if (code === WaitForMercs.WALKOFF_SCREEN) {
      s.pathIndex = -1;
      adjustSoldierPathToGoOffEdge(s, s.gridNo, s.pendingActionData1);
    }
    return true;
  }
  s.waitActionToDo = 0;
  if (t.mercsWaiting) t.mercsWaiting.remaining--;
  soldierGotoStationaryStance(t, s);
  if (code === WaitForMercs.WALK_TO_GRIDNO) removeSoldierFromTacticalSector(t, s);
  return true;
}

export function checkMercsWaiting(t: TacticalState): void {
  const waiting = t.mercsWaiting;
  if (!waiting) return;
  if (t.clockMs - waiting.sinceMs > WAIT_TIMEOUT_MS) {
    waiting.remaining = 0;
    for (const s of mercs(t)) s.waitActionToDo = 0;
  }
  if (waiting.remaining !== 0) return;
  t.perception.disallowSight = false;
  t.ignoreAllObstacles = false;
  t.mercsWaiting = null;
  t.sectorHooks.mercsWaitOver(t, waiting.code);
}
