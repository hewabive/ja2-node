// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Physics.h REAL_OBJECT; Explosion_Control.h EXPLOSIONTYPE; SmokeEffects.h SMOKEEFFECT;
// @src LightEffects.h LIGHTEFFECT; Tactical/Soldier_Control.h THROW_PARAMS, SOLDIER_GASSED, fHitByGasFlags,
// @src SOLDIER_MISC_HURT_BY_EXPLOSION; WorldDef.h ubExtFlags.

import type { ExplosionAnimation } from '../../../content/items/explosions.ts';
import { WORLD_MAX } from '../../../content/world/grid.ts';
import type { ItemObject } from '../../items/object.ts';
import type { LightSprite } from '../lighting/lighting.ts';
import { type Soldier, TOTAL_SOLDIERS } from '../soldier.ts';
import type { Vec3 } from './vec3.ts';

export const ThrowAction = { NONE: 0, ARM_ITEM: 1, TARGET_MERC_CATCH: 2 } as const;

export const TestObject = { NONE: 0, NO_COLLISIONS: 1, NOT_WALL_ROOF_COLLISIONS: 3 } as const;

export interface ThrowParams {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly forceX: number;
  readonly forceY: number;
  readonly forceZ: number;
  readonly lifeSpan: number;
  readonly action: number;
  readonly target: Soldier | null;
}

export interface RealObject {
  alive: boolean;
  applyFriction: boolean;
  visible: boolean;
  inWater: boolean;
  testObject: number;
  testEndedWithCollision: boolean;
  testPositionNotSet: boolean;
  testZTarget: number;
  appliedMu: number;
  position: Vec3;
  testTargetPosition: Vec3;
  oldPosition: Vec3;
  velocity: Vec3;
  oldVelocity: Vec3;
  initialForce: Vec3;
  force: Vec3;
  collisionNormal: Vec3;
  collisionVelocity: Vec3;
  collisionElasticity: number;
  gridNo: number;
  consecutiveCollisions: number;
  consecutiveZeroVelocityCollisions: number;
  oldCollisionCode: number;
  readonly lifeLength: number;
  lifeSpan: number;
  readonly object: ItemObject;
  readonly owner: Soldier | null;
  firstGridNo: number;
  firstTimeMoved: boolean;
  readonly action: number;
  readonly target: Soldier | null;
  dropItem: boolean;
  numTilesMoved: number;
  endedWithCollisionPositionSet: boolean;
  endedWithCollisionPosition: Vec3;
  haveHitGround: boolean;
  lastTargetTakenDamage: number;
  levelNode: boolean;
  attemptedCatch: boolean;
  catchAnimOn: boolean;
  catchCheckDone: boolean;
  catchGood: boolean;
}

export interface ExplosionTile {
  readonly kind: 'explosion';
  readonly owner: Soldier | null;
  readonly item: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly gridNo: number;
  readonly level: number;
  readonly animation: ExplosionAnimation;
  readonly delay: number;
  readonly light: LightSprite | null;
  frame: number;
  lastUpdate: number;
}

export interface RippleTile {
  readonly kind: 'ripple';
  readonly owner: Soldier | null;
  readonly item: number;
  readonly x: number;
  readonly y: number;
  readonly gridNo: number;
  frame: number;
  lastUpdate: number;
}

export type AniTile = ExplosionTile | RippleTile;

export const SmokeFlags = { INDOORS: 0x01, ON_ROOF: 0x02, MARK_FOR_UPDATE: 0x04 } as const;

export interface SmokeCloud {
  readonly gridNo: number;
  readonly item: number;
  readonly type: number;
  readonly owner: Soldier | null;
  duration: number;
  radius: number;
  age: number;
  flags: number;
  lastUpdate: number;
}

export interface LightEffect {
  readonly gridNo: number;
  radius: number;
  readonly duration: number;
  age: number;
  lastUpdate: number;
  sprite: LightSprite | null;
}

export interface WorldClockSource {
  readonly seconds: number;
}

const MS_PER_SECOND = 1000;

export interface ExplosivesState {
  readonly objects: (RealObject | null)[];
  readonly aniTiles: AniTile[];
  readonly smokeClouds: (SmokeCloud | null)[];
  readonly lights: (LightEffect | null)[];
  readonly smokeTiles: readonly [Uint8Array, Uint8Array];
  readonly throwParams: Map<number, ThrowParams>;
  readonly hurtByExplosion: Uint8Array;
  readonly hitByGas: Uint8Array;
  readonly gassed: Uint8Array;
  nextPhysicsMs: number;
  worldMs: number;
}

export function createExplosivesState(): ExplosivesState {
  return {
    objects: [],
    aniTiles: [],
    smokeClouds: [],
    lights: [],
    smokeTiles: [new Uint8Array(WORLD_MAX), new Uint8Array(WORLD_MAX)],
    throwParams: new Map(),
    hurtByExplosion: new Uint8Array(TOTAL_SOLDIERS),
    hitByGas: new Uint8Array(TOTAL_SOLDIERS),
    gassed: new Uint8Array(TOTAL_SOLDIERS),
    nextPhysicsMs: 0,
    worldMs: 0,
  };
}

export function worldSeconds(t: { readonly explosives: ExplosivesState; readonly worldClock: WorldClockSource | null }): number {
  return t.worldClock ? t.worldClock.seconds : Math.trunc(t.explosives.worldMs / MS_PER_SECOND);
}

export function explosivesBusy(e: ExplosivesState): boolean {
  return e.objects.some((o) => o !== null) || e.aniTiles.length > 0;
}
