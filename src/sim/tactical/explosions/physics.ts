// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Physics.cc CreatePhysicalObject, SimulateWorld, SimulateObject, PhysicsComputeForces,
// @src PhysicsUpdateLife, PhysicsIntegrate, PhysicsHandleCollisions, PhysicsCheckForCollisions, PhysicsResolveCollision,
// @src PhysicsMoveObject (the level node that decides when the catch is looked at), PhysicsDeleteObject,
// @src CheckForObjectHittingMerc, CheckForCatcher (before it), HandleArmedObjectImpact, CheckForCollision, vector_3ToGridNo.

import { ItemClass, ItemFlags } from '../../../content/items/items.ts';
import { isVisibleTile, WORLD_COLS, WORLD_ROWS } from '../../../content/world/grid.ts';
import { levelTilesAt } from '../../../content/world/level.ts';
import { has, INVALID_STRUCTURE_ID, ORIENT_RIGHT, PROFILE_Z_SIZE, StructureFlags } from '../../../content/world/structures.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { i8, i16 } from '../../../core/int.ts';
import { cloneObject, type ItemObject, USABLE_STATUS } from '../../items/object.ts';
import { reduceAttackBusyCount } from '../combat/barrier.ts';
import { eventSoldierGotHit } from '../combat/hit.ts';
import { Special } from '../combat/types.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { addItemToPool, FORCE_ON_GROUND, Visibility, WorldItemFlags } from '../world-items.ts';
import { checkForCatcher, checkForCatchObject, endCatchAnimation } from './catching.ts';
import { igniteExplosionXY } from './explosion.ts';
import { newLightEffect } from './light.ts';
import { type RealObject, TestObject, ThrowAction } from './state.ts';
import { windowHit } from './structure-damage.ts';
import { addInPlace, copy, dot, f32, normal, scale, type Vec3, vec3 } from './vec3.ts';

export const Collision = {
  NONE: 0,
  GROUND: 1,
  MERC: 2,
  WINDOW_SOUTHEAST: 3,
  WINDOW_SOUTHWEST: 4,
  WINDOW_NORTHEAST: 5,
  WINDOW_NORTHWEST: 6,
  WINDOW_NORTH: 7,
  WALL_SOUTHEAST: 8,
  WALL_SOUTHWEST: 9,
  WALL_NORTHEAST: 10,
  WALL_NORTHWEST: 11,
  STRUCTURE: 12,
  ROOF: 13,
  INTERIOR_ROOF: 14,
  STRUCTURE_Z: 15,
  WATER: 16,
} as const;

export const NOWHERE = -1;
export const HEIGHT_UNITS = 256;
export const PHYSICS_PERIOD_MS = 20;
const NUM_OBJECT_SLOTS = 50;
const TIME_MULTI = f32(1.8);
const DELTA_T = f32(1 * TIME_MULTI);
const SUB_STEP = f32(DELTA_T / 10);
const FORCE_STEP = f32(SUB_STEP / 60);
const GRAVITY = f32(9.8 * 2.5);
const INITIAL_FORCE_SCALE = f32(1.5 / TIME_MULTI);
const EPSILON_V = f32(0.5);
const MAX_CONSECUTIVE_COLLISIONS = 30;
const MAX_ZERO_VELOCITY_COLLISIONS = 3;
const NOT_COUNTED_UNTIL_TILES = 4;
const MU_GROUND = f32(0.34 * TIME_MULTI);
const MU_WATER = f32(1.54 * TIME_MULTI);
const MU_ROOF = f32(0.54 * TIME_MULTI);
const E_GROUND = f32(1.3);
const E_ROOF = f32(1.4);
const E_STRUCTURE_Z = f32(1.2);
const E_WALL = f32(1.1);
const WINDOW_BOTTOM = 87;
const WINDOW_TOP = 220;
const MATERIAL_LIGHT_VEGETATION = 4;
const MAX_NUM_SOLDIERS = 148;
const NOBODY = -1;
const CUBE_UNITS = HEIGHT_UNITS / PROFILE_Z_SIZE;
const PIXELS_PER_STOREY = 50;
const OBJECT_LEVEL_LIFT = 10;
const IMPACT_NOISE_BASE = 9;
const IMPACT_NOISE_SPREAD = 9;
const DUD_TRAP_RANGE = 4;
const DUD_TRAP_BASE = 2;
const DUD_DELAY_RANGE = 2;

const WALL_CODES: ReadonlySet<number> = new Set([
  Collision.WALL_SOUTHEAST,
  Collision.WALL_SOUTHWEST,
  Collision.WALL_NORTHEAST,
  Collision.WALL_NORTHWEST,
]);
const ALWAYS_COUNTED: ReadonlySet<number> = new Set([
  Collision.WATER,
  Collision.GROUND,
  Collision.NONE,
  Collision.ROOF,
  Collision.INTERIOR_ROOF,
  ...WALL_CODES,
]);
const PASS_THROUGH_EARLY: ReadonlySet<number> = new Set([Collision.MERC, Collision.STRUCTURE, Collision.STRUCTURE_Z]);
const BREAKABLE_WINDOWS: ReadonlySet<number> = new Set([
  Collision.WINDOW_NORTHWEST,
  Collision.WINDOW_NORTHEAST,
  Collision.WINDOW_SOUTHWEST,
  Collision.WINDOW_SOUTHEAST,
]);
const TEST_KEEPS_GOING: ReadonlySet<number> = new Set([
  Collision.WATER,
  Collision.GROUND,
  Collision.MERC,
  Collision.INTERIOR_ROOF,
  Collision.NONE,
  ...BREAKABLE_WINDOWS,
]);

const SURFACE_HITS: ReadonlySet<number> = new Set([
  Collision.GROUND,
  Collision.WATER,
  Collision.ROOF,
  Collision.INTERIOR_ROOF,
  ...WALL_CODES,
]);
const hitsStructureOrPerson = (code: number) => !SURFACE_HITS.has(code);

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;

export function toGridNo(v: Vec3): number {
  const row = Math.trunc(i16(Math.trunc(v.y)) / 10);
  const column = Math.trunc(i16(Math.trunc(v.x)) / 10);
  if (row >= 0 && row < WORLD_ROWS && column >= 0 && column < WORLD_COLS) return row * WORLD_COLS + column;
  return NOWHERE;
}

export function heightUnitsToPixels(z: number): number {
  return Math.trunc((i16(Math.trunc(z)) * PIXELS_PER_STOREY) / HEIGHT_UNITS);
}

export function objectLevel(z: number): number {
  return i8(Math.trunc(f32(f32(z + OBJECT_LEVEL_LIFT) / HEIGHT_UNITS)));
}

export function createRealObject(
  object: ItemObject,
  lifeLength: number,
  position: Vec3,
  force: Vec3,
  owner: Soldier | null,
  action: number,
  target: Soldier | null,
): RealObject {
  const initial = scale(vec3(f32(f32(force.x / HEIGHT_UNITS) * 10), f32(f32(force.y / HEIGHT_UNITS) * 10), force.z), INITIAL_FORCE_SCALE);
  const p = vec3(position.x, position.y, position.z);
  return {
    alive: true,
    applyFriction: false,
    visible: true,
    inWater: false,
    testObject: TestObject.NONE,
    testEndedWithCollision: false,
    testPositionNotSet: false,
    testZTarget: 0,
    appliedMu: 0,
    position: p,
    testTargetPosition: vec3(),
    oldPosition: vec3(),
    velocity: vec3(),
    oldVelocity: vec3(),
    initialForce: initial,
    force: vec3(),
    collisionNormal: vec3(),
    collisionVelocity: vec3(),
    collisionElasticity: 0,
    gridNo: toGridNo(p),
    consecutiveCollisions: 0,
    consecutiveZeroVelocityCollisions: 0,
    oldCollisionCode: Collision.NONE,
    lifeLength,
    lifeSpan: 0,
    object: cloneObject(object),
    owner,
    firstGridNo: 0,
    firstTimeMoved: true,
    action,
    target,
    dropItem: true,
    numTilesMoved: 0,
    endedWithCollisionPositionSet: false,
    endedWithCollisionPosition: vec3(),
    haveHitGround: false,
    lastTargetTakenDamage: NOBODY,
    levelNode: false,
    attemptedCatch: false,
    catchAnimOn: false,
    catchCheckDone: false,
    catchGood: false,
  };
}

export function createPhysicalObject(
  t: TacticalState,
  object: ItemObject,
  lifeLength: number,
  position: Vec3,
  force: Vec3,
  owner: Soldier | null,
  action: number,
  target: Soldier | null,
): RealObject {
  const slots = t.explosives.objects;
  let slot = slots.indexOf(null);
  if (slot === -1) {
    if (slots.length >= NUM_OBJECT_SLOTS) throw new Error('out of physics object slots');
    slot = slots.length;
    slots.push(null);
  }
  const o = createRealObject(object, lifeLength, position, force, owner, action, target);
  slots[slot] = o;
  return o;
}

function deletePhysicalObject(t: TacticalState, o: RealObject): void {
  const slots = t.explosives.objects;
  const slot = slots.indexOf(o);
  if (slot >= 0) slots[slot] = null;
  while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
}

export function stepThrownObjects(t: TacticalState): void {
  const e = t.explosives;
  if (t.clockMs < e.nextPhysicsMs) return;
  e.nextPhysicsMs = t.clockMs + PHYSICS_PERIOD_MS;
  const count = e.objects.length;
  for (let slot = 0; slot < count; slot++) {
    const o = e.objects[slot];
    if (o) simulateObject(t, o);
  }
}

export function simulateObject(t: TacticalState, o: RealObject): void {
  if (!physicsUpdateLife(t, o)) return;
  if (!o.alive) return;
  computeForces(o);
  for (let time = 0; time < DELTA_T; time = f32(time + SUB_STEP)) {
    integrate(o);
    if (whistles(t, o) && o.oldVelocity.z >= 0 && o.velocity.z < 0) t.events.push({ type: 'mortarWhistle', sounding: true });
    const r = handleCollisions(t, o);
    if (!r.ok) return;
    if (r.code !== Collision.NONE) break;
  }
  physicsMoveObject(t, o);
}

function computeForces(o: RealObject): void {
  o.force = copy(o.initialForce);
  o.force.z = f32(o.force.z - GRAVITY);
  o.initialForce = vec3();
  if (o.applyFriction) {
    addInPlace(o.force, scale(o.velocity, -o.appliedMu));
    o.applyFriction = false;
  }
}

function integrate(o: RealObject): void {
  o.oldPosition = copy(o.position);
  o.oldVelocity = copy(o.velocity);
  addInPlace(o.position, scale(o.velocity, SUB_STEP));
  if (o.testPositionNotSet) o.testTargetPosition = copy(o.position);
  addInPlace(o.velocity, scale(o.force, FORCE_STEP));
}

function physicsUpdateLife(t: TacticalState, o: RealObject): boolean {
  o.lifeSpan = f32(o.lifeSpan + DELTA_T);
  if (o.lifeLength !== -1 && o.lifeSpan > o.lifeLength) o.alive = false;
  if (!isVisibleTile(o.gridNo)) o.alive = false;
  if (o.alive) return true;
  if (!o.testObject && whistles(t, o)) t.events.push({ type: 'mortarWhistle', sounding: false });
  if (!o.testObject) endOfLife(t, o);
  deletePhysicalObject(t, o);
  return false;
}

function endOfLife(t: TacticalState, o: RealObject): void {
  const def = t.content.items.byIndex.get(o.object.item);
  if (o.action === ThrowAction.ARM_ITEM && !o.inWater) handleArmedObjectImpact(t, o);
  else if (!o.inWater || !((def?.flags ?? 0) & ItemFlags.SINKS)) {
    if (o.dropItem && o.action !== ThrowAction.ARM_ITEM) {
      const level = o.oldCollisionCode === Collision.ROOF ? 1 : 0;
      addItemToPool(t, o.gridNo, o.object, Visibility.VISIBLE, level, 0, FORCE_ON_GROUND);
    }
  }
  const rock = o.object.item === itemIndex(t, 'ROCK') || o.object.item === itemIndex(t, 'ROCK2');
  if (rock || def?.itemClass === ItemClass.GRENADE) {
    const volume = IMPACT_NOISE_BASE + t.pre.int(IMPACT_NOISE_SPREAD);
    makeNoise(t, o.owner, o.gridNo, 0, volume, rock ? NoiseKind.ROCK_IMPACT : NoiseKind.GRENADE_IMPACT);
  }
  if (o.oldCollisionCode === Collision.GROUND || o.oldCollisionCode === Collision.ROOF)
    t.events.push({ type: 'thrownImpact', gridNo: o.gridNo });
  reduceAttackBusyCount(t, o.owner, false);
  endCatchAnimation(t, o);
}

function goesOff(t: TacticalState, status: number): boolean {
  return status >= USABLE_STATUS && t.pre.int(100) < status + t.pre.int(50);
}

function drawTimedBombSettings(t: TacticalState): { readonly trapLevel: number; readonly delay: number } {
  const trapLevel = t.pre.int(DUD_TRAP_RANGE) + DUD_TRAP_BASE;
  return { trapLevel, delay: 1 + t.pre.int(DUD_DELAY_RANGE) };
}

function handleArmedObjectImpact(t: TacticalState, o: RealObject): void {
  const z = heightUnitsToPixels(o.position.z);
  const obj = o.object;
  obj.count = 1;
  const def = t.content.items.byIndex.get(obj.item);
  const mortarShell = obj.item === itemIndex(t, 'MORTAR_SHELL');
  const grenade = def?.itemClass === ItemClass.GRENADE;
  if (def?.itemClass === ItemClass.THROWN) addItemToPool(t, o.gridNo, obj, Visibility.INVISIBLE, 0, 0, 0);
  let impact = true;
  if (grenade || mortarShell) {
    const status = obj.status[0] ?? 0;
    impact = z !== 0 || o.inWater || goesOff(t, status);
    if (!impact) {
      const rearmed = goesOff(t, status);
      if (rearmed) drawTimedBombSettings(t);
      const level = o.oldCollisionCode === Collision.ROOF ? 1 : 0;
      addItemToPool(t, o.gridNo, obj, Visibility.INVISIBLE, level, rearmed ? WorldItemFlags.ARMED_BOMB : 0, 0);
    }
  }
  const explosive = def?.explosive;
  if (!explosive || !impact) return;
  const level = objectLevel(o.position.z);
  const causesExplosion = explosive.blast !== null || explosive.stun !== null || explosive.smoke !== null;
  if (explosive.light) {
    if (level > 0) {
      if (!causesExplosion) addItemToPool(t, o.gridNo, obj, Visibility.VISIBLE, 1, 0, FORCE_ON_GROUND);
    } else newLightEffect(t, o.gridNo, explosive.light.radius, explosive.light.duration);
  }
  const x = i16(Math.trunc(o.position.x));
  const y = i16(Math.trunc(o.position.y));
  if (grenade && causesExplosion) igniteExplosionXY(t, o.owner, x, y, z, o.gridNo, obj.item, level);
  if (mortarShell) igniteExplosionXY(t, o.owner, x, y, z, o.gridNo, obj.item, level);
}

interface CollisionResult {
  readonly ok: boolean;
  readonly code: number;
}

function handleCollisions(t: TacticalState, o: RealObject): CollisionResult {
  const checked = checkForCollisions(t, o);
  let code = checked.code;
  if (!checked.collided) return { ok: true, code };
  const dx = f32(o.position.x - o.oldPosition.x);
  const dy = f32(o.position.y - o.oldPosition.y);
  if (dx <= EPSILON_V && dx >= -EPSILON_V && dy <= EPSILON_V && dy >= -EPSILON_V) o.consecutiveZeroVelocityCollisions++;
  if (o.consecutiveZeroVelocityCollisions > MAX_ZERO_VELOCITY_COLLISIONS) {
    o.velocity.x = 0;
    o.velocity.y = 0;
    if (code === Collision.STRUCTURE_Z || code === Collision.ROOF || code === Collision.GROUND) {
      o.velocity.z = 0;
      o.alive = false;
    }
    code = Collision.NONE;
  } else {
    o.position = copy(o.oldPosition);
    resolveCollision(o);
  }
  if (o.position.z < 0) o.position.z = 0;
  if (o.consecutiveCollisions > MAX_CONSECUTIVE_COLLISIONS) {
    o.alive = false;
    return { ok: false, code };
  }
  return { ok: true, code };
}

function resolveCollision(o: RealObject): void {
  const impulse = f32(f32(-1 * o.collisionElasticity) * dot(o.collisionVelocity, o.collisionNormal));
  addInPlace(o.velocity, scale(o.collisionNormal, impulse));
}

interface Checked {
  readonly collided: boolean;
  readonly code: number;
}

interface Hit {
  readonly code: number;
  readonly structureId: number;
  readonly normal: Vec3;
}

function testCollision(o: RealObject, z: number, dz: number): number {
  if (!(z < o.testZTarget && dz < 0)) return Collision.NONE;
  if (!o.testPositionNotSet) return Collision.GROUND;
  if (o.testZTarget === HEIGHT_UNITS) return Collision.ROOF;
  if (o.testZTarget > 32) {
    o.testPositionNotSet = false;
    o.testZTarget = 0;
    return Collision.NONE;
  }
  return Collision.GROUND;
}

function filterEarlyHits(o: RealObject, code: number): number {
  if (ALWAYS_COUNTED.has(code)) return code;
  let c = code;
  if (o.firstTimeMoved || o.firstGridNo === o.gridNo) c = Collision.NONE;
  if (o.numTilesMoved < NOT_COUNTED_UNTIL_TILES && PASS_THROUGH_EARLY.has(c)) c = Collision.NONE;
  return c;
}

function markEndedWithCollision(o: RealObject): void {
  if (o.endedWithCollisionPositionSet) return;
  o.endedWithCollisionPositionSet = true;
  o.endedWithCollisionPosition = copy(o.position);
}

function testObjectOutcome(o: RealObject, code: number, structureId: number): number {
  switch (code) {
    case Collision.STRUCTURE:
    case Collision.STRUCTURE_Z:
      markEndedWithCollision(o);
      if (structureId >= INVALID_STRUCTURE_ID) {
        o.testEndedWithCollision = true;
        return Collision.NONE;
      }
      return code;
    case Collision.ROOF:
      markEndedWithCollision(o);
      return code;
    default:
      if (!TEST_KEEPS_GOING.has(code)) o.testEndedWithCollision = true;
      return code;
  }
}

function checkForCollisions(t: TacticalState, o: RealObject): Checked {
  const { x, y, z } = o.position;
  const dx = f32(x - o.oldPosition.x);
  const dy = f32(y - o.oldPosition.y);
  const dz = f32(z - o.oldPosition.z);
  let hit: Hit = { code: Collision.NONE, structureId: 0, normal: vec3() };
  if (o.testObject !== TestObject.NO_COLLISIONS) hit = checkForCollision(t, x, y, z, dx, dy, dz);
  else hit = { ...hit, code: testCollision(o, z, dz) };
  let code = filterEarlyHits(o, hit.code);
  if (o.testObject === TestObject.NOT_WALL_ROOF_COLLISIONS) code = testObjectOutcome(o, code, hit.structureId);
  if (code <= Collision.NONE) return { collided: false, code };
  o.consecutiveCollisions = o.oldCollisionCode === code ? o.consecutiveCollisions + 1 : 1;
  if (BREAKABLE_WINDOWS.has(code)) {
    if (!o.testObject) windowHit(t, toGridNo(o.position), hit.structureId, false);
    return { collided: false, code: Collision.NONE };
  }
  if (o.object.item === itemIndex(t, 'MORTAR_SHELL')) {
    o.alive = false;
    return { collided: true, code };
  }
  if (hitsStructureOrPerson(code) && checkForCatcher(t, o, hit.structureId)) return { collided: false, code };
  const response = collisionResponse(t, o, code, hit, dx, dy);
  if (!response) {
    o.consecutiveCollisions = 0;
    o.consecutiveZeroVelocityCollisions = 0;
    o.haveHitGround = false;
    return { collided: false, code };
  }
  o.collisionNormal = response.normal;
  o.collisionElasticity = response.elasticity;
  o.oldCollisionCode = code;
  o.collisionVelocity = copy(o.oldVelocity);
  return { collided: true, code };
}

interface Response {
  readonly normal: Vec3;
  readonly elasticity: number;
}

function landOnce(t: TacticalState, o: RealObject): void {
  if (!o.testObject && !o.haveHitGround) t.events.push({ type: 'thrownImpact', gridNo: o.gridNo });
  o.haveHitGround = true;
}

const DOWN = (): Vec3 => vec3(0, 0, -1);

function collisionResponse(t: TacticalState, o: RealObject, code: number, hit: Hit, dx: number, dy: number): Response | null {
  switch (code) {
    case Collision.GROUND:
      o.applyFriction = true;
      o.appliedMu = MU_GROUND;
      landOnce(t, o);
      return { normal: DOWN(), elasticity: E_GROUND };
    case Collision.WATER:
      enterWater(t, o);
      return null;
    case Collision.ROOF:
    case Collision.INTERIOR_ROOF:
      o.applyFriction = true;
      o.appliedMu = MU_ROOF;
      landOnce(t, o);
      return { normal: DOWN(), elasticity: E_ROOF };
    case Collision.STRUCTURE_Z:
      checkForObjectHittingMerc(t, o, hit.structureId);
      o.applyFriction = true;
      o.appliedMu = MU_ROOF;
      return { normal: DOWN(), elasticity: E_STRUCTURE_Z };
    default:
      if (WALL_CODES.has(code)) return { normal: copy(hit.normal), elasticity: E_WALL };
      checkForObjectHittingMerc(t, o, hit.structureId);
      return { normal: sideNormal(dx, dy), elasticity: E_WALL };
  }
}

function sideNormal(dx: number, dy: number): Vec3 {
  const incident = normal(vec3(dx, dy, 0));
  return vec3(-incident.x, -incident.y, 0);
}

function enterWater(t: TacticalState, o: RealObject): void {
  o.applyFriction = true;
  o.appliedMu = MU_WATER;
  const g = toGridNo(o.position);
  o.alive = false;
  if (!o.visible || o.testObject !== TestObject.NONE) return;
  o.visible = false;
  o.inWater = true;
  const at = { x: i16(Math.trunc(o.position.x)), y: i16(Math.trunc(o.position.y)), z: heightUnitsToPixels(o.position.z) };
  t.events.push({ type: 'waterRipple', gridNo: g, ...at });
  if (o.action !== ThrowAction.ARM_ITEM) return;
  t.explosives.aniTiles.unshift({
    kind: 'ripple',
    owner: o.owner,
    item: o.object.item,
    x: i16(Math.trunc(o.position.x)),
    y: i16(Math.trunc(o.position.y)),
    gridNo: g,
    frame: 0,
    lastUpdate: t.clockMs,
  });
}

function checkForObjectHittingMerc(t: TacticalState, o: RealObject, structureId: number): void {
  if (o.testObject !== TestObject.NONE) return;
  if (structureId >= MAX_NUM_SOLDIERS || structureId === o.lastTargetTakenDamage) return;
  const s = t.soldiers[structureId];
  if (!s) return;
  eventSoldierGotHit(t, s, 0, 1, 0, s.direction, 0, o.owner, Special.TOSSED_OBJECT, 0);
  o.lastTargetTakenDamage = structureId;
}

function physicsMoveObject(t: TacticalState, o: RealObject): boolean {
  const g = toGridNo(o.position);
  if (o.firstTimeMoved) {
    o.firstTimeMoved = false;
    o.firstGridNo = g;
  }
  if (g === NOWHERE) {
    deletePhysicalObject(t, o);
    return false;
  }
  if (g !== o.gridNo || !o.levelNode) {
    if (o.visible && checkForCatchObject(t, o)) o.visible = false;
    if (!o.visible) o.levelNode = false;
    else if (smokeTrail(t, o)) {
      if (g !== o.gridNo) leaveMortarTrail(t, o, g);
    } else if (o.numTilesMoved > 0 && g !== o.gridNo) o.levelNode = true;
    if (g !== o.gridNo) o.numTilesMoved++;
    o.gridNo = g;
  }
  return true;
}

const MORTAR_TRAIL_DELAY_MS = 100;
const MORTAR_TRAIL_DELAY_RANGE_MS = 100;

function leaveMortarTrail(t: TacticalState, o: RealObject, g: number): void {
  const delay = MORTAR_TRAIL_DELAY_MS + t.pre.int(MORTAR_TRAIL_DELAY_RANGE_MS);
  const x = i16(Math.trunc(o.position.x));
  const y = i16(Math.trunc(o.position.y));
  t.events.push({ type: 'missileTrail', gridNo: g, x, y, z: heightUnitsToPixels(o.position.z), trail: 'smoke', delay });
}

export function objectDrawnInFlight(t: TacticalState, o: RealObject): boolean {
  if (!o.visible || o.testObject !== TestObject.NONE) return false;
  return o.object.item !== itemIndex(t, 'MORTAR_SHELL') || o.action !== ThrowAction.ARM_ITEM;
}

function whistles(t: TacticalState, o: RealObject): boolean {
  return o.object.item === itemIndex(t, 'MORTAR_SHELL') && o.testObject === TestObject.NONE && o.action === ThrowAction.ARM_ITEM;
}

function smokeTrail(t: TacticalState, o: RealObject): boolean {
  return o.object.item === itemIndex(t, 'MORTAR_SHELL') && o.numTilesMoved > 2 && o.action === ThrowAction.ARM_ITEM;
}

function isWaterTile(t: TacticalState, g: number): boolean {
  const terrain = t.world.terrain[g] ?? 0;
  return terrain >= Terrain.LOW_WATER && terrain <= Terrain.DEEP_WATER;
}

function groundOrWater(t: TacticalState, g: number): Hit {
  return { code: isWaterTile(t, g) ? Collision.WATER : Collision.GROUND, structureId: 0, normal: vec3() };
}

const NO_HIT: Hit = { code: Collision.NONE, structureId: 0, normal: vec3() };

function roofCrossing(oldZ: number, z: number): number {
  if (oldZ > HEIGHT_UNITS && z < HEIGHT_UNITS) return Collision.ROOF;
  if (oldZ < HEIGHT_UNITS && z > HEIGHT_UNITS) return Collision.INTERIOR_ROOF;
  return Collision.NONE;
}

export function checkForCollision(t: TacticalState, x: number, y: number, z: number, dx: number, dy: number, dz: number): Hit {
  const tileX = i16(Math.trunc(f32(x / 10)));
  const tileY = i16(Math.trunc(f32(y / 10)));
  if (tileX < 0 || tileX >= WORLD_COLS || tileY < 0 || tileY >= WORLD_ROWS) return NO_HIT;
  const g = tileX + tileY * WORLD_COLS;
  const oldZ = f32(z - dz);
  const above = Math.trunc(z);
  if (above < 0) return groundOrWater(t, g);
  const list = t.world.structures.at(g);
  if (list.length === 0) return z < 0 ? groundOrWater(t, g) : NO_HIT;
  let cube = Math.trunc(above / CUBE_UNITS);
  if (cube >= 2 * PROFILE_Z_SIZE) return NO_HIT;
  const cellX = (Math.trunc(x) % 10) >> 1;
  const cellY = (Math.trunc(y) % 10) >> 1;
  const cell = cellX * 5 + cellY;
  const desired = cube < PROFILE_Z_SIZE ? 0 : PROFILE_Z_SIZE;
  if (desired === PROFILE_Z_SIZE) cube -= PROFILE_Z_SIZE;
  if (levelTilesAt(t.world.level.layers.roofs, g).length > 0) {
    const roof = roofCrossing(oldZ, z);
    if (roof !== Collision.NONE) return { code: roof, structureId: 0, normal: vec3() };
  }
  for (const s of list) {
    if (s.cubeOffset !== desired) continue;
    const column = s.tile.shape[cell] ?? 0;
    if (!(column & (1 << cube))) continue;
    const id = s.id;
    if (has(s.flags, StructureFlags.WALLNWINDOW) && z >= WINDOW_BOTTOM && z <= WINDOW_TOP) {
      if (s.wallOrientation & ORIENT_RIGHT)
        return { code: dx > 0 ? Collision.WINDOW_SOUTHWEST : Collision.WINDOW_NORTHWEST, structureId: id, normal: vec3() };
      return { code: dy > 0 ? Collision.WINDOW_SOUTHEAST : Collision.WINDOW_NORTHEAST, structureId: id, normal: vec3() };
    }
    if (has(s.flags, StructureFlags.WALLSTUFF)) {
      const positive = dx > 0;
      if (s.wallOrientation & ORIENT_RIGHT)
        return {
          code: positive ? Collision.WALL_SOUTHEAST : Collision.WALL_NORTHEAST,
          structureId: id,
          normal: vec3(positive ? -1 : 1, 0, 0),
        };
      return {
        code: positive ? Collision.WALL_SOUTHWEST : Collision.WALL_NORTHWEST,
        structureId: id,
        normal: vec3(0, positive ? -1 : 1, 0),
      };
    }
    if (!has(s.flags, StructureFlags.TREE) && !has(s.flags, StructureFlags.CORPSE)) {
      const top = landsOnTop(t, g, s.flags, column, cube, desired, cell);
      if (top !== Collision.NONE) return { code: top, structureId: id, normal: vec3() };
    }
    if (s.def.armour !== MATERIAL_LIGHT_VEGETATION && !has(s.flags, StructureFlags.CORPSE))
      return { code: Collision.STRUCTURE, structureId: id, normal: vec3() };
  }
  return NO_HIT;
}

function landsOnTop(t: TacticalState, g: number, flags: number, column: number, cube: number, desired: number, cell: number): number {
  if (cube < PROFILE_Z_SIZE - 1) {
    if (column & (1 << (cube + 1))) return Collision.NONE;
    return has(flags, StructureFlags.ROOF) ? Collision.ROOF : Collision.STRUCTURE_Z;
  }
  if (desired !== 0) return Collision.STRUCTURE_Z;
  for (const other of t.world.structures.at(g)) {
    if (other.cubeOffset === PROFILE_Z_SIZE && !((other.tile.shape[cell] ?? 0) & 1)) return Collision.STRUCTURE_Z;
  }
  return Collision.NONE;
}
