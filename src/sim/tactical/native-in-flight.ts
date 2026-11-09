// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Bullets.cc LoadBulletStructureFromSavedGameFile (the saved bullets in slot order, the firer and
// @src target by id, uiLastUpdate 0, HandleBulletSpecialFlags); TileEngine/Physics.cc LoadPhysicsTableFromSavedGameFile
// @src (the saved objects in slot order) with TileEngine/LoadSaveRealObject.cc ExtractRealObjectFromFile (the owner and
// @src target by id, no level node, which PhysicsMoveObject takes for an object not yet drawn).

import type { SavedBullet, SavedRealObject, SavedVector } from '../../content/formats/savegame-effects.ts';
import { objectFromRecord } from '../items/object.ts';
import { type Bullet, handleBulletSpecialFlags } from './combat/bullets.ts';
import { NO_TARGET_TAKEN_DAMAGE } from './explosions/physics.ts';
import type { RealObject } from './explosions/state.ts';
import { type Vec3, vec3 } from './explosions/vec3.ts';
import { soldierOfSavedId } from './native-temp-files.ts';
import { type Soldier, TOTAL_SOLDIERS } from './soldier.ts';
import type { TacticalState } from './state.ts';

const NOBODY = TOTAL_SOLDIERS;
const LOADED_LAST_UPDATE = 0;

export function loadBulletTable(t: TacticalState, saved: readonly SavedBullet[]): void {
  t.bullets.length = 0;
  for (const b of saved) {
    const firer = soldierOfSavedId(t, b.firerId);
    if (!firer) continue;
    const bullet = savedBullet(t, b, firer);
    handleBulletSpecialFlags(bullet);
    t.bullets.push(bullet);
  }
}

function savedBullet(t: TacticalState, b: SavedBullet, firer: Soldier): Bullet {
  return {
    firer,
    real: b.real,
    flags: b.flags,
    target: soldierOfSavedId(t, b.targetId),
    hitBy: b.hitBy,
    checkForRoof: b.checkForRoof,
    incX: b.incX,
    incY: b.incY,
    incZ: b.incZ,
    x: b.x,
    y: b.y,
    z: b.z,
    tileX: b.tileX,
    tileY: b.tileY,
    losX: b.losX,
    losY: b.losY,
    cubesZ: b.cubesZ,
    loop: b.loop,
    impactReduction: b.impactReduction,
    impact: b.impact,
    range: b.range,
    targetGrid: b.targetGrid,
    startCubesAbove: b.startCubesAbove,
    endCubesAbove: b.endCubesAbove,
    distanceLimit: b.distanceLimit,
    gridNo: b.gridNo,
    horizAngle: b.horizAngle,
    aimed: b.aimed,
    itemStatus: b.itemStatus,
    msPerUpdate: b.msPerUpdate,
    lastUpdate: LOADED_LAST_UPDATE,
    tilesPerUpdate: b.tilesPerUpdate,
    toDelete: b.toDelete,
    located: b.located,
    lastStructureHit: b.lastStructureHit,
  };
}

export function loadPhysicsTable(t: TacticalState, saved: readonly SavedRealObject[]): void {
  const slots = t.explosives.objects;
  slots.length = 0;
  for (const o of saved) slots.push(savedRealObject(t, o));
}

function vector(v: SavedVector): Vec3 {
  return vec3(v.x, v.y, v.z);
}

function lastTargetTakenDamage(id: number): number {
  return id === NOBODY ? NO_TARGET_TAKEN_DAMAGE : id;
}

function savedRealObject(t: TacticalState, o: SavedRealObject): RealObject {
  return {
    alive: o.alive,
    applyFriction: o.applyFriction,
    visible: o.visible,
    inWater: o.inWater,
    testObject: o.testObject,
    testEndedWithCollision: o.testEndedWithCollision,
    testPositionNotSet: o.testPositionNotSet,
    testZTarget: o.testZTarget,
    appliedMu: o.appliedMu,
    position: vector(o.position),
    testTargetPosition: vector(o.testTargetPosition),
    oldPosition: vector(o.oldPosition),
    velocity: vector(o.velocity),
    oldVelocity: vector(o.oldVelocity),
    initialForce: vector(o.initialForce),
    force: vector(o.force),
    collisionNormal: vector(o.collisionNormal),
    collisionVelocity: vector(o.collisionVelocity),
    collisionElasticity: o.collisionElasticity,
    gridNo: o.gridNo,
    consecutiveCollisions: o.consecutiveCollisions,
    consecutiveZeroVelocityCollisions: o.consecutiveZeroVelocityCollisions,
    oldCollisionCode: o.oldCollisionCode,
    lifeLength: o.lifeLength,
    lifeSpan: o.lifeSpan,
    object: objectFromRecord(o.object),
    owner: soldierOfSavedId(t, o.ownerId),
    firstGridNo: o.firstGridNo,
    firstTimeMoved: o.firstTimeMoved,
    action: o.action,
    target: soldierOfSavedId(t, o.targetId),
    dropItem: o.dropItem,
    numTilesMoved: o.numTilesMoved,
    endedWithCollisionPositionSet: o.endedWithCollisionPositionSet,
    endedWithCollisionPosition: vector(o.endedWithCollisionPosition),
    haveHitGround: o.haveHitGround,
    lastTargetTakenDamage: lastTargetTakenDamage(o.lastTargetTakenDamage),
    levelNode: false,
    attemptedCatch: o.attemptedCatch,
    catchAnimOn: o.catchAnimOn,
    catchCheckDone: o.catchCheckDone,
    catchGood: o.catchGood,
  };
}
