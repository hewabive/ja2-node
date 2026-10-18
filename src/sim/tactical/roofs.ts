// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Isometric_Utils.cc FindHigherLevel, FindLowerLevel; WorldMan.cc IsHeigherLevel;
// @src Tactical/Soldier_Control.cc BeginSoldierClimbUpRoof, BeginSoldierClimbDownRoof, SetSoldierHeight;
// @src CheckSoldierHitRoof; Tactical/Points.cc GetAPsToClimbRoof; Tactical/Soldier_Ani.cc codes 403, 404, 408, 409, 410, 411, 453–456, 475;
// @src TacticalAI/AIMain.cc FreeUpNPCFromRoofClimb. See docs/07 §6.

import type { OpOutcome } from '../../content/anim/script.ts';
import { DIRECTION_INCREMENT, newGridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { anim } from './anim-states.ts';
import { AnimHeight, height, initNewSoldierAnim, setDesiredDirection, setSoldierDirection } from './animation.ts';
import { soldierTakeDamage } from './combat/hit.ts';
import { DamageReason } from './combat/types.ts';
import { DIRECTION_COUNT } from './directions.ts';
import { cancelAllServices } from './first-aid.ts';
import { moveMercFacingDirection, setSoldierPosition } from './movement.ts';
import { newOKDestination } from './pathfinding.ts';
import { addMercStructure } from './person-structure.ts';
import { AP, apsToChangeStance, enoughPoints } from './points.ts';
import { Body, OKLIFE, type Soldier, Team } from './soldier.ts';
import { placeOccupant, removeOccupant, type TacticalState } from './state.ts';

const Code = {
  MOVE_FORWARD_SOME: 403,
  MOVE_BACKWARD_SOME: 404,
  CLIMB_UP_COMMIT: 408,
  MOVE_DOWN: 409,
  SET_GROUND_HEIGHT: 410,
  CLIMB_DOWN_START: 411,
  FALL_OFF_BACKWARDS: 453,
  CLIMB_UP: 454,
  CLIMB_UP_FORWARD: 455,
  CLIMB_DOWN: 456,
  CLIMB_DOWN_COMMIT: 475,
} as const;

const ROOF_HEIGHT = 50;
const MOVE_DOWN_STEP = 2;
const MOVE_FORWARD_SOME = 0.7;
const MOVE_BACKWARD_SOME = 1;
const CLIMB_DOWN_START_MOVE = 3.5;
const FALLOFF_BACKWARDS_DIST = [1, 0.8, 1, 1];
const CLIMB_UP_ROOF_DIST = [2.0, 0.1, 2.0, 2.0];
const CLIMB_UP_ROOF_LAT_DIST = [0.7, 0.5, 0.7, 0.5];
const CLIMB_DOWN_ROOF_START_DIST = [5.0, 1.0, 1, 1];
const CLIMB_UP_ROOF_DIST_GOING_LOWER = [0.9, 0.1, 1, 1];

const bodyRow = (s: Soldier) => (s.bodyType <= Body.REGFEMALE ? s.bodyType : 0);
const fround = Math.fround;

function turnsBetween(from: number, to: number): number {
  const diff = Math.abs(from - to);
  return Math.min(diff, DIRECTION_COUNT - diff);
}

export function isHigherLevel(t: TacticalState, g: number): boolean {
  return t.world.structures.find(g, StructureFlags.NORMAL_ROOF) !== null;
}

function hasRoof(t: TacticalState, g: number): boolean {
  return t.world.structures.find(g, StructureFlags.ROOF) !== null;
}

function bestClimbDirection(s: Soldier, ok: (g: number) => boolean): number {
  let best = -1;
  let minTurns = 100;
  for (let d = 0; d < DIRECTION_COUNT; d += 2) {
    const g = newGridNo(s.gridNo, DIRECTION_INCREMENT[d] ?? 0);
    if (!ok(g)) continue;
    const turns = turnsBetween(d, s.direction);
    if (minTurns <= turns) continue;
    minTurns = turns;
    best = d;
  }
  return best;
}

export function findHigherLevel(t: TacticalState, s: Soldier): number {
  if (s.level > 0 || hasRoof(t, s.gridNo)) return -1;
  return bestClimbDirection(s, (g) => newOKDestination(t.pathEnv, s, g, true, 1) && isHigherLevel(t, g));
}

export function findLowerLevel(t: TacticalState, s: Soldier): number {
  if (s.level === 0) return -1;
  return bestClimbDirection(s, (g) => newOKDestination(t.pathEnv, s, g, true, 0) && !hasRoof(t, g));
}

export function apsToClimbRoof(t: TacticalState, s: Soldier, down: boolean): number {
  return down
    ? AP.CLIMBOFFROOF + apsToChangeStance(t.content, s, AnimHeight.CROUCH)
    : AP.CLIMBROOF + apsToChangeStance(t.content, s, AnimHeight.STAND);
}

export function beginSoldierClimbUpRoof(t: TacticalState, s: Soldier): boolean {
  const direction = findHigherLevel(t, s);
  if (direction < 0 || !enoughPoints(t.inCombat, s, apsToClimbRoof(t, s, false))) return false;
  s.tempNewGridNo = newGridNo(s.gridNo, DIRECTION_INCREMENT[direction] ?? 0);
  s.pendingDirection = direction;
  initNewSoldierAnim(t, s, anim(t.content, 'CLIMBUPROOF'), 0, false);
  cancelAllServices(t, s, false);
  return true;
}

export function beginSoldierClimbDownRoof(t: TacticalState, s: Soldier): boolean {
  const direction = findLowerLevel(t, s);
  if (direction < 0 || !enoughPoints(t.inCombat, s, apsToClimbRoof(t, s, true))) return false;
  s.tempNewGridNo = newGridNo(s.gridNo, DIRECTION_INCREMENT[direction] ?? 0);
  s.pendingDirection = (direction + 2) % DIRECTION_COUNT;
  initNewSoldierAnim(t, s, anim(t.content, 'CLIMBDOWNROOF'), 0, false);
  cancelAllServices(t, s, false);
  return true;
}

export function setSoldierHeight(t: TacticalState, s: Soldier, height: number): void {
  s.heightAdjustment = fround(height);
  const level = Math.trunc(s.heightAdjustment) > 0 ? 1 : 0;
  if (level === s.level) return;
  removeOccupant(t, s);
  s.level = level;
  placeOccupant(t, s);
  addMercStructure(t, s);
}

function climbUpCommit(t: TacticalState, s: Soldier): void {
  t.perception.disallowSight = false;
  setSoldierPosition(t, s, s.tempNewGridNo);
  setSoldierDirection(t, s, (s.direction + DIRECTION_COUNT - 2) % DIRECTION_COUNT);
  setDesiredDirection(t, s, s.direction);
  s.desiredHeight = AnimHeight.CROUCH;
  setSoldierHeight(t, s, ROOF_HEIGHT);
  if (s.team !== Team.OUR) t.turnHooks.freeUpFromRoofClimb(t, s);
}

function climbDownCommit(t: TacticalState, s: Soldier): void {
  s.desiredHeight = AnimHeight.STAND;
  s.finalDestination = s.gridNo;
  t.perception.disallowSight = false;
  if (s.team !== Team.OUR) t.turnHooks.freeUpFromRoofClimb(t, s);
  s.uiMovementMode = anim(t.content, 'WALKING');
  t.hooks.look(t, s);
}

export function roofOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  const row = bodyRow(s);
  switch (code) {
    case Code.MOVE_FORWARD_SOME:
      moveMercFacingDirection(t, s, MOVE_FORWARD_SOME);
      return 'continue';
    case Code.MOVE_BACKWARD_SOME:
      moveMercFacingDirection(t, s, -MOVE_BACKWARD_SOME);
      return 'continue';
    case Code.CLIMB_UP_COMMIT:
      climbUpCommit(t, s);
      return 'continue';
    case Code.MOVE_DOWN:
      setSoldierHeight(t, s, s.heightAdjustment - MOVE_DOWN_STEP);
      return 'continue';
    case Code.SET_GROUND_HEIGHT:
      setSoldierHeight(t, s, 0);
      return 'continue';
    case Code.CLIMB_DOWN_START:
      setSoldierDirection(t, s, (s.direction + 2) % DIRECTION_COUNT);
      setDesiredDirection(t, s, s.direction);
      setSoldierHeight(t, s, CLIMB_DOWN_ROOF_START_DIST[row] ?? 1);
      moveMercFacingDirection(t, s, -CLIMB_DOWN_START_MOVE);
      return 'continue';
    case Code.FALL_OFF_BACKWARDS:
      moveMercFacingDirection(t, s, -(FALLOFF_BACKWARDS_DIST[row] ?? 1));
      return 'continue';
    case Code.CLIMB_UP:
      setSoldierHeight(t, s, s.heightAdjustment + (CLIMB_UP_ROOF_DIST[row] ?? 2));
      return 'continue';
    case Code.CLIMB_UP_FORWARD:
      moveMercFacingDirection(t, s, CLIMB_UP_ROOF_LAT_DIST[row] ?? 0.7);
      setSoldierHeight(t, s, s.heightAdjustment - (CLIMB_UP_ROOF_DIST_GOING_LOWER[row] ?? 1));
      return 'continue';
    case Code.CLIMB_DOWN:
      setSoldierHeight(t, s, s.heightAdjustment - (CLIMB_UP_ROOF_DIST[row] ?? 2));
      return 'continue';
    case Code.CLIMB_DOWN_COMMIT:
      climbDownCommit(t, s);
      return 'continue';
    default:
      return null;
  }
}

const FALL_DAMAGE_LIFE = 100;
const FALL_DAMAGE_BREATH = 5000;

export function checkSoldierHitRoof(t: TacticalState, s: Soldier): boolean {
  if (s.life >= OKLIFE) return false;
  const lower = findLowerLevel(t, s);
  if (lower < 0 || height(t.content, s.state) !== AnimHeight.STAND) return false;
  const away = (lower + 4) % DIRECTION_COUNT;
  const edge = newGridNo(s.gridNo, DIRECTION_INCREMENT[lower] ?? 0);
  if (!newOKDestination(t.pathEnv, s, edge, true, 0)) return false;
  const landing = newGridNo(edge, DIRECTION_INCREMENT[lower] ?? 0);
  if (!newOKDestination(t.pathEnv, s, landing, true, 0)) return false;
  const facingAway = [-2, -1, 0, 1, 2].some((k) => s.direction === (away + k + DIRECTION_COUNT) % DIRECTION_COUNT);
  s.tempNewGridNo = landing;
  setDesiredDirection(t, s, facingAway ? away : lower);
  s.turningUntilDone = true;
  s.pendingAnimation = anim(t.content, facingAway ? 'FALLOFF' : 'FALLFORWARD_ROOF');
  soldierTakeDamage(t, s, FALL_DAMAGE_LIFE, FALL_DAMAGE_BREATH, DamageReason.FALLROOF, null);
  return true;
}
