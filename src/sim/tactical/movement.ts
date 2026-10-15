// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc EVENT_InternalGetNewSoldierPath, EVENT_InternalSetSoldierDestination, MoveMerc,
// @src EVENT_SetSoldierPosition(XY), SetSoldierGridNo, EVENT_StopMerc; Overhead.cc HandleGotoNewGridNo, HandleAtNewGridNo;
// @src Soldier_Tile.cc TileIsClear, HandleNextTile, HandleNextTileWaiting, SetDelayedTileWaiting, (Un)MarkMovementReserved;
// @src Structure_Wrap.cc IsJumpableFencePresentAtGridno. See docs/07 §4.

import { AnimFlags } from '../../content/anim/tables.ts';
import { isVisibleTile, newGridNo, pythSpacesAway, WORLD_COLS } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { has, StructureFlags, structureHeight } from '../../content/world/structures.ts';
import {
  adjustNoAPToFinishMove,
  beginSoldierClimbFence,
  hasAnimFlag,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierAniSpeed,
  setSoldierDirection,
  soldierGotoStationaryStance,
  states,
} from './animation.ts';
import { MOVE_SIN_COS } from './constants.ts';
import { DIRECTION_INCREMENT } from './directions.ts';
import { findBestPath, isWater, MAX_PATH_LIST_SIZE, newOKDestination, PathCopy, PathFlags } from './pathfinding.ts';
import { deductBreath, doorTravelCost, type PointsContext, terrainBreathPoints } from './points.ts';
import { cellCentre, NOWHERE, OKBREATH, Orders, type Soldier, Team } from './soldier.ts';
import { placeOccupant, removeOccupant, type TacticalState, whoIsThere } from './state.ts';

export const MoveTile = { CLEAR: 0, TEMP_BLOCKED: -1, STATIONARY_BLOCKED: -2 } as const;
type MoveTileResult = (typeof MoveTile)[keyof typeof MoveTile];

const NEXT_TILE_CHECK_DELAY = 700;
const DELAYED_MOVEMENT_FLAG_PATH_THROUGH_PEOPLE = 0x01;
const MATERIAL_SANDBAG = 18;

export interface GotoResult {
  readonly ok: boolean;
  readonly keepMoving: boolean;
}

export interface PositionOptions {
  readonly keepDestination?: boolean;
  readonly keepFinalDestination?: boolean;
}

function pointsContext(t: TacticalState): PointsContext {
  return { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
}

function step(direction: number): number {
  return DIRECTION_INCREMENT[direction > 7 ? 1 : direction] ?? 0;
}

export function isJumpableFenceAt(t: TacticalState, g: number): boolean {
  const s = t.world.structures.find(g, StructureFlags.OBSTACLE);
  if (!s) return false;
  if (has(s.flags, StructureFlags.FENCE) && !has(s.flags, StructureFlags.SPECIAL)) return true;
  return s.def.armour === MATERIAL_SANDBAG && structureHeight(s) < 2;
}

export function worldIndexFromCoords(x: number, y: number): number {
  return Math.trunc(Math.fround(y / 10)) * WORLD_COLS + Math.trunc(Math.fround(x / 10));
}

function unmarkMovementReserved(t: TacticalState, s: Soldier): void {
  const here = worldIndexFromCoords(s.x, s.y);
  if (s.state === states(t.content.animations).HOPFENCE && s.reservedGridNo !== here) return;
  if (s.reservedGridNo !== NOWHERE) {
    t.reserved[s.reservedGridNo] = -1;
    s.reservedGridNo = NOWHERE;
  }
}

function markMovementReserved(t: TacticalState, s: Soldier, g: number): void {
  if (s.reservedGridNo !== NOWHERE) unmarkMovementReserved(t, s);
  t.reserved[g] = s.id;
  s.reservedGridNo = g;
}

function setSoldierGridNo(t: TacticalState, s: Soldier, requested: number): void {
  let g = requested;
  if (g === s.gridNo && s.placed) return;
  if (isMovingState(t, s.state)) {
    if (g !== s.destination) g = s.destination;
    if (g === s.gridNo) return;
  }
  s.oldGridNo = s.gridNo;
  if (s.placed) removeOccupant(t, s);
  s.gridNo = g;
  s.placed = false;
  if (!isVisibleTile(g)) return;
  unmarkMovementReserved(t, s);
  if (s.ai.patrolGrid.length === 0) s.ai.patrolGrid[0] = g;
  placeOccupant(t, s);
  s.placed = true;
  s.overTerrain = t.world.terrain[g] ?? 0;
  if (isWater(t.pathWorld, g)) s.uiMovementMode = states(t.content.animations).WALKING;
  setSoldierAniSpeed(t, s);
}

function isMovingState(t: TacticalState, state: number): boolean {
  return hasAnimFlag(t.content, state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE);
}

export function setSoldierPositionXY(t: TacticalState, s: Soldier, x: number, y: number, options: PositionOptions = {}): void {
  const g = worldIndexFromCoords(x, y);
  if (!options.keepDestination) s.destination = g;
  if (!options.keepFinalDestination) s.finalDestination = g;
  s.x = x;
  s.y = y;
  setSoldierGridNo(t, s, g);
}

export function setSoldierPosition(t: TacticalState, s: Soldier, g: number, options: PositionOptions = {}): void {
  const centre = cellCentre(g);
  if (!options.keepDestination) s.destination = g;
  if (!options.keepFinalDestination) s.finalDestination = g;
  s.x = Math.fround(centre.x);
  s.y = Math.fround(centre.y);
  setSoldierGridNo(t, s, g);
}

export function stopMerc(t: TacticalState, s: Soldier): void {
  if (!s.delayedMovement) s.pendingAnimation = -1;
  s.endDoorOpenCode = 0;
  s.pathIndex = 0;
  s.pathSize = 0;
  s.delayedMovement = 0;
  s.reverse = false;
  setSoldierPosition(t, s, s.gridNo);
  s.destX = Math.trunc(s.x);
  s.destY = Math.trunc(s.y);
  setSoldierDirection(t, s, s.direction);
  if (hasAnimFlag(t.content, s.state, AnimFlags.MOVING)) soldierGotoStationaryStance(t, s);
  unmarkMovementReserved(t, s);
}

function setFinalTile(t: TacticalState, s: Soldier, givenUp: boolean): void {
  s.finalDestination = s.gridNo;
  if (givenUp && s.team === Team.OUR) t.events.push({ type: 'noPath', soldier: s.id, to: s.finalDestination });
  stopMerc(t, s);
}

export function setDelayedTileWaiting(t: TacticalState, s: Soldier, cause: number, value: number): void {
  s.delayedMovement = value;
  s.delayedMovementCause = cause;
  s.nextTileCheckAt = t.clockMs + NEXT_TILE_CHECK_DELAY;
}

export function setSoldierDestination(t: TacticalState, s: Soldier, direction: number, animState: number): void {
  const g = newGridNo(s.gridNo, step(direction));
  const centre = cellCentre(g);
  s.destination = g;
  s.destX = centre.x;
  s.destY = centre.y;
  s.movementDirection = direction;
  if (!hasAnimFlag(t.content, animState, AnimFlags.SPECIALMOVE)) setDesiredDirection(t, s, direction, animState);
}

function tileIsClear(t: TacticalState, s: Soldier, direction: number, g: number, level: number): MoveTileResult {
  if (g === NOWHERE) return MoveTile.CLEAR;
  const other = whoIsThere(t, g, level);
  if (other && other !== s) {
    if (s.team !== Team.OUR) {
      s.blockedByAnotherMerc = true;
      s.blockedByAnotherMercDirection = direction;
      if (other.finalDestination === other.gridNo) return MoveTile.STATIONARY_BLOCKED;
      if (other.blockedByAnotherMerc && other.blockedByAnotherMercDirection === (direction + 4) % 8) {
        const savedFinal = other.finalDestination;
        other.finalDestination = other.gridNo;
        const around = findBestPath(t.pathEnv, s, s.finalDestination, s.level, { flags: 0 });
        if (around.length > 0) {
          s.pathStored = false;
          getNewSoldierPath(t, s, s.finalDestination, s.uiMovementMode);
          other.finalDestination = savedFinal;
          s.blockedByAnotherMerc = false;
          const first = around.steps[0] ?? 0;
          return tileIsClear(t, s, first, newGridNo(s.gridNo, step(first)), s.level);
        }
        other.blockedByAnotherMerc = false;
        other.finalDestination = savedFinal;
        swapMercPositions(t, s, other);
        getNewSoldierPath(t, s, s.finalDestination, s.uiMovementMode);
        getNewSoldierPath(t, other, other.finalDestination, other.uiMovementMode);
      }
      return MoveTile.TEMP_BLOCKED;
    }
    if (other.delayedMovement >= 105) {
      s.delayedMovement = 150;
      return MoveTile.STATIONARY_BLOCKED;
    }
    return other.gridNo === other.finalDestination ? MoveTile.STATIONARY_BLOCKED : MoveTile.TEMP_BLOCKED;
  }
  const reservedBy = t.reserved[g] ?? -1;
  if (reservedBy !== -1 && reservedBy !== s.id) return MoveTile.TEMP_BLOCKED;
  if (!newOKDestination(t.pathEnv, s, g, false, s.level) && t.world.costs.get(g, direction, s.level) !== TravelCost.FENCE) {
    s.blockedByAnotherMerc = false;
    return MoveTile.STATIONARY_BLOCKED;
  }
  s.blockedByAnotherMerc = false;
  return MoveTile.CLEAR;
}

function swapMercPositions(t: TacticalState, a: Soldier, b: Soldier): void {
  const ga = a.gridNo;
  const gb = b.gridNo;
  removeOccupant(t, a);
  removeOccupant(t, b);
  a.placed = false;
  b.placed = false;
  setSoldierPosition(t, a, gb);
  setSoldierPosition(t, b, ga);
}

export function handleNextTile(t: TacticalState, s: Soldier, direction: number, g: number, finalDest: number): boolean {
  if (!isVisibleTile(g)) return true;
  const blocked = tileIsClear(t, s, direction, g, s.level);
  if (blocked !== MoveTile.CLEAR) {
    if (g === finalDest && (s.team === Team.OUR || s.absoluteFinalDestination === NOWHERE)) {
      setFinalTile(t, s, false);
      return false;
    }
    const savedFinal = s.finalDestination;
    stopMerc(t, s);
    s.finalDestination = savedFinal;
    setDelayedTileWaiting(t, s, g, blocked === MoveTile.STATIONARY_BLOCKED ? 1 : 100);
    return false;
  }
  if (!t.inCombat) markMovementReserved(t, s, g);
  if (isWater(t.pathWorld, g) && s.state === states(t.content.animations).RUNNING)
    initNewSoldierAnim(t, s, states(t.content.animations).WALKING, 0, false);
  return true;
}

export function handleGotoNewGridNo(t: TacticalState, s: Soldier, initial: boolean, animState: number): GotoResult {
  if (s.breath < OKBREATH && (s.breath === 0 || s.collapsed)) {
    s.breathCollapsed = true;
    s.endDoorOpenCode = 0;
    return { ok: false, keepMoving: true };
  }
  const direction = s.path[s.pathIndex] ?? 0;
  const next = newGridNo(s.gridNo, step(direction));
  const cost = t.world.costs.get(next, direction, s.level);
  if (cost === TravelCost.FENCE) {
    const nextDirection = s.path[s.pathIndex + 1] ?? 0;
    const overFence = newGridNo(next, step(nextDirection));
    if (handleNextTile(t, s, nextDirection, overFence, s.finalDestination)) {
      s.pathIndex++;
      soldierGotoStationaryStance(t, s);
      beginSoldierClimbFence(t, s);
      s.continueMoveAfterStanceChange = 2;
    }
    return { ok: false, keepMoving: true };
  }
  const ctx = pointsContext(t);
  if (doorTravelCost(ctx, s, next, cost, s.team === Team.OUR, true) === TravelCost.DOOR) {
    haltForDoor(t, s);
    return { ok: false, keepMoving: false };
  }
  const bp = terrainBreathPoints(ctx, next, direction, animState);
  if (!handleNextTile(t, s, direction, next, s.finalDestination)) {
    s.endDoorOpenCode = 0;
    return { ok: false, keepMoving: true };
  }
  if (s.noAPToFinishMove && !initial) {
    s.endDoorOpenCode = 0;
    return { ok: true, keepMoving: false };
  }
  if (s.pathIndex === s.pathSize && s.pathSize === 0) {
    s.endDoorOpenCode = 0;
    return { ok: true, keepMoving: false };
  }
  deductBreath(s, bp);
  setSoldierDestination(t, s, direction, animState);
  adjustNoAPToFinishMove(s, false);
  return { ok: true, keepMoving: true };
}

function haltForDoor(t: TacticalState, s: Soldier): void {
  t.events.push({ type: 'stopped', soldier: s.id, gridNo: s.gridNo, reason: 'closedDoor' });
  s.endDoorOpenCode = 0;
  const savedFinal = s.finalDestination;
  stopMerc(t, s);
  s.finalDestination = savedFinal;
}

export function getNewSoldierPath(t: TacticalState, s: Soldier, dest: number, mode: number, fromUI = 0, forceRestart = true): boolean {
  let flags = 0;
  const ui = fromUI === 3 ? (s.team === Team.OUR ? 1 : 0) : fromUI;
  s.goodContPath = false;
  if (s.delayedMovement) {
    flags = s.delayedMovementFlags & DELAYED_MOVEMENT_FLAG_PATH_THROUGH_PEOPLE ? PathFlags.THROUGH_PEOPLE : PathFlags.IGNORE_PERSON_AT_DEST;
    s.delayedMovement = 0;
  }
  if ((!t.inCombat && hasAnimFlag(t.content, s.state, AnimFlags.MOVING) && ui === 1) || ui === 2) {
    if (s.collapsed) return false;
    const planner = { ...s, gridNo: s.destination };
    if (findBestPath(t.pathEnv, planner, dest, s.level, { flags }).length === 0) return false;
    const route = findBestPath(t.pathEnv, planner, dest, s.level, { flags, copy: PathCopy.ROUTE });
    s.finalDestination = dest;
    if (route.length === 0) return false;
    s.path = [route.steps[0] ?? 0, ...route.steps.slice(0, MAX_PATH_LIST_SIZE - 1)];
    s.pathIndex = 0;
    s.pathSize = route.length === MAX_PATH_LIST_SIZE ? MAX_PATH_LIST_SIZE : route.length + 1;
    if (s.uiMovementMode !== s.state) {
      s.dontUpdateNewGridNoOnMoveAnimChange = 1;
      initNewSoldierAnim(t, s, s.uiMovementMode, 0, false);
    }
    return true;
  }
  if (!s.pathStored) {
    const route = findBestPath(t.pathEnv, s, dest, s.level, { flags, copy: PathCopy.ROUTE });
    if (route.length === 0) return false;
    s.path = [...route.steps];
    s.pathIndex = 0;
    s.pathSize = route.length;
  }
  s.finalDestination = dest;
  s.pastX = false;
  s.pastY = false;
  initNewSoldierAnim(t, s, mode, 0, forceRestart);
  return true;
}

export function moveMerc(t: TacticalState, s: Soldier, speed: number, direction: number): void {
  const [sin, cos] = MOVE_SIN_COS[direction] ?? [0, 0];
  let x = Math.fround(s.x + Math.fround(speed * sin));
  const eastward = direction === 1 || direction === 2 || direction === 3;
  const westward = direction === 5 || direction === 6 || direction === 7;
  if (eastward ? x >= s.destX : westward ? x <= s.destX : true) {
    s.pastX = true;
    if (s.gridNo === s.finalDestination) x = Math.fround(s.destX);
  }
  let y = Math.fround(s.y + Math.fround(speed * cos));
  const northward = direction === 0 || direction === 1 || direction === 7;
  const southward = direction === 3 || direction === 4 || direction === 5;
  if (northward ? y <= s.destY : southward ? y >= s.destY : true) {
    s.pastY = true;
    if (s.gridNo === s.finalDestination) y = Math.fround(s.destY);
  }
  setSoldierPositionXY(t, s, x, y, { keepDestination: true, keepFinalDestination: true });
}

export function handleAtNewGridNo(t: TacticalState, s: Soldier): boolean {
  let keepMoving = true;
  s.tilesMoved++;
  if (s.state === states(t.content.animations).RUNNING) s.tilesMoved++;
  const interrupted = t.hooks.atNewGridNo(t, s);
  if (interrupted) {
    adjustNoAPToFinishMove(s, true);
    keepMoving = false;
    s.pendingAnimation = -1;
    s.pendingDirection = -1;
  } else if (s.noAPToFinishMove || (s.pathIndex === s.pathSize && s.pathSize === 0)) {
    keepMoving = false;
  }
  t.hooks.newAiSituation(t, s);
  return keepMoving;
}

export function arriveAtFinalDestination(t: TacticalState, s: Soldier): void {
  s.pathIndex = 0;
  s.pathSize = 0;
  s.reverse = false;
  setSoldierPositionXY(t, s, Math.fround(s.destX), Math.fround(s.destY));
  if (s.pendingAnimation !== -1) {
    const pending = s.pendingAnimation;
    s.pendingAnimation = -1;
    initNewSoldierAnim(t, s, pending, 0, false);
    if (s.pendingDirection !== -1) {
      setDesiredDirection(t, s, s.pendingDirection);
      s.pendingDirection = -1;
    }
  } else if (s.life >= 15) {
    soldierGotoStationaryStance(t, s);
  }
  t.events.push({ type: 'arrived', soldier: s.id, gridNo: s.gridNo });
}

export function pathExhausted(t: TacticalState, s: Soldier): boolean {
  s.pathStored = false;
  if (s.absoluteFinalDestination !== NOWHERE) {
    s.ai.handleEveryFrame = true;
    return true;
  }
  const probe = findBestPath(t.pathEnv, s, s.finalDestination, s.level, { flags: PathFlags.THROUGH_PEOPLE });
  if (probe.length > 0) setDelayedTileWaiting(t, s, newGridNo(s.gridNo, step(probe.steps[0] ?? 0)), 1);
  if (!getNewSoldierPath(t, s, s.finalDestination, s.uiMovementMode, 2, false)) {
    soldierGotoStationaryStance(t, s);
    return false;
  }
  return true;
}

function sweetSpotNear(t: TacticalState, s: Soldier, g: number, radius: number, throughPeople: boolean): number {
  let best = NOWHERE;
  let bestDistance = Number.POSITIVE_INFINITY;
  const cx = g % WORLD_COLS;
  const cy = Math.trunc(g / WORLD_COLS);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= WORLD_COLS || y >= WORLD_COLS) continue;
      const candidate = y * WORLD_COLS + x;
      if (!newOKDestination(t.pathEnv, s, candidate, !throughPeople, s.level)) continue;
      const d = pythSpacesAway(g, candidate);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
    }
  }
  return best;
}

export function handleNextTileWaiting(t: TacticalState, s: Soldier): void {
  if (!s.delayedMovement) return;
  if (t.clockMs < s.nextTileCheckAt) return;
  s.nextTileCheckAt = t.clockMs + NEXT_TILE_CHECK_DELAY;
  const causeDirection = directionToward(s.gridNo, s.delayedMovementCause);
  const blocked = tileIsClear(t, s, causeDirection, s.delayedMovementCause, s.level);
  if (s.delayedMovement >= 100 && blocked === MoveTile.TEMP_BLOCKED) {
    s.delayedMovement++;
    if (s.delayedMovement > 120) {
      setFinalTile(t, s, true);
      s.delayedMovement = 0;
    }
    return;
  }
  if (blocked !== MoveTile.TEMP_BLOCKED) {
    if (s.delayedMovement >= 100 && s.delayedMovement !== 150) s.delayedMovement = 1;
    let target: number;
    if (s.absoluteFinalDestination === s.finalDestination) target = s.absoluteFinalDestination;
    else if (!newOKDestination(t.pathEnv, s, s.finalDestination, true, s.level)) {
      const throughPeople = s.delayedMovement < 150;
      target = sweetSpotNear(t, s, s.finalDestination, 6, throughPeople);
      if (target === NOWHERE) target = sweetSpotNear(t, s, s.finalDestination, 16, throughPeople);
    } else target = s.finalDestination;
    let path = findBestPath(t.pathEnv, s, target, s.level, { flags: PathFlags.THROUGH_PEOPLE });
    if (path.length > 0) {
      let first = path.steps[0] ?? 0;
      let pathBlocked = tileIsClear(t, s, first, newGridNo(s.gridNo, step(first)), s.level);
      if (pathBlocked === MoveTile.STATIONARY_BLOCKED) {
        path = findBestPath(t.pathEnv, s, target, s.level, { flags: PathFlags.IGNORE_PERSON_AT_DEST });
        first = path.steps[0] ?? 0;
        pathBlocked = tileIsClear(t, s, first, newGridNo(s.gridNo, step(first)), s.level);
        s.delayedMovementFlags &= ~DELAYED_MOVEMENT_FLAG_PATH_THROUGH_PEOPLE;
      } else if (s.delayedMovement < 150) {
        s.delayedMovementFlags |= DELAYED_MOVEMENT_FLAG_PATH_THROUGH_PEOPLE;
      }
      if (pathBlocked === MoveTile.CLEAR) {
        s.ai.actionData = target;
        s.pathStored = false;
        getNewSoldierPath(t, s, target, s.uiMovementMode);
        return;
      }
    }
    s.delayedMovement++;
    if (s.delayedMovement === 3 && s.absoluteFinalDestination !== NOWHERE) {
      const other = whoIsThere(t, s.delayedMovementCause, s.level);
      if (
        other &&
        s.team !== Team.OUR &&
        s.ai.orders !== Orders.STATIONARY &&
        other.team !== Team.OUR &&
        other.ai.orders !== Orders.STATIONARY
      ) {
        swapMercPositions(t, s, other);
        s.delayedMovement = 0;
        const route = findBestPath(t.pathEnv, s, s.absoluteFinalDestination, s.level, {
          flags: PathFlags.THROUGH_PEOPLE,
          copy: PathCopy.ROUTE,
        });
        if (route.length > 0) {
          s.path = [...route.steps];
          s.pathIndex = 0;
          s.pathSize = route.length;
        }
        s.pathStored = true;
        getNewSoldierPath(t, s, s.absoluteFinalDestination, s.uiMovementMode);
      }
    }
    if (
      ((s.delayedMovement > 20 && s.delayedMovement !== 150) || s.delayedMovement > 170) &&
      pythSpacesAway(s.gridNo, s.finalDestination) < 5 &&
      s.team === Team.OUR
    ) {
      setFinalTile(t, s, false);
      s.delayedMovement = 0;
    }
  }
}

export function directionToward(from: number, to: number): number {
  const dx = (to % WORLD_COLS) - (from % WORLD_COLS);
  const dy = Math.trunc(to / WORLD_COLS) - Math.trunc(from / WORLD_COLS);
  if (dx === 0 && dy === 0) return 2;
  let theta = Math.atan2(-dy, dx);
  if (theta < 0) theta += 2 * Math.PI;
  const sector = Math.trunc((8 * theta + Math.PI) / (2 * Math.PI)) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][sector] ?? 2;
}
