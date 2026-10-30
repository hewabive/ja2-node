// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc EVENT_InternalGetNewSoldierPath, EVENT_InternalSetSoldierDestination, MoveMerc,
// @src EVENT_SetSoldierPosition(XY), SetSoldierGridNo, EVENT_StopMerc; Overhead.cc HandleGotoNewGridNo, HandleAtNewGridNo;
// @src Soldier_Tile.cc TileIsClear, HandleNextTile, HandleNextTileWaiting, SetDelayedTileWaiting, (Un)MarkMovementReserved;
// @src Structure_Wrap.cc IsJumpableFencePresentAtGridno.

import { AnimFlags } from '../../content/anim/tables.ts';
import { newGridNo, pythSpacesAway, WORLD_COLS } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { has, StructureFlags, structureHeight } from '../../content/world/structures.ts';
import { idiv } from '../../core/int.ts';
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
  TurningFromProne,
} from './animation.ts';
import { reduceAttackBusyCount } from './combat/barrier.ts';
import { MOVE_SIN_COS } from './constants.ts';
import { DIRECTION_INCREMENT, Direction } from './directions.ts';
import { interactWithDoorAt } from './doors/door-actions.ts';
import { toggleDoorAt } from './doors.ts';
import { cancelFadeOutAwayFromStart } from './fade.ts';
import { pathMoveMode } from './movement-mode.ts';
import { assassinStepsCloseToPc } from './narrative/assassin-approach.ts';
import { handleEscortArrival } from './narrative/escort-arrival.ts';
import {
  findBestPath,
  isWater,
  MAX_PATH_LIST_SIZE,
  newOKDestination,
  PathCopy,
  PathFlags,
  type PathOptions,
  type PathResult,
} from './pathfinding.ts';
import { removePendingAction } from './pending-action.ts';
import { addMercStructure, removeMercStructure } from './person-structure.ts';
import { AP, actionPointCost, deductPoints, doorTravelCost, enoughPoints, type PointsContext, terrainBreathPoints } from './points.ts';
import { handleWaitActionOnArrival } from './sector-exit.ts';
import { dropSmell } from './smell.ts';
import { cellCentre, NO_PENDING_ANIMATION, NO_PENDING_DIRECTION, NOWHERE, OKBREATH, Orders, type Soldier, Team } from './soldier.ts';
import { onVisibleWorldTile, placeOccupant, removeOccupant, type TacticalState, WaitForMercs, whoIsThere } from './state.ts';
import { findGridNoFromSweetSpot, findGridNoFromSweetSpotThroughPeople } from './sweet-spots.ts';

export const MoveTile = { CLEAR: 0, TEMP_BLOCKED: -1, STATIONARY_BLOCKED: -2 } as const;
type MoveTileResult = (typeof MoveTile)[keyof typeof MoveTile];

const NEXT_TILE_CHECK_DELAY = 700;
const DESPERATE_WAIT = 150;
const NEAR_SWEET_SPOT_RADIUS = 6;
const FAR_SWEET_SPOT_RADIUS = 16;
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
  removeMercStructure(t, s);
  s.gridNo = g;
  s.placed = false;
  s.offMap = !onVisibleWorldTile(t, g);
  if (s.offMap) return;
  if (s.endDoorOpenCode === 2) {
    s.endDoorOpenCode = 0;
    toggleDoorAt(t, s.endDoorOpenCodeData);
  }
  s.walkToAttackGridNo = NOWHERE;
  unmarkMovementReserved(t, s);
  if (s.ai.patrolGrid.length === 0) s.ai.patrolGrid[0] = g;
  if (s.initialGridNo === 0) s.initialGridNo = g;
  dropSmell(t.smell, s);
  placeOccupant(t, s);
  s.placed = true;
  addMercStructure(t, s);
  s.overTerrain = t.world.terrain[g] ?? 0;
  if (isWater(t.pathWorld, g)) s.uiMovementMode = states(t.content.animations).WALKING;
  setSoldierAniSpeed(t, s);
  t.hooks.enteredGridNo(t, s, g);
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
  if (!s.delayedMovement) {
    s.pendingAnimation = NO_PENDING_ANIMATION;
    s.pendingDirection = NO_PENDING_DIRECTION;
    removePendingAction(t, s);
  }
  s.endDoorOpenCode = 0;
  s.turningFromPronePosition = TurningFromProne.OFF;
  s.pathIndex = 0;
  s.pathSize = 0;
  s.delayedMovement = 0;
  s.reverse = false;
  setSoldierPosition(t, s, s.gridNo);
  s.destX = Math.trunc(s.x);
  s.destY = Math.trunc(s.y);
  setSoldierDirection(t, s, s.direction);
  if (hasAnimFlag(t.content, s.state, AnimFlags.MOVING)) soldierGotoStationaryStance(t, s);
  if (s.turningToShoot) {
    s.turningToShoot = false;
    reduceAttackBusyCount(t, s, false);
  }
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

export function setSoldierDestination(t: TacticalState, s: Soldier, direction: number, animState: number, initialMove = false): void {
  const g = newGridNo(s.gridNo, step(direction));
  const centre = cellCentre(g);
  s.destination = g;
  s.destX = centre.x;
  s.destY = centre.y;
  s.movementDirection = direction;
  if (!hasAnimFlag(t.content, animState, AnimFlags.SPECIALMOVE)) setDesiredDirection(t, s, direction, animState, initialMove);
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
        const around = pathInMovementMode(t, s, s.finalDestination, s.uiMovementMode, { flags: 0 });
        if (around.length > 0) {
          s.pathStored = false;
          getNewSoldierPath(t, s, s.finalDestination, s.uiMovementMode);
          other.finalDestination = savedFinal;
          s.blockedByAnotherMerc = false;
          const first = around.steps[0] ?? 0;
          return tileIsClear(t, s, first, newGridNo(s.gridNo, step(first)), s.level);
        }
        if (!s.multiTile) {
          other.blockedByAnotherMerc = false;
          other.finalDestination = savedFinal;
          swapMercPositions(t, s, other);
          getNewSoldierPath(t, s, s.finalDestination, s.uiMovementMode);
          getNewSoldierPath(t, other, other.finalDestination, other.uiMovementMode);
        }
      }
      return MoveTile.TEMP_BLOCKED;
    }
    if (other.delayedMovement >= 105) {
      s.delayedMovement = DESPERATE_WAIT;
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
  removeMercStructure(t, a);
  removeMercStructure(t, b);
  a.placed = false;
  b.placed = false;
  setSoldierPosition(t, a, gb);
  setSoldierPosition(t, b, ga);
}

export function handleNextTile(t: TacticalState, s: Soldier, direction: number, g: number, finalDest: number): boolean {
  if (!onVisibleWorldTile(t, g)) return true;
  const blocked = tileIsClear(t, s, direction, g, s.level);
  if (blocked !== MoveTile.CLEAR) {
    const walkingOutOfSector = s.waitActionToDo !== 0;
    if (g === finalDest && !walkingOutOfSector && (s.team === Team.OUR || s.absoluteFinalDestination === NOWHERE)) {
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
    if (!enoughPoints(t.inCombat, s, AP.JUMPFENCE)) {
      haltGuyBecauseOfNoAPs(t, s);
      return { ok: false, keepMoving: false };
    }
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
    const doorGridNo =
      direction === Direction.NORTH || direction === Direction.WEST
        ? next
        : direction === Direction.SOUTH || direction === Direction.EAST
          ? s.gridNo
          : NOWHERE;
    if (doorGridNo === NOWHERE || !t.world.structures.find(doorGridNo, StructureFlags.ANYDOOR)) {
      haltForDoor(t, s);
      return { ok: false, keepMoving: false };
    }
    interactWithDoorAt(t, s, doorGridNo, direction);
    if (s.team !== Team.OUR || s.underAiControl) {
      s.endDoorOpenCode = 1;
      s.endDoorOpenCodeData = doorGridNo;
    }
    return { ok: false, keepMoving: false };
  }
  const ap = actionPointCost(ctx, s, next, direction, animState);
  const bp = terrainBreathPoints(ctx, s, next, direction, animState);
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
  if (!enoughPoints(t.inCombat, s, ap)) {
    haltGuyBecauseOfNoAPs(t, s);
    s.endDoorOpenCode = 0;
    return { ok: true, keepMoving: false };
  }
  if (t.hooks.runningIntoGas(t, s)) return { ok: true, keepMoving: false };
  if (!stepPaidBeforeGettingUpToTurn(t, s, animState)) deductPoints(t.inCombat, s, ap, bp);
  setSoldierDestination(t, s, direction, animState, initial);
  adjustNoAPToFinishMove(s, false);
  return { ok: true, keepMoving: true };
}

function stepPaidBeforeGettingUpToTurn(t: TacticalState, s: Soldier, animState: number): boolean {
  return animState === states(t.content.animations).CRAWLING && s.turningFromPronePosition >= TurningFromProne.START_UP_FROM_MOVE;
}

export function haltMoveForSoldierOutOfPoints(t: TacticalState, s: Soldier): void {
  if (hasAnimFlag(t.content, s.state, AnimFlags.SPECIALMOVE)) return;
  adjustNoAPToFinishMove(s, true);
  if (s.aiTurnControl) t.hooks.endAiGuysTurn(t, s);
}

function haltGuyBecauseOfNoAPs(t: TacticalState, s: Soldier): void {
  haltMoveForSoldierOutOfPoints(t, s);
  s.pendingAnimation = NO_PENDING_ANIMATION;
  s.pendingDirection = NO_PENDING_DIRECTION;
  unmarkMovementReserved(t, s);
  if (s.team === Team.OUR && t.inCombat) t.events.push({ type: 'stopped', soldier: s.id, gridNo: s.gridNo, reason: 'outOfAPs' });
}

function haltForDoor(t: TacticalState, s: Soldier): void {
  t.events.push({ type: 'stopped', soldier: s.id, gridNo: s.gridNo, reason: 'closedDoor' });
  s.endDoorOpenCode = 0;
  const savedFinal = s.finalDestination;
  stopMerc(t, s);
  s.finalDestination = savedFinal;
}

function pathInMovementMode(t: TacticalState, s: Soldier, dest: number, mode: number, options: PathOptions): PathResult {
  return findBestPath(t.pathEnv, s, dest, s.level, { ...options, mode: pathMoveMode(t.content, mode) });
}

function plottingToExitGrid(t: TacticalState, s: Soldier): boolean {
  return s.waitActionToDo === 1 && t.mercsWaiting?.code === WaitForMercs.WALK_TO_GRIDNO;
}

export function getNewSoldierPath(
  t: TacticalState,
  s: Soldier,
  dest: number,
  mode: number,
  fromUI = 0,
  forceRestart = true,
  throughPeople = false,
): boolean {
  let flags = 0;
  const plotToExitGrid = plottingToExitGrid(t, s);
  const ui = fromUI === 3 ? (s.team === Team.OUR ? 1 : 0) : fromUI;
  s.goodContPath = false;
  if (s.delayedMovement) {
    flags = s.delayedMovementFlags & DELAYED_MOVEMENT_FLAG_PATH_THROUGH_PEOPLE ? PathFlags.THROUGH_PEOPLE : PathFlags.IGNORE_PERSON_AT_DEST;
    s.delayedMovement = 0;
  }
  if (throughPeople) flags = PathFlags.THROUGH_PEOPLE;
  if ((!t.inCombat && hasAnimFlag(t.content, s.state, AnimFlags.MOVING) && ui === 1) || ui === 2) {
    if (s.collapsed) return false;
    const planner = { ...s, gridNo: s.destination };
    if (pathInMovementMode(t, planner, dest, s.uiMovementMode, { flags, plotToExitGrid }).length === 0) return false;
    const route = pathInMovementMode(t, planner, dest, s.uiMovementMode, { flags, copy: PathCopy.ROUTE, plotToExitGrid });
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
    const route = pathInMovementMode(t, s, dest, mode, { flags, copy: PathCopy.ROUTE, plotToExitGrid });
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

const FACING_SIN_COS: readonly (readonly [number, number])[] = [
  [-1.5099579909783707e-7, -0.9999999999999886],
  [0.7071067769704656, -0.7071067854026294],
  [0.9999999999999971, 7.549789954891874e-8],
  [0.7071067544940086, 0.7071068078790854],
  [0, 1],
  [-0.7075322252792844, 0.7066810809632191],
  [-0.9999999999999971, 7.549789954891874e-8],
  [-0.7071067769704656, -0.7071067854026294],
];

export function moveMercFacingDirection(t: TacticalState, s: Soldier, distance: number): void {
  const [sin, cos] = FACING_SIN_COS[s.direction] ?? [0, 0];
  const d = Math.fround(distance);
  const x = Math.fround(s.x + Math.fround(d * sin));
  const y = Math.fround(s.y + Math.fround(d * cos));
  setSoldierPositionXY(t, s, x, y, { keepDestination: true, keepFinalDestination: true });
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
  cancelFadeOutAwayFromStart(t, s);
  let keepMoving = true;
  s.tilesMoved++;
  if (s.state === states(t.content.animations).RUNNING) s.tilesMoved++;
  if (!t.inCombat) {
    s.tilesMovedPerRTBreathUpdate++;
    s.lastMovementAnimPerRTBreathUpdate = s.state;
  }
  const interrupted = t.hooks.atNewGridNo(t, s);
  const pause = t.turn.enemySightingOnTheirTurn;
  if (interrupted) {
    adjustNoAPToFinishMove(s, true);
    keepMoving = false;
    s.pendingAnimation = NO_PENDING_ANIMATION;
    s.pendingDirection = NO_PENDING_DIRECTION;
    if (s.gridNo === s.finalDestination) removePendingAction(t, s);
    t.turn.interruptOccurred = false;
    if (pause?.enemy === s) {
      s.pauseAllAnimation = false;
      t.turn.enemySightingOnTheirTurn = null;
    }
  } else if (s.noAPToFinishMove || (s.pathIndex === s.pathSize && s.pathSize === 0)) {
    keepMoving = false;
  } else if (pause && !hasAnimFlag(t.content, s.state, AnimFlags.SPECIALMOVE)) {
    adjustNoAPToFinishMove(s, true);
    keepMoving = false;
  }
  t.hooks.newAiSituation(t, s);
  handleEscortArrival(t, s);
  assassinStepsCloseToPc(t, s);
  return keepMoving;
}

export function arriveAtFinalDestination(t: TacticalState, s: Soldier): void {
  s.pathIndex = 0;
  s.pathSize = 0;
  s.reverse = false;
  setSoldierPositionXY(t, s, Math.fround(s.destX), Math.fround(s.destY));
  const hadPendingAnimation = s.pendingAnimation !== -1;
  if (hadPendingAnimation) {
    const pending = s.pendingAnimation;
    s.pendingAnimation = -1;
    initNewSoldierAnim(t, s, pending, 0, false);
    if (s.pendingDirection !== -1) {
      setDesiredDirection(t, s, s.pendingDirection);
      s.pendingDirection = -1;
    }
  }
  if (s.waitActionToDo) {
    const walkingOffEdge = s.waitActionToDo === 2;
    handleWaitActionOnArrival(t, s);
    if (walkingOffEdge) return;
  } else if (!t.hooks.pendingAction(t, s) && !hadPendingAnimation && s.life >= 15) soldierGotoStationaryStance(t, s);
  t.events.push({ type: 'arrived', soldier: s.id, gridNo: s.gridNo });
}

export function pathExhausted(t: TacticalState, s: Soldier): boolean {
  s.pathStored = false;
  if (s.absoluteFinalDestination !== NOWHERE) {
    s.ai.handleEveryFrame = true;
    return true;
  }
  const probe = pathInMovementMode(t, s, s.finalDestination, s.uiMovementMode, { flags: PathFlags.THROUGH_PEOPLE });
  if (probe.length > 0) setDelayedTileWaiting(t, s, newGridNo(s.gridNo, step(probe.steps[0] ?? 0)), 1);
  if (!getNewSoldierPath(t, s, s.finalDestination, s.uiMovementMode, 2, false)) {
    soldierGotoStationaryStance(t, s);
    return false;
  }
  return true;
}

function waitingSweetSpot(t: TacticalState, s: Soldier): number {
  const search = s.delayedMovement >= DESPERATE_WAIT ? findGridNoFromSweetSpot : findGridNoFromSweetSpotThroughPeople;
  const near = search(t, s, s.finalDestination, NEAR_SWEET_SPOT_RADIUS);
  return near !== NOWHERE ? near : search(t, s, s.finalDestination, FAR_SWEET_SPOT_RADIUS);
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
    if (s.delayedMovement >= 100 && s.delayedMovement !== DESPERATE_WAIT) s.delayedMovement = 1;
    let target: number;
    if (s.absoluteFinalDestination === s.finalDestination) target = s.absoluteFinalDestination;
    else if (!newOKDestination(t.pathEnv, s, s.finalDestination, true, s.level)) target = waitingSweetSpot(t, s);
    else target = s.finalDestination;
    const plotToExitGrid = plottingToExitGrid(t, s);
    let path = pathInMovementMode(t, s, target, s.uiMovementMode, { flags: PathFlags.THROUGH_PEOPLE, plotToExitGrid });
    if (path.length > 0) {
      let first = path.steps[0] ?? 0;
      let pathBlocked = tileIsClear(t, s, first, newGridNo(s.gridNo, step(first)), s.level);
      if (pathBlocked === MoveTile.STATIONARY_BLOCKED) {
        path = pathInMovementMode(t, s, target, s.uiMovementMode, { flags: PathFlags.IGNORE_PERSON_AT_DEST, plotToExitGrid });
        first = path.steps[0] ?? 0;
        pathBlocked = tileIsClear(t, s, first, newGridNo(s.gridNo, step(first)), s.level);
        s.delayedMovementFlags &= ~DELAYED_MOVEMENT_FLAG_PATH_THROUGH_PEOPLE;
      } else if (s.delayedMovement < DESPERATE_WAIT) {
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
        const route = pathInMovementMode(t, s, s.absoluteFinalDestination, s.uiMovementMode, {
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
      ((s.delayedMovement > 20 && s.delayedMovement !== DESPERATE_WAIT) || s.delayedMovement > 170) &&
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
  const dy = idiv(to, WORLD_COLS) - idiv(from, WORLD_COLS);
  if (dx === 0 && dy === 0) return 2;
  let theta = Math.atan2(-dy, dx);
  if (theta < 0) theta += 2 * Math.PI;
  const sector = Math.trunc((8 * theta + Math.PI) / (2 * Math.PI)) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][sector] ?? 2;
}
