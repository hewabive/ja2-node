// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc LoadExplosionTableFromSavedGameFile, MAX_BOMB_QUEUE;
// @src TileEngine/LoadSaveExplosionType.cc ExtractExplosionTypeFromFile; Explosion_Control.h ExplosionQueueElement;
// @src Tactical/LoadSaveBullet.cc ExtractBulletFromFile, Tactical/Bullets.cc LoadBulletStructureFromSavedGameFile;
// @src TileEngine/LoadSaveRealObject.cc ExtractRealObjectFromFile, TileEngine/Physics.cc LoadPhysicsTableFromSavedGameFile;
// @src Tactical/Interface_Items.cc LoadItemCursorFromSavedGame (2026-11-08).

import { FormatError } from '../binary/errors.ts';
import { decodeObject, OBJECT_RECORD_BYTES, type ObjectRecord } from './object.ts';
import type { SaveCursor } from './savegame-cursor.ts';

export const MAX_BOMB_QUEUE = 40;
const QUEUE_COUNT_PADDING = 3;
const QUEUE_ENTRY_BYTES = 12;
const QUEUE_ENTRY_PADDING = 3;
const EXPLOSION_RECORD_BYTES = 36;
const EXPLOSION_HEAD_PADDING = 4;
const EXPLOSION_GRID_PADDING = 1;
const EXPLOSION_LEVEL_PADDING = 2;
const EXPLOSION_ALLOCATED_PADDING = 1;
const EXPLOSION_TAIL_PADDING = 12;

export interface SavedQueuedBomb {
  readonly worldBombIndex: number;
  readonly timestamp: number;
  readonly exists: boolean;
}

export interface SavedExplosion {
  readonly ownerId: number;
  readonly animationId: number;
  readonly item: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly gridNo: number;
  readonly level: number;
  readonly frame: number;
}

export interface SavedExplosionTable {
  readonly queue: readonly SavedQueuedBomb[];
  readonly explosions: readonly SavedExplosion[];
}

export const NO_SAVED_EXPLOSIONS: SavedExplosionTable = { queue: [], explosions: [] };

function readQueuedBomb(c: SaveCursor): SavedQueuedBomb {
  const start = c.pos;
  const entry = { worldBombIndex: c.u32(), timestamp: c.u32(), exists: c.bool() };
  c.skip(QUEUE_ENTRY_PADDING);
  c.expectConsumed(start, QUEUE_ENTRY_BYTES, 'ExplosionQueueElement');
  return entry;
}

function readExplosion(c: SaveCursor): SavedExplosion {
  const start = c.pos;
  c.skip(EXPLOSION_HEAD_PADDING);
  const head = { ownerId: c.u8(), animationId: c.u8(), item: c.u16(), x: c.i16(), y: c.i16(), z: c.i16(), gridNo: c.i16() };
  c.skip(EXPLOSION_GRID_PADDING);
  const level = c.i8();
  c.skip(EXPLOSION_LEVEL_PADDING);
  c.bool();
  c.skip(EXPLOSION_ALLOCATED_PADDING);
  const frame = c.i16();
  c.skip(EXPLOSION_TAIL_PADDING);
  c.expectConsumed(start, EXPLOSION_RECORD_BYTES, 'EXPLOSIONTYPE');
  return { ...head, level, frame };
}

export function readExplosionTable(c: SaveCursor): SavedExplosionTable {
  const elements = c.u8();
  c.skip(QUEUE_COUNT_PADDING);
  if (elements > MAX_BOMB_QUEUE) throw new FormatError(`explosion queue: ${elements} elements, at most ${MAX_BOMB_QUEUE}`);
  const slots = Array.from({ length: MAX_BOMB_QUEUE }, () => readQueuedBomb(c));
  const explosions = Array.from({ length: c.u32() }, () => readExplosion(c));
  return { queue: slots.slice(0, elements), explosions };
}

const BULLET_RECORD_BYTES = 128;
const BULLET_HEAD_PADDING = 4;
const BULLET_GRID_PADDING = 2;
const BULLET_ROOF_PADDING = 1;
const ALLOCATED_FLAG_BYTES = 1;
const BULLET_FLAGS_PADDING = 3;
const LAST_UPDATE_BYTES = 4;
const TILES_PER_UPDATE_PADDING = 1;
const CLOCK_TICKS_PADDING = 4;
const HIT_BY_PADDING = 2;
const BULLET_USFLAGS_PADDING = 2;
const ANI_TILE_POINTERS_BYTES = 8;
const BULLET_TAIL_PADDING = 3;

export interface SavedBullet {
  readonly firerId: number;
  readonly targetId: number;
  readonly startCubesAbove: number;
  readonly endCubesAbove: number;
  readonly gridNo: number;
  readonly lastStructureHit: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly incX: number;
  readonly incY: number;
  readonly incZ: number;
  readonly horizAngle: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly losX: number;
  readonly losY: number;
  readonly checkForRoof: boolean;
  readonly cubesZ: number;
  readonly loop: number;
  readonly toDelete: boolean;
  readonly located: boolean;
  readonly real: boolean;
  readonly aimed: boolean;
  readonly tilesPerUpdate: number;
  readonly msPerUpdate: number;
  readonly targetGrid: number;
  readonly hitBy: number;
  readonly impact: number;
  readonly impactReduction: number;
  readonly range: number;
  readonly distanceLimit: number;
  readonly flags: number;
  readonly itemStatus: number;
}

function readBullet(c: SaveCursor): SavedBullet {
  const start = c.pos;
  c.skip(BULLET_HEAD_PADDING);
  const who = { firerId: c.u8(), targetId: c.u8(), startCubesAbove: c.i8(), endCubesAbove: c.i8(), gridNo: c.u32() };
  c.skip(BULLET_GRID_PADDING);
  const lastStructureHit = c.u16();
  const position = { x: c.i32(), y: c.i32(), z: c.i32(), incX: c.i32(), incY: c.i32(), incZ: c.i32(), horizAngle: c.f64() };
  const tile = { tileX: c.i32(), tileY: c.i32(), losX: c.i8(), losY: c.i8(), checkForRoof: c.bool() };
  c.skip(BULLET_ROOF_PADDING);
  const steps = { cubesZ: c.i32(), loop: c.i32() };
  c.skip(ALLOCATED_FLAG_BYTES);
  const state = { toDelete: c.bool(), located: c.bool(), real: c.bool(), aimed: c.bool() };
  c.skip(BULLET_FLAGS_PADDING + LAST_UPDATE_BYTES);
  const tilesPerUpdate = c.u8();
  c.skip(TILES_PER_UPDATE_PADDING);
  const msPerUpdate = c.u16();
  c.skip(CLOCK_TICKS_PADDING);
  const targetGrid = c.u32();
  const hitBy = c.i16();
  c.skip(HIT_BY_PADDING);
  const force = { impact: c.i32(), impactReduction: c.i32(), range: c.i32(), distanceLimit: c.i32() };
  const flags = c.u16();
  c.skip(BULLET_USFLAGS_PADDING + ANI_TILE_POINTERS_BYTES);
  const itemStatus = c.u8();
  c.skip(BULLET_TAIL_PADDING);
  c.expectConsumed(start, BULLET_RECORD_BYTES, 'BULLET');
  return {
    ...who,
    lastStructureHit,
    ...position,
    ...tile,
    ...steps,
    ...state,
    tilesPerUpdate,
    msPerUpdate,
    targetGrid,
    hitBy,
    ...force,
    flags,
    itemStatus,
  };
}

export function readBullets(c: SaveCursor): SavedBullet[] {
  return Array.from({ length: c.u32() }, () => readBullet(c));
}

const REAL_OBJECT_RECORD_BYTES = 256;
const FRICTION_PADDING = 2;
const TEST_FLAGS_PADDING = 2;
const ONE_OVER_MASS_BYTES = 4;
const OBJECT_GRID_PADDING = 6;
const LEVEL_NODE_POINTERS_BYTES = 8;
const FIRST_MOVE_PADDING = 1;
const ACTION_PADDING = 2;
const TARGET_PADDING = 3;
const DROP_ITEM_PADDING = 3;
const CATCH_FLAGS_PADDING = 3;
const DEBUG_FLAG_BYTES = 1;
const LEVEL_NODE_GRID_BYTES = 2;
const SOUND_ID_BYTES = 4;
const OBJECT_TAIL_PADDING = 3;

export interface SavedVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SavedRealObject {
  readonly alive: boolean;
  readonly applyFriction: boolean;
  readonly visible: boolean;
  readonly inWater: boolean;
  readonly testObject: number;
  readonly testEndedWithCollision: boolean;
  readonly testPositionNotSet: boolean;
  readonly testZTarget: number;
  readonly appliedMu: number;
  readonly position: SavedVector;
  readonly testTargetPosition: SavedVector;
  readonly oldPosition: SavedVector;
  readonly velocity: SavedVector;
  readonly oldVelocity: SavedVector;
  readonly initialForce: SavedVector;
  readonly force: SavedVector;
  readonly collisionNormal: SavedVector;
  readonly collisionVelocity: SavedVector;
  readonly collisionElasticity: number;
  readonly gridNo: number;
  readonly consecutiveCollisions: number;
  readonly consecutiveZeroVelocityCollisions: number;
  readonly oldCollisionCode: number;
  readonly lifeLength: number;
  readonly lifeSpan: number;
  readonly object: ObjectRecord;
  readonly firstTimeMoved: boolean;
  readonly firstGridNo: number;
  readonly ownerId: number;
  readonly action: number;
  readonly targetId: number;
  readonly dropItem: boolean;
  readonly numTilesMoved: number;
  readonly catchGood: boolean;
  readonly attemptedCatch: boolean;
  readonly catchAnimOn: boolean;
  readonly catchCheckDone: boolean;
  readonly endedWithCollisionPositionSet: boolean;
  readonly endedWithCollisionPosition: SavedVector;
  readonly haveHitGround: boolean;
  readonly lastTargetTakenDamage: number;
}

function readVector(c: SaveCursor): SavedVector {
  return { x: c.f32(), y: c.f32(), z: c.f32() };
}

function readObjectRecord(c: SaveCursor): ObjectRecord {
  return decodeObject(c.view(OBJECT_RECORD_BYTES), 0);
}

function readRealObject(c: SaveCursor): SavedRealObject {
  const start = c.pos;
  c.skip(ALLOCATED_FLAG_BYTES);
  const motion = { alive: c.bool(), applyFriction: c.bool() };
  c.skip(FRICTION_PADDING);
  const test = {
    visible: c.bool(),
    inWater: c.bool(),
    testObject: c.i8(),
    testEndedWithCollision: c.bool(),
    testPositionNotSet: c.bool(),
  };
  c.skip(TEST_FLAGS_PADDING);
  const testZTarget = c.f32();
  c.skip(ONE_OVER_MASS_BYTES);
  const vectors = {
    appliedMu: c.f32(),
    position: readVector(c),
    testTargetPosition: readVector(c),
    oldPosition: readVector(c),
    velocity: readVector(c),
    oldVelocity: readVector(c),
    initialForce: readVector(c),
    force: readVector(c),
    collisionNormal: readVector(c),
    collisionVelocity: readVector(c),
    collisionElasticity: c.f32(),
    gridNo: c.i16(),
  };
  c.skip(OBJECT_GRID_PADDING + LEVEL_NODE_POINTERS_BYTES);
  const collisions = {
    consecutiveCollisions: c.i16(),
    consecutiveZeroVelocityCollisions: c.i16(),
    oldCollisionCode: c.i32(),
    lifeLength: c.f32(),
    lifeSpan: c.f32(),
    object: readObjectRecord(c),
    firstTimeMoved: c.bool(),
  };
  c.skip(FIRST_MOVE_PADDING);
  const throwing = { firstGridNo: c.i16(), ownerId: c.u8(), action: c.u8() };
  c.skip(ACTION_PADDING);
  const targetId = c.u8();
  c.skip(TARGET_PADDING);
  const dropItem = c.bool();
  c.skip(DROP_ITEM_PADDING);
  const catching = {
    numTilesMoved: c.u32(),
    catchGood: c.bool(),
    attemptedCatch: c.bool(),
    catchAnimOn: c.bool(),
    catchCheckDone: c.bool(),
    endedWithCollisionPositionSet: c.bool(),
  };
  c.skip(CATCH_FLAGS_PADDING);
  const ending = { endedWithCollisionPosition: readVector(c), haveHitGround: c.bool() };
  c.skip(DEBUG_FLAG_BYTES + LEVEL_NODE_GRID_BYTES + SOUND_ID_BYTES);
  const lastTargetTakenDamage = c.u8();
  c.skip(OBJECT_TAIL_PADDING);
  c.expectConsumed(start, REAL_OBJECT_RECORD_BYTES, 'REAL_OBJECT');
  return {
    ...motion,
    ...test,
    testZTarget,
    ...vectors,
    ...collisions,
    ...throwing,
    targetId,
    dropItem,
    ...catching,
    ...ending,
    lastTargetTakenDamage,
  };
}

export function readRealObjects(c: SaveCursor): SavedRealObject[] {
  return Array.from({ length: c.u32() }, () => readRealObject(c));
}

const ITEM_CURSOR_BYTES = 44;
const ITEM_CURSOR_TAIL_PADDING = 5;

export interface SavedItemCursor {
  readonly object: ObjectRecord;
  readonly holderId: number;
  readonly sourceSlot: number;
  readonly active: boolean;
}

export function readItemCursor(c: SaveCursor): SavedItemCursor {
  const start = c.pos;
  const cursor = { object: readObjectRecord(c), holderId: c.u8(), sourceSlot: c.i8(), active: c.bool() };
  c.skip(ITEM_CURSOR_TAIL_PADDING);
  c.expectConsumed(start, ITEM_CURSOR_BYTES, 'item cursor');
  return cursor;
}
