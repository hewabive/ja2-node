// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Physics.cc FindBestForceForTrajectory, FindBestAngleForTrajectory, CalculateObjectTrajectory,
// @src ChanceToGetThroughObjectTrajectory, CalculateLaunchItemBasicParams, CalculateLaunchItemChanceToGetThrough,
// @src CalculateForceFromRange, CalculateSoldierMaxForce, CalculateLaunchItemParamsForThrow, RandomGridFromRadius;
// @src Tactical/LOS.cc SoldierToLocationWindowTest; Structure_Wrap.cc IsRoofPresentAtGridno.

import { pythSpacesAway, WORLD_COLS, WORLD_MAX } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { clamp, i8 } from '../../../core/int.ts';
import { cloneObject, createItem, type ItemObject } from '../../items/object.ts';
import { rangeInUnits } from '../combat/chance.ts';
import { losWorldOf } from '../combat/positions.ts';
import { landHeightUnits, lineOfSightTest } from '../perception/los.ts';
import type { Soldier } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { createRealObject, HEIGHT_UNITS, NOWHERE, objectLevel, simulateObject, toGridNo } from './physics.ts';
import { type RealObject, TestObject, ThrowAction, type ThrowParams } from './state.ts';
import { calcMaxTossRange, launcherOf } from './throwing.ts';
import { f32, normal, scale, type Vec3, vec3 } from './vec3.ts';

const PI = 31_415_926 / 10_000_000;
const OUTDOORS_START_ANGLE = f32(PI / 4);
const INDOORS_START_ANGLE = f32(PI / 30);
const GLAUNCHER_START_ANGLE = f32(PI / 8);
const GLAUNCHER_HIGHER_LEVEL_START_ANGLE = f32(PI / 6);
const FIRST_ANGLE_GUESS = f32(f32(PI) / 8);
const MAX_RANGE_ANGLE = f32(PI / 4);
const STANDING_HEIGHT = 191;
const MORTAR_HEIGHT_UNITS = 50;
const MIN_MORTAR_RANGE = 150;
const WINDOW_TARGET_Z = 150;
const MAX_INTEGRATIONS = 8;
const FORCE_TOLERANCE = 0.01;
const ANGLE_TOLERANCE = 0.05;
const MIN_ANGLE = 0.005;
const FORCE_PROBE_ORIGIN = 4408;
const FORCE_PROBE_STATUS = 100;
const MAX_MISS_BY = 30;
const MIN_MISS_BY = 1;
const DEFAULT_MISS_RADIUS = 5;
const MAX_MISS_RADIUS = 4;
const MIN_MISS_RADIUS = 2;
const RANDOM_GRID_TRIES = 50;
const WINDOW_LOS_TILES = 255;
const WINDOW_EYE_Z = (87 + 220) / 2;
const AI_THROW_END_Z = 0;
const MAX_KNOWN_FORCES = 65_536;

export interface LaunchParams {
  readonly force: number;
  readonly degrees: number;
}

export interface LandingPrediction {
  readonly ok: boolean;
  readonly gridNo: number;
  readonly level: number;
}

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;

export function throwHeight(level: number): number {
  return level * HEIGHT_UNITS + STANDING_HEIGHT;
}

function centre(g: number): { x: number; y: number } {
  return { x: (g % WORLD_COLS) * 10 + 5, y: Math.trunc(g / WORLD_COLS) * 10 + 5 };
}

export function isRoofPresentAt(t: TacticalState, g: number): boolean {
  return t.world.structures.find(g, StructureFlags.ROOF) !== null;
}

function directionNormal(from: number, to: number, degrees: number): Vec3 {
  const a = centre(from);
  const b = centre(to);
  const dir = normal(vec3(b.x - a.x, b.y - a.y, 0));
  dir.z = f32(Math.sin(degrees));
  return dir;
}

function startPosition(g: number, z: number): Vec3 {
  const c = centre(g);
  return vec3(c.x, c.y, z);
}

function hypotf(x: number, y: number): number {
  return f32(Math.sqrt(x * x + y * y));
}

function runToDeath(t: TacticalState, o: RealObject): void {
  while (o.alive) simulateObject(t, o);
}

export function calculateObjectTrajectory(t: TacticalState, targetZ: number, obj: ItemObject, position: Vec3, force: Vec3): number {
  const o = createRealObject(obj, -1, position, force, null, ThrowAction.NONE, null);
  o.testObject = TestObject.NO_COLLISIONS;
  o.testZTarget = targetZ;
  o.testPositionNotSet = true;
  o.visible = false;
  runToDeath(t, o);
  return hypotf(f32(o.testTargetPosition.x - position.x), f32(o.testTargetPosition.y - position.y));
}

const knownForces = new WeakMap<object, Map<string, number>>();

function findBestForce(t: TacticalState, src: number, dst: number, startZ: number, endZ: number, degrees: number, obj: ItemObject): number {
  const items = t.content.items;
  const known = knownForces.get(items) ?? new Map<string, number>();
  if (known.size >= MAX_KNOWN_FORCES) known.clear();
  knownForces.set(items, known);
  const key = `${src}:${dst}:${startZ}:${endZ}:${degrees}:${obj.item === itemIndex(t, 'MORTAR_SHELL')}`;
  const cached = known.get(key);
  if (cached !== undefined) return cached;
  const force = searchBestForce(t, src, dst, startZ, endZ, degrees, obj);
  known.set(key, force);
  return force;
}

function searchBestForce(
  t: TacticalState,
  src: number,
  dst: number,
  startZ: number,
  endZ: number,
  degrees: number,
  obj: ItemObject,
): number {
  const position = startPosition(src, startZ);
  const dir = directionNormal(src, dst, degrees);
  const range = f32(rangeInUnits(dst, src));
  let force = f32(12 * Math.sqrt((9.8 * 2.5 * range) / f32(Math.sin(f32(2 * degrees)))));
  for (let checks = 1; ; checks++) {
    const tested = calculateObjectTrajectory(t, endZ, obj, position, scale(dir, force));
    const diff = f32(tested - range);
    if (Math.abs(f32(diff / range)) < FORCE_TOLERANCE) break;
    if (checks > MAX_INTEGRATIONS) break;
    force = f32(force - f32(f32(force * f32(diff / range)) / 2));
  }
  return force;
}

function findBestAngle(t: TacticalState, src: number, dst: number, startZ: number, endZ: number, force: number, obj: ItemObject): number {
  const position = startPosition(src, startZ);
  let degrees = FIRST_ANGLE_GUESS;
  const dir = directionNormal(src, dst, degrees);
  const range = f32(rangeInUnits(dst, src));
  for (let checks = 1; ; checks++) {
    const tested = calculateObjectTrajectory(t, endZ, obj, position, scale(dir, force));
    const diff = f32(tested - range);
    if (Math.abs(f32(diff / range)) < ANGLE_TOLERANCE) break;
    if (checks > MAX_INTEGRATIONS) break;
    degrees = f32(degrees - f32(f32(degrees * f32(diff / range)) / 2));
    if (Math.abs(degrees) >= PI / 2 || Math.abs(degrees) <= MIN_ANGLE) return 0;
    dir.z = f32(Math.sin(degrees));
  }
  return degrees;
}

function calculateForceFromRange(t: TacticalState, tiles: number, degrees: number): number {
  const probe = createItem(t.content.items, itemIndex(t, 'HAND_GRENADE'), FORCE_PROBE_STATUS);
  return findBestForce(t, FORCE_PROBE_ORIGIN, FORCE_PROBE_ORIGIN + tiles * WORLD_COLS, throwHeight(0), 0, degrees, probe);
}

export function soldierToLocationWindowTest(t: TacticalState, s: Soldier, g: number): number {
  const world = losWorldOf(t);
  let z = WINDOW_EYE_Z;
  if (s.level > 0) z += HEIGHT_UNITS;
  z += landHeightUnits(world, s.gridNo);
  const window = { gridNo: NOWHERE };
  lineOfSightTest(world, s.gridNo, z, g, z, {
    tileLimit: WINDOW_LOS_TILES,
    treeReduction: 0,
    aware: true,
    camo: 0,
    disallowSight: t.perception.disallowSight,
    window,
  });
  return window.gridNo === s.gridNo ? NOWHERE : window.gridNo;
}

export function launchItemBasicParams(
  t: TacticalState,
  s: Soldier,
  obj: ItemObject,
  g: number,
  level: number,
  endZ: number,
  armed: boolean,
): LaunchParams {
  let degrees = OUTDOORS_START_ANGLE;
  let startZ = throwHeight(s.level);
  const launcher = launcherOf(t, obj.item);
  const mortar = itemIndex(t, 'MORTAR');
  const grenadeLaunchers = [itemIndex(t, 'GLAUNCHER'), itemIndex(t, 'UNDER_GLAUNCHER')];
  let indoors = false;
  let minRange = 0;
  const mortarShot = armed && (launcher === mortar || obj.item === mortar);
  const grenadeLauncherShot = armed && (grenadeLaunchers.includes(launcher) || grenadeLaunchers.includes(obj.item));
  if (mortarShot) {
    startZ = s.level * HEIGHT_UNITS + MORTAR_HEIGHT_UNITS;
    minRange = MIN_MORTAR_RANGE;
  }
  if (grenadeLauncherShot) {
    degrees = level === 1 ? GLAUNCHER_HIGHER_LEVEL_START_ANGLE : GLAUNCHER_START_ANGLE;
    minRange = MIN_MORTAR_RANGE;
  }
  if (isRoofPresentAt(t, s.gridNo) && s.level === 0) {
    degrees = INDOORS_START_ANGLE;
    indoors = true;
  }
  if (isRoofPresentAt(t, g) && level === 0) {
    degrees = INDOORS_START_ANGLE;
    indoors = true;
  }
  const window = level === 0 ? soldierToLocationWindowTest(t, s, g) : NOWHERE;
  let force = findBestForce(t, s.gridNo, g, startZ, endZ, degrees, obj);
  let maxForce = calculateForceFromRange(t, calcMaxTossRange(t, s, obj.item, armed), MAX_RANGE_ANGLE);
  if (indoors) maxForce = f32(maxForce * 2);
  if (force > maxForce) force = maxForce;
  if (mortarShot || grenadeLauncherShot) {
    const minForce = calculateForceFromRange(t, Math.trunc(minRange / 10), MAX_RANGE_ANGLE);
    if (force < minForce) force = minForce;
  }
  if (window !== NOWHERE) degrees = findBestAngle(t, s.gridNo, window, throwHeight(s.level), WINDOW_TARGET_Z, force, obj);
  return { force, degrees };
}

function launchStartZ(t: TacticalState, s: Soldier, item: number, armed: boolean): number {
  return armed && launcherOf(t, item) === itemIndex(t, 'MORTAR') ? s.level * HEIGHT_UNITS + MORTAR_HEIGHT_UNITS : throwHeight(s.level);
}

export function randomGridFromRadius(t: TacticalState, sweet: number, minRadius: number, maxRadius: number): number {
  if (maxRadius === 0 || minRadius === 0) return sweet;
  let tries = 0;
  for (;;) {
    let x = t.pre.int(maxRadius);
    let y = t.pre.int(maxRadius);
    if ((x < minRadius || y < minRadius) && maxRadius !== minRadius) continue;
    if (t.pre.int(2) === 0) x = -x;
    if (t.pre.int(2) === 0) y = -y;
    const leftmost = Math.trunc((sweet + WORLD_COLS * y) / WORLD_COLS) * WORLD_COLS;
    const g = sweet + WORLD_COLS * y + x;
    if (g === sweet) continue;
    if (++tries > RANDOM_GRID_TRIES) return NOWHERE;
    if (g >= 0 && g < WORLD_MAX && g >= leftmost && g < leftmost + WORLD_COLS) return g;
  }
}

function missRadii(pyth: number, missByIn: number): { min: number; max: number } {
  const missBy = clamp(missByIn, MIN_MISS_BY, MAX_MISS_BY);
  let maxRadius = DEFAULT_MISS_RADIUS;
  if (pyth < f32(DEFAULT_MISS_RADIUS / f32(1.5))) maxRadius = Math.trunc(pyth / 2);
  const fraction = f32(f32(missBy) / f32(MAX_MISS_BY));
  let max = i8(Math.trunc(f32(maxRadius * fraction)));
  if (max > MAX_MISS_RADIUS) max = MAX_MISS_RADIUS;
  const min = Math.max(max - 1, MIN_MISS_RADIUS);
  if (max < min) max = min;
  return { min, max };
}

export function calculateLaunchItemParamsForThrow(
  t: TacticalState,
  s: Soldier,
  gIn: number,
  level: number,
  endZ: number,
  obj: ItemObject,
  missByIn: number,
  action: number,
  catchTarget: Soldier | null,
): ThrowParams {
  s.target = whoIsThere(t, gIn, level);
  const armed = action === ThrowAction.ARM_ITEM;
  const missBy = Math.max(0, i8(missByIn));
  let g = gIn;
  if (missBy > 0) {
    const radii = missRadii(pythSpacesAway(g, s.gridNo), missBy);
    g = randomGridFromRadius(t, g, radii.min, radii.max);
  }
  const basic = launchItemBasicParams(t, s, obj, g, level, endZ, armed);
  const force = scale(directionNormal(s.gridNo, g, basic.degrees), basic.force);
  const src = centre(s.gridNo);
  const params: ThrowParams = {
    x: f32(src.x),
    y: f32(src.y),
    z: f32(launchStartZ(t, s, obj.item, armed)),
    forceX: force.x,
    forceY: force.y,
    forceZ: force.z,
    lifeSpan: -1,
    action,
    target: catchTarget,
  };
  s.tempObject = cloneObject(obj);
  t.explosives.throwParams.set(s.id, params);
  return params;
}

export function calculateLaunchItemChanceToGetThrough(
  t: TacticalState,
  s: Soldier,
  obj: ItemObject,
  g: number,
  level: number,
  endZ: number,
  armed: boolean,
  fromUI: boolean,
): LandingPrediction {
  if (s.gridNo === g) return { ok: false, gridNo: g, level: s.level };
  const basic = launchItemBasicParams(t, s, obj, g, level, endZ, armed);
  const position = startPosition(s.gridNo, launchStartZ(t, s, obj.item, true));
  const force = scale(directionNormal(s.gridNo, g, basic.degrees), basic.force);
  const o = createRealObject(obj, -1, position, force, null, ThrowAction.NONE, null);
  o.testObject = TestObject.NOT_WALL_ROOF_COLLISIONS;
  o.testPositionNotSet = true;
  o.testZTarget = endZ;
  o.visible = false;
  runToDeath(t, o);
  const gridNo = toGridNo(fromUI ? o.position : o.endedWithCollisionPosition);
  const landedLevel = objectLevel(o.endedWithCollisionPosition.z);
  if (o.testEndedWithCollision) return { ok: false, gridNo, level: landedLevel };
  if (landedLevel !== level) return { ok: false, gridNo, level: landedLevel };
  if (!fromUI && gridNo !== g) return { ok: false, gridNo, level: landedLevel };
  return { ok: true, gridNo, level: landedLevel };
}

export function predictLanding(t: TacticalState, s: Soldier, obj: ItemObject, g: number, level: number, armed: boolean): LandingPrediction {
  return calculateLaunchItemChanceToGetThrough(t, s, obj, g, level, AI_THROW_END_Z, armed, false);
}
