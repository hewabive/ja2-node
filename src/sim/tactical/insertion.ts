// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc UpdateMercInSector; Tactical/Soldier_Add.cc InternalAddSoldierToSector,
// @src AddSoldierToSectorGridNo, SoldierInSectorIncompaciated, InternalSoldierInSectorSleep, SoldierInSectorAnim;
// @src TileEngine/Exit_Grids.cc FindClosestExitGrid; Overhead.cc SetEnemyPresence.

import { AnimFlags } from '../../content/anim/tables.ts';
import { isVisibleTile, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { anim } from './anim-states.ts';
import { hasAnimFlag, initNewSoldierAnim, setSoldierDirection, states } from './animation.ts';
import { findGridNoFromSweetSpot } from './creation.ts';
import { searchForClosestPrimaryMapEdgepoint, searchForClosestSecondaryMapEdgepoint } from './edgepoints.ts';
import { getNewSoldierPath, setSoldierPosition, stopMerc } from './movement.ts';
import { moveStateBasedOnStance } from './movement-mode.ts';
import { boxingHalvesPoints } from './narrative/boxing-state.ts';
import { keepElliotAliveInMeanwhile } from './narrative/meanwhile-rules.ts';
import { revealRoofsAndItems } from './perception/fov.ts';
import { calcActionPoints } from './points.ts';
import { Body, NO_PENDING_ANIMATION, NO_PENDING_DIRECTION, NOWHERE, OKLIFE, Side, type Soldier, Team } from './soldier.ts';
import { registerSoldier, sectorMapOf, type TacticalState } from './state.ts';
import { checkForPotentialAddToBattleIncrement } from './turns/turns.ts';

export const Insertion = {
  NORTH: 0,
  SOUTH: 1,
  EAST: 2,
  WEST: 3,
  GRIDNO: 4,
  ARRIVING_GAME: 5,
  CHOPPER: 6,
  PRIMARY_EDGEINDEX: 7,
  SECONDARY_EDGEINDEX: 8,
  CENTER: 9,
} as const;

export const CENTER_GRIDNO = (WORLD_ROWS / 2) * WORLD_COLS + WORLD_COLS / 2;
export const ARRIVING_GAME_GRIDNO = 4379;
export const FORCED_DIRECTION = 100;
const SWEET_SPOT_RADIUS = 7;
const EXIT_GRID_SEARCH_RADIUS = 10;
const ARRIVAL_WALK_RADIUS = 4;
const SECOND_LEVEL = 1;
const PLACEMENT_ANIM_CODE = 1;
const Assignment = { DOCTOR: 21, PATIENT: 22, REPAIR: 25 } as const;

export interface InsertionOrder {
  code: number;
  data: number;
  direction: number;
}

export interface SectorRef {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface InsertionContext {
  readonly worldSector: SectorRef;
  readonly mercSector: SectorRef;
  readonly startSector: SectorRef;
  readonly usingEdgepoints: boolean;
  readonly assignment?: number;
  readonly asleep?: boolean;
  readonly isEpc?: boolean;
  readonly heliDrop?: (s: Soldier, order: InsertionOrder) => void;
}

const sameSector = (a: SectorRef, b: SectorRef) => a.x === b.x && a.y === b.y && a.z === b.z;

function entryPoint(t: TacticalState, code: number): number {
  const info = sectorMapOf(t).info;
  switch (code) {
    case Insertion.NORTH:
      return info.northGridNo;
    case Insertion.SOUTH:
      return info.southGridNo;
    case Insertion.EAST:
      return info.eastGridNo;
    case Insertion.WEST:
      return info.westGridNo;
    default:
      return info.centerGridNo;
  }
}

function substituteEntryPoint(t: TacticalState): number {
  const info = sectorMapOf(t).info;
  return [info.northGridNo, info.eastGridNo, info.southGridNo, info.westGridNo, info.centerGridNo].find((g) => g !== -1) ?? NOWHERE;
}

const isEdgeIndex = (code: number) => code === Insertion.PRIMARY_EDGEINDEX || code === Insertion.SECONDARY_EDGEINDEX;
const isEntryCode = (code: number) => code <= Insertion.WEST || code === Insertion.CENTER;

function insertionGridNo(t: TacticalState, s: Soldier, order: InsertionOrder, ctx: InsertionContext): number | null {
  const underground = ctx.worldSector.z > 0;
  for (;;) {
    const code = order.code;
    if (isEntryCode(code)) {
      const g = entryPoint(t, code);
      return g === -1 ? substituteEntryPoint(t) : g;
    }
    if (code === Insertion.GRIDNO) return order.data;
    if (isEdgeIndex(code)) {
      const search = code === Insertion.PRIMARY_EDGEINDEX ? searchForClosestPrimaryMapEdgepoint : searchForClosestSecondaryMapEdgepoint;
      const g = search(t, s.pendingActionData2, order.data, underground);
      if (g !== NOWHERE) return g;
      order.code = order.data;
      continue;
    }
    if (code === Insertion.ARRIVING_GAME) {
      if (sameSector(ctx.mercSector, ctx.startSector) && sameSector(ctx.worldSector, ctx.startSector)) return ARRIVING_GAME_GRIDNO;
      order.code = Insertion.NORTH;
      return sectorMapOf(t).info.northGridNo;
    }
    if (code === Insertion.CHOPPER) return null;
    return CENTER_GRIDNO;
  }
}

export function updateMercInSector(t: TacticalState, s: Soldier, order: InsertionOrder, ctx: InsertionContext): boolean {
  if (isEdgeIndex(order.code) && !ctx.usingEdgepoints) order.code = order.data;
  const found = insertionGridNo(t, s, order, ctx);
  if (found === null) {
    ctx.heliDrop?.(s, order);
    return false;
  }
  const g = found === NOWHERE ? CENTER_GRIDNO : found;
  s.insertionGridNo = g;
  return addSoldierToSector(t, s, order, ctx, true);
}

export function findClosestExitGrid(t: TacticalState, source: number, radius: number): number {
  let lowest = NOWHERE;
  let lowestRange = 999999;
  const exits = t.world.exitGrids;
  for (let dy = -radius; dy <= radius; dy++) {
    const leftmost = Math.trunc((source + WORLD_COLS * dy) / WORLD_COLS) * WORLD_COLS;
    for (let dx = -radius; dx <= radius; dx++) {
      const g = source + WORLD_COLS * dy + dx;
      if (g < 0 || g >= WORLD_MAX || g < leftmost || g >= leftmost + WORLD_COLS || !exits.has(g)) continue;
      const range = rangeInCellCoords(source, g);
      if (range < lowestRange) {
        lowest = g;
        lowestRange = range;
      }
    }
  }
  return lowest;
}

export function rangeInCellCoords(a: number, b: number): number {
  const dx = (b % WORLD_COLS) - (a % WORLD_COLS);
  const dy = Math.trunc(b / WORLD_COLS) - Math.trunc(a / WORLD_COLS);
  return Math.trunc(Math.hypot(dx, dy) * 10);
}

export function directionFromTo(from: number, to: number): number {
  const dx = (to % WORLD_COLS) - (from % WORLD_COLS);
  const dy = Math.trunc(to / WORLD_COLS) - Math.trunc(from / WORLD_COLS);
  if (dx === 0 && dy === 0) return 2;
  let theta = Math.atan2(-dy, dx);
  if (theta < 0) theta += 2 * Math.PI;
  const sector = Math.trunc((8 * theta + Math.PI) / (2 * Math.PI)) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][sector] ?? 2;
}

export interface PlacementAnimation {
  readonly state: number;
  readonly code: number;
}

export function addSoldierToSector(
  t: TacticalState,
  s: Soldier,
  order: InsertionOrder,
  ctx: Pick<InsertionContext, 'assignment' | 'asleep' | 'isEpc'>,
  calculateDirection: boolean,
  animation: PlacementAnimation | null = null,
): boolean {
  keepElliotAliveInMeanwhile(t, s);
  s.actionPoints = calcActionPoints(s, boxingHalvesPoints(t));
  if (!t.mercSlots.includes(s)) registerSoldier(t, s);
  let gridNo = findGridNoFromSweetSpot(t, s, s.insertionGridNo, SWEET_SPOT_RADIUS);
  if (gridNo === NOWHERE) gridNo = s.insertionGridNo;
  if (!isVisibleTile(gridNo)) return false;
  let calculate = calculateDirection;
  if (order.direction >= FORCED_DIRECTION) {
    order.direction -= FORCED_DIRECTION;
    calculate = false;
  }
  let direction = order.direction;
  if (calculate) {
    direction = directionFromTo(gridNo, CENTER_GRIDNO);
    if (s.useExitGridForReentryDirection) {
      s.useExitGridForReentryDirection = false;
      const exit = findClosestExitGrid(t, gridNo, EXIT_GRID_SEARCH_RADIUS);
      if (exit !== NOWHERE) direction = directionFromTo(exit, gridNo);
    }
  }
  if (direction >= FORCED_DIRECTION) direction -= FORCED_DIRECTION;
  addSoldierToSectorGridNo(t, s, gridNo, direction, order.code, ctx, animation);
  checkForPotentialAddToBattleIncrement(t, s);
  return true;
}

function setEnemyPresence(t: TacticalState): void {
  if (t.turn.enemyInSector || !t.turn.virginSector) return;
  t.sectorHooks.enemyPresence(t);
  t.turn.enemyInSector = true;
}

function placementAnimation(t: TacticalState, s: Soldier, ctx: Pick<InsertionContext, 'assignment' | 'asleep' | 'isEpc'>): number | null {
  if (s.life < OKLIFE) return anim(t.content, 'STAND_FALLFORWARD_STOP');
  if (ctx.asleep) return ctx.isEpc ? states(t.content.animations).STANDING : anim(t.content, 'SLEEPING');
  const merc = s.bodyType <= Body.REGFEMALE;
  switch (ctx.assignment) {
    case Assignment.PATIENT:
      return merc ? anim(t.content, 'BEING_PATIENT') : states(t.content.animations).STANDING;
    case Assignment.DOCTOR:
      return merc ? anim(t.content, 'BEING_DOCTOR') : states(t.content.animations).STANDING;
    case Assignment.REPAIR:
      return merc ? anim(t.content, 'BEING_REPAIRMAN') : states(t.content.animations).STANDING;
    default:
      return null;
  }
}

function addSoldierToSectorGridNo(
  t: TacticalState,
  s: Soldier,
  gridNo: number,
  direction: number,
  insertionCode: number,
  ctx: Pick<InsertionContext, 'assignment' | 'asleep' | 'isEpc'>,
  animation: PlacementAnimation | null,
): void {
  s.reservedGridNo = NOWHERE;
  s.pendingAnimation = NO_PENDING_ANIMATION;
  s.pendingDirection = NO_PENDING_DIRECTION;
  if (insertionCode !== Insertion.CHOPPER) {
    if (hasAnimFlag(t.content, s.state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE)) s.state = states(t.content.animations).STANDING;
    setSoldierPosition(t, s, gridNo);
    s.desiredDirection = direction;
    setSoldierDirection(t, s, direction);
  }
  if (!s.dead && s.team === Team.OUR) {
    revealRoofsAndItems(t, s, false);
    if (s.state === states(t.content.animations).HOPFENCE) s.inNonInterruptibleAnimation = false;
    stopMerc(t, s);
  }
  if (insertionCode === Insertion.ARRIVING_GAME) {
    const walkTo = findGridNoFromSweetSpot(t, s, sectorMapOf(t).info.northGridNo, ARRIVAL_WALK_RADIUS);
    getNewSoldierPath(t, s, walkTo, states(t.content.animations).WALKING);
  }
  if (!s.neutral && s.side !== Side.FRIENDLY && s.bodyType !== Body.BLOODCAT) setEnemyPresence(t);
  if (s.dead) return;
  if (s.level === SECOND_LEVEL && !t.world.structures.find(s.gridNo, StructureFlags.ROOF)) s.level = 0;
  if (insertionCode === Insertion.ARRIVING_GAME) return;
  if (animation) initNewSoldierAnim(t, s, animation.state, animation.code, true);
  else if (s.bodyType !== Body.CROW) initNewSoldierAnim(t, s, states(t.content.animations).STANDING, PLACEMENT_ANIM_CODE, true);
  const special = placementAnimation(t, s, ctx);
  if (special !== null) initNewSoldierAnim(t, s, special, PLACEMENT_ANIM_CODE, true);
  s.uiMovementMode = moveStateBasedOnStance(t.content, s);
}
