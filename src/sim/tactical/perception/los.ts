// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LOS.cc LineOfSightTest, ResolveHitOnWall, CalculateSoldierZPos, SoldierToSoldierLineOfSightTest,
// @src SoldierTo3DLocationLineOfSightTest; Tactical/Structure_Wrap.cc wall and door edge queries.

import { Orientation } from '../../../content/formats/jsd.ts';
import { CELL_X_SIZE, CELL_Y_SIZE, DIRECTION_INCREMENT, Direction, WORLD_COLS, WORLD_MAX } from '../../../content/world/grid.ts';
import {
  has,
  ORIENT_LEFT,
  ORIENT_RIGHT,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  type StructureInstance,
  structureHeight,
  type WorldStructures,
} from '../../../content/world/structures.ts';
import { i32, idiv, u8 } from '../../../core/int.ts';

const FIX = 1 << 20;
const TEN = 10 * FIX;
const WALL = 256 * FIX;
const WIN_LO = 87 * FIX;
const WIN_HI = 220 * FIX;
const CLOSE_TO_FIRER = 25;
const ROOF_LIP_NEAR = 20;
const ROOF_LIP_VERY_NEAR = 11;
const ROOF_LIP_FAR = 120;
const ROOF_LIP_PRONE_TILES = 3;
const SIGHT_SCALE = 260;
const PI = 3.1415926;
const ORIENT_OUTSIDE = Orientation.OUTSIDE_LEFT | Orientation.OUTSIDE_RIGHT;
const ORIENT_INSIDE = Orientation.INSIDE_LEFT | Orientation.INSIDE_RIGHT;
const FAST_FORWARD_NONE = 1e6;
const NO_WINDOW = -1;
const SMELL_REDUCTION_FOR_NEARBY_OBSTACLE = 80;
const SMELL_OBSTACLE_RANGE = 100;

export const HeightClass = { STAND: 6, CROUCH: 3, PRONE: 1 } as const;

const LOS_POS: Readonly<Record<number, number>> = { 6: 175, 3: 111, 1: 31 };
export const TREE_SIGHT_REDUCTION: Readonly<Record<number, number>> = { 6: 6, 3: 7, 1: 8 };
export const STANDING_TREE_REDUCTION = 6;

export interface LosWorld {
  readonly structures: WorldStructures;
  readonly heights: Uint8Array;
}

export interface LosOptions {
  readonly tileLimit: number;
  readonly treeReduction: number;
  readonly aware: boolean;
  readonly camo: number;
  readonly disallowSight?: boolean;
  readonly window?: { gridNo: number };
  readonly smell?: boolean;
}

function toFix(f: number): number {
  return Math.trunc(f * FIX);
}

function fixInt(q: number): number {
  return idiv(q, FIX);
}

function tileOf(q: number): number {
  return idiv(fixInt(q), 10);
}

function cellOf(q: number): number {
  return (fixInt(q) % 10) >> 1;
}

function cubeOf(heightUnits: number): number {
  return idiv(heightUnits, 64);
}

export function landHeightUnits(world: LosWorld, g: number): number {
  return idiv((world.heights[g] ?? 0) * 256, 50);
}

function landFix(world: LosWorld, g: number): number {
  return landHeightUnits(world, g) * FIX;
}

function gridNoWithColumnAndRowSwapped(worldX: number, worldY: number): number {
  return idiv(worldX, CELL_X_SIZE) * WORLD_COLS + idiv(worldY, CELL_Y_SIZE);
}

interface RayEnd {
  readonly cubes: number;
  readonly cubesAboveLevel: number;
  readonly wall: number;
}

function rayEnd(world: LosWorld, worldX: number, worldY: number, qZ: number): RayEnd {
  const land = landFix(world, gridNoWithColumnAndRowSwapped(worldX, worldY));
  const cubes = cubeOf(fixInt(qZ - land));
  return { cubes, cubesAboveLevel: cubes >= STRUCTURE_ON_ROOF ? cubes - STRUCTURE_ON_ROOF : cubes, wall: WALL + land };
}

function crossesWallPlane(fromZ: number, toZ: number, wall: number): boolean {
  return fromZ < wall ? toZ > wall : toZ < wall;
}

function wallOrClosedDoor(world: LosWorld, g: number, orient: number): boolean {
  if (g < 0 || g >= WORLD_MAX) return false;
  for (const s of world.structures.at(g)) {
    if (!has(s.flags, StructureFlags.WALLSTUFF)) continue;
    if (has(s.flags, StructureFlags.ANYDOOR) && has(s.flags, StructureFlags.OPEN)) continue;
    if (s.wallOrientation & orient) return true;
  }
  return false;
}

function openDoorOnEdge(world: LosWorld, g: number, orient: number, doorFlag: number): boolean {
  if (g < 0 || g >= WORLD_MAX) return false;
  for (const s of world.structures.at(g)) {
    if (!has(s.flags, StructureFlags.ANYDOOR)) continue;
    if (!has(s.flags, StructureFlags.OPEN)) break;
    if (s.wallOrientation & orient && has(s.flags, StructureFlags.DOOR | doorFlag)) return true;
  }
  return false;
}

const wL = (w: LosWorld, g: number) => wallOrClosedDoor(w, g, ORIENT_LEFT);
const wR = (w: LosWorld, g: number) => wallOrClosedDoor(w, g, ORIENT_RIGHT);
const oL = (w: LosWorld, g: number) => openDoorOnEdge(w, g, ORIENT_LEFT, StructureFlags.DDOOR_LEFT);
const oR = (w: LosWorld, g: number) => openDoorOnEdge(w, g, ORIENT_RIGHT, StructureFlags.DDOOR_RIGHT);
const inc = (d: number) => DIRECTION_INCREMENT[d] ?? 0;

export function resolveHitOnWall(world: LosWorld, s: StructureInstance, g: number, cx: number, cy: number, horizAngle: number): boolean {
  const loc = cx * 10 + cy;
  if (loc !== 4 && loc !== 34 && loc !== 40 && loc !== 43 && loc !== 44) return true;
  const a = -horizAngle;
  const northSouth = (a < 0 && a > (-PI * 1) / 2) || (a > (PI * 1) / 2 && a < PI);
  const eastWest = (a > 0 && a < (PI * 1) / 2) || (a < (-PI * 1) / 2 && a > -PI);
  const topLeft = (s.wallOrientation & ORIENT_LEFT) !== 0;
  const topRight = (s.wallOrientation & ORIENT_RIGHT) !== 0;
  const { NORTH, NORTHEAST, EAST, SOUTH, SOUTHWEST, WEST } = Direction;
  if (northSouth) {
    if (loc === 43 || loc === 44) {
      if (topRight && !wR(world, g + inc(SOUTH)) && !wL(world, g) && !oR(world, g + inc(SOUTH))) return false;
    } else if (loc === 4) {
      if (topLeft && !wL(world, g + inc(WEST)) && !wR(world, g + inc(SOUTHWEST)) && !oL(world, g + inc(WEST))) return false;
    }
    if (loc === 44 || loc === 34) {
      if (topLeft && !wL(world, g + inc(EAST)) && !wR(world, g) && !oL(world, g + inc(EAST))) return false;
    } else if (loc === 40) {
      if (has(s.flags, StructureFlags.DOOR) && has(s.flags, StructureFlags.OPEN) && s.wallOrientation & ORIENT_OUTSIDE) return false;
      if (topRight && !wL(world, g + inc(NORTHEAST)) && !wR(world, g + inc(NORTH)) && !oL(world, g + inc(NORTHEAST))) return false;
    }
  }
  if (eastWest) {
    if (loc === 44) {
      if (s.wallOrientation === Orientation.NONE) return false;
    } else if (loc === 40) {
      if (topRight && !wR(world, g + inc(NORTH)) && !wL(world, g + inc(NORTH))) return false;
    } else if (loc === 4) {
      if (has(s.flags, StructureFlags.DOOR) && has(s.flags, StructureFlags.OPEN) && s.wallOrientation & ORIENT_INSIDE) return false;
      if (topLeft && !wL(world, g + inc(WEST)) && !wR(world, g + inc(WEST))) return false;
    }
    if ((loc === 34 && topLeft) || (loc === 43 && topRight) || loc === 44) {
      if (!wL(world, g + inc(EAST)) && !wR(world, g + inc(SOUTH)) && !oL(world, g + inc(EAST)) && !oR(world, g + inc(SOUTH))) return false;
    }
  }
  return true;
}

function roofLipSeeThrough(loop: number, iDist: number, start: RayEnd, end: RayEnd): boolean {
  if (!(loop < ROOF_LIP_NEAR || iDist - loop < ROOF_LIP_NEAR)) return false;
  if (loop <= ROOF_LIP_VERY_NEAR || iDist - loop <= ROOF_LIP_VERY_NEAR) {
    const higher = start.cubes < end.cubes ? end : start;
    return iDist >= (ROOF_LIP_PRONE_TILES - higher.cubesAboveLevel) * CELL_X_SIZE;
  }
  return iDist >= ROOF_LIP_FAR;
}

function smellBlockedBy(world: LosWorld, s: StructureInstance, g: number, cX: number, cY: number, horizAngle: number): boolean {
  if (has(s.flags, StructureFlags.TREE)) return false;
  if (has(s.flags, StructureFlags.WALLNWINDOW) && has(s.flags, StructureFlags.OPEN)) return false;
  return has(s.flags, StructureFlags.WALLSTUFF) ? resolveHitOnWall(world, s, g, cX, cY, horizAngle) : true;
}

function crossed(a: number, b: number, w: number): boolean {
  return (a > w && b <= w) || (a < w && b >= w);
}

export function lineOfSightTest(world: LosWorld, startG: number, startZ: number, endG: number, endZ: number, o: LosOptions): number {
  if (o.disallowSight) return 0;
  const sightLimit = o.tileLimit * 10;
  let adj = sightLimit;
  if (sightLimit === 0) return 0;
  let treeRed = o.treeReduction;
  if (!o.aware && !o.smell) treeRed = u8(idiv(treeRed * 3 * (100 + o.camo), 100));
  const sx = (startG % WORLD_COLS) * 10 + 5;
  const sy = idiv(startG, WORLD_COLS) * 10 + 5;
  const ex = (endG % WORLD_COLS) * 10 + 5;
  const ey = idiv(endG, WORLD_COLS) * 10 + 5;
  const dx = ex - sx;
  const dy = ey - sy;
  const dz = Math.fround(endZ - startZ);
  const dzScaled = Math.fround(dz / 25);
  const dist = Math.fround(Math.sqrt(dx * dx + dy * dy + dzScaled * dzScaled));
  let iDist = Math.trunc(dist);
  if (iDist === 0) return 0;
  if (dist !== iDist) iDist++;
  if (iDist > sightLimit) return 0;
  const horizAngle = Math.atan2(dy, dx);
  const qIncX = toFix(Math.fround(dx / iDist));
  const qIncY = toFix(Math.fround(dy / iDist));
  const qIncZ = toFix(Math.fround(dz / iDist));
  const qStartZ = toFix(startZ);
  const qEndZ = toFix(endZ);
  const start = rayEnd(world, sx, sy, qStartZ);
  const end = rayEnd(world, ex, ey, qEndZ);
  const checkRoof = crossesWallPlane(qStartZ, qEndZ, start.wall) || crossesWallPlane(qEndZ, qStartZ, end.wall);

  let qX = toFix(sx) + qIncX + idiv(toFix(dx) - qIncX * iDist, 2);
  let qY = toFix(sy) + qIncY + idiv(toFix(dy) - qIncY * iDist, 2);
  let qZ = qStartZ + qIncZ + idiv(toFix(dz) - qIncZ * iDist, 2);
  let tX = tileOf(qX);
  let tY = tileOf(qY);
  let cX = cellOf(qX);
  let cY = cellOf(qY);
  let cubes = cubeOf(fixInt(qZ));
  let loop = 1;
  let roof: StructureInstance | null = null;

  do {
    const g = tX + tY * WORLD_COLS;
    const land = landFix(world, g);
    const wall = WALL + land;
    if (checkRoof) {
      roof = world.structures.find(g, StructureFlags.ROOF);
      if (roof && crossed(qZ - qIncZ, qZ, wall)) return 0;
    }
    const oldTX = tX;
    const oldTY = tY;
    const list = g >= 0 && g < WORLD_MAX ? world.structures.at(g) : [];
    do {
      const above = fixInt(qZ - land);
      if (above < 0) return 0;
      if (list.length === 0) {
        const stepsX = qIncX > 0 ? idiv(TEN - (qX % TEN), qIncX) : qIncX < 0 ? idiv(qX % TEN, -qIncX) : FAST_FORWARD_NONE;
        const stepsY = qIncY > 0 ? idiv(TEN - (qY % TEN), qIncY) : qIncY < 0 ? idiv(qY % TEN, -qIncY) : FAST_FORWARD_NONE;
        const n = Math.min(stepsX, stepsY) + 1;
        qX = i32(qX + Math.imul(qIncX, n));
        qY = i32(qY + Math.imul(qIncY, n));
        qZ = i32(qZ + Math.imul(qIncZ, n));
        loop += n;
        if (qZ < land && loop < iDist) return 0;
        tX = tileOf(qX);
        tY = tileOf(qY);
        cubes = cubeOf(fixInt(qZ));
        cX = cellOf(qX);
        cY = cellOf(qY);
      } else {
        let cubeAbove = cubeOf(above);
        if (cubeAbove < 8) {
          const desired = cubeAbove < 4 ? 0 : 4;
          if (desired === 4) cubeAbove -= 4;
          for (const s of list) {
            let opaque = !has(s.flags, StructureFlags.TRANSPARENT);
            if (opaque && has(s.flags, StructureFlags.ROOF)) opaque = !roofLipSeeThrough(loop, iDist, start, end);
            if (!opaque || s.cubeOffset !== desired) continue;
            if (!((s.tile.shape[cX * 5 + cY] ?? 0) & (1 << cubeAbove))) continue;
            if (o.smell) {
              if (!smellBlockedBy(world, s, g, cX, cY, horizAngle)) continue;
              adj -= SMELL_REDUCTION_FOR_NEARBY_OBSTACLE;
              if (loop > SMELL_OBSTACLE_RANGE || iDist > adj) return 0;
              continue;
            }
            if (has(s.flags, StructureFlags.TREE)) {
              if (loop > CLOSE_TO_FIRER) {
                adj -= loop > 100 ? idiv(treeRed * loop, 100) : treeRed;
                if (iDist > adj) return 0;
              }
            } else if (
              has(s.flags, StructureFlags.WALLNWINDOW) &&
              !has(s.flags, StructureFlags.SPECIAL) &&
              qZ >= WIN_LO + land &&
              qZ <= WIN_HI + land
            ) {
              if (o.window && o.window.gridNo === NO_WINDOW) {
                o.window.gridNo = g;
                return loop;
              }
            } else {
              let hit: boolean;
              if (has(s.flags, StructureFlags.WALLSTUFF)) hit = resolveHitOnWall(world, s, g, cX, cY, horizAngle);
              else if (cubeAbove < 2) {
                if (loop <= CLOSE_TO_FIRER && cubeAbove <= start.cubesAboveLevel) hit = cubeAbove !== structureHeight(s) - 1;
                else if (loop >= iDist - CLOSE_TO_FIRER && cubeAbove <= end.cubes && o.aware) hit = cubeAbove !== structureHeight(s) - 1;
                else hit = true;
              } else hit = true;
              if (hit) return 0;
            }
          }
        }
        const oX = cX;
        const oY = cY;
        const oCubes = cubes;
        do {
          qX += qIncX;
          qY += qIncY;
          const last = qZ;
          qZ += qIncZ;
          if (roof && crossed(last, qZ, wall)) return 0;
          loop++;
          cX = cellOf(qX);
          cY = cellOf(qY);
          cubes = cubeOf(fixInt(qZ));
        } while (cX === oX && cY === oY && cubes === oCubes);
        tX = tileOf(qX);
        tY = tileOf(qY);
      }
    } while (tX === oldTX && tY === oldTY && loop < iDist);
  } while (loop < iDist);
  return idiv((iDist + (sightLimit - adj)) * SIGHT_SCALE, sightLimit);
}

export interface LosSubject {
  readonly gridNo: number;
  readonly level: number;
  readonly heightClass: number;
}

export function soldierEyeZ(world: LosWorld, s: LosSubject): number {
  let z = LOS_POS[s.heightClass] ?? LOS_POS[HeightClass.STAND] ?? 175;
  if (s.level > 0) z += 256;
  return z + landHeightUnits(world, s.gridNo);
}

export function soldierToSoldierLineOfSight(
  world: LosWorld,
  viewer: LosSubject,
  target: LosSubject,
  tileLimit: number,
  aware: boolean,
  disallow = false,
  smell = false,
): number {
  const endZ = soldierEyeZ(world, smell ? { ...target, heightClass: HeightClass.STAND } : target);
  return lineOfSightTest(world, viewer.gridNo, soldierEyeZ(world, viewer), target.gridNo, endZ, {
    tileLimit,
    treeReduction: TREE_SIGHT_REDUCTION[target.heightClass] ?? STANDING_TREE_REDUCTION,
    aware,
    camo: 0,
    disallowSight: disallow,
    smell,
  });
}

export function soldierToLocationLineOfSight(
  world: LosWorld,
  viewer: LosSubject,
  g: number,
  level: number,
  tileLimit: number,
  disallow = false,
): number {
  const endZ = 175 + level * 256 + landHeightUnits(world, g);
  return lineOfSightTest(world, viewer.gridNo, soldierEyeZ(world, viewer), g, endZ, {
    tileLimit,
    treeReduction: STANDING_TREE_REDUCTION,
    aware: true,
    camo: 0,
    disallowSight: disallow,
  });
}
