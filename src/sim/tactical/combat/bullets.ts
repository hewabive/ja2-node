// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LOS.cc FireBulletGivenTarget, CalculateFiringIncrements, FireBullet, MoveBullet,
// @src ChanceOfBulletHittingStructure, StructureResistanceIncreasedByRange, HandleBulletStructureInteraction,
// @src CTGTHandleBulletStructureInteraction, CalcChanceToGetThrough, *ChanceToGetThrough; Bullets.cc CreateBullet,
// @src RemoveBullet, StopBullet, UpdateBullets, AddMissileTrail (fGoingOver is never reset within one MoveBullet);
// @src Weapons.cc StructureHit, ShotMiss, WindowHit;
// @src TileEngine/Tile_Animation.cc ANITILE_RELEASE_ATTACKER_WHEN_DONE.

import { lockAt } from '../../../content/formats/locks.ts';
import { AmmoType, ItemClass, WeaponClass } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, pythSpacesAway, WORLD_COLS, WORLD_ROWS } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import {
  has,
  INVALID_STRUCTURE_ID,
  ORIENT_RIGHT,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  type StructureInstance,
  structureHeight,
} from '../../../content/world/structures.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { i16, i32, idiv, u8, u32 } from '../../../core/int.ts';
import type { MissileTrail } from '../../events.ts';
import { createItem, type ItemObject } from '../../items/object.ts';
import { AnimHeight, endHeight } from '../animation.ts';
import { findDoorInfo } from '../doors/door-table.ts';
import { damageLock } from '../doors/lock-attempts.ts';
import { igniteExplosion, igniteExplosionXY } from '../explosions/explosion.ts';
import { windowHit } from '../explosions/structure-damage.ts';
import { InvSlot } from '../inventory.ts';
import { landHeightUnits, resolveHitOnWall } from '../perception/los.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import { atan8 } from '../perception/opp.ts';
import { StatKind } from '../profiles.ts';
import { Body, NO_PROFILE, type Soldier, Team } from '../soldier.ts';
import { onVisibleWorldTile, type TacticalState, whoIsThere } from '../state.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { freeUpAttacker } from './barrier.ts';
import { gunRange } from './chance.ts';
import { agilityForEnemyMissingPlayer, StatCause, statChange } from './experience.ts';
import { bulletHitMerc, doSpecialEffectAmmoMiss, type ImpactPoint } from './hit.ts';
import { aimPosType, calculateSoldierZPos, losWorldOf, targetZFromStructureHeight, ZPos } from './positions.ts';
import { NUM_BUCKSHOT_PELLETS } from './types.ts';

export const BulletFlag = {
  CREATURE_SPIT: 0x0001,
  KNIFE: 0x0002,
  MISSILE: 0x0004,
  SMALL_MISSILE: 0x0008,
  STOPPED: 0x0010,
  TANK_CANNON: 0x0020,
  BUCKSHOT: 0x0040,
  FLAME: 0x0080,
  BLOODY: 0x0100,
} as const;

const NUM_BULLET_SLOTS = 50;
const FIX = 1 << 20;
const TEN = 10 * FIX;
const WALL_HEIGHT_UNITS = 256;
const WALL_HEIGHT_PIXELS = 50;
const ROOF_HIT_ADJUSTMENT = 2;
const WALL = 256 * FIX;
const WIN_LO = 87 * FIX;
const WIN_HI = 220 * FIX;
const PROFILE_Z_SIZE = 4;
const STRUCTURE_ON_GROUND_MAX = 4;
const STRUCTURE_ON_ROOF_MAX = 8;
const CLOSE_TO_FIRER = 25;
const MIN_DIST_FOR_HIT_FRIENDS = 30;
const MIN_DIST_FOR_HIT_FRIENDS_UNAIMED = 15;
const LOCK_SHOT_RADIUS = 2;
const SHOOTABLE_PICK_LIMIT = 50;
const SHOOTABLE_SMASH_LIMIT = 70;
const LOCK_SHOT_MARKSMANSHIP_GAIN = 10;
const MIN_CHANCE_TO_ACCIDENTALLY_HIT_SOMEONE = 3;
const MAX_DIST_FOR_LESS_THAN_MAX_CHANCE = 25;
const MAX_CHANCE_OF_HITTING_STRUCTURE = 90;
const PERCENT_BULLET_SLOWED_BY_RANGE = 25;
const MATERIAL_LIGHT_VEGETATION = 4;
const MATERIAL_INDESTRUCTABLE_STONE = 24;
const MATERIAL_INDESTRUCTABLE_METAL = 25;
const MISS_ANIM_MS = 425;
const GROUND_LEVEL = 0;
const NO_FLAGS = 0;
const LEVEL_HEIGHT = 0;
const PI = 3.1415926;
const RADIANS_IN_CIRCLE = 6.283;
const DEGREES_22_5 = (RADIANS_IN_CIRCLE * 22.5) / 360;
const DEGREES_45 = (RADIANS_IN_CIRCLE * 45) / 360;
const MAX_AIMING_SCREWUP = (RADIANS_IN_CIRCLE * 15) / 360;
const MIN_AIMING_SCREWUP = (RADIANS_IN_CIRCLE * 22) / 360;
const ALWAYS_CONSIDER_HIT = StructureFlags.WALLSTUFF | StructureFlags.CAVEWALL | StructureFlags.FENCE;
const SPECIAL_BULLETS =
  BulletFlag.MISSILE | BulletFlag.SMALL_MISSILE | BulletFlag.TANK_CANNON | BulletFlag.FLAME | BulletFlag.CREATURE_SPIT;
const STRUCTURE_HIT_CHANCE = [0, 0, 0, 2, 4, 7, 10, 14, 18, 23, 28, 34, 40, 47, 54, 60, 66, 71, 74, 76, 78, 80, 82, 84, 86, 88];
const SHOTGUN_SPREAD: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 0],
    [-0.012, 0],
    [0.012, 0],
    [0, -0.012],
    [0, 0.012],
    [-0.008, -0.008],
    [-0.008, 0.008],
    [0.008, -0.008],
    [0.008, 0.008],
  ],
  [
    [0, 0],
    [-0.008, 0],
    [0.008, 0],
    [-0.016, 0],
    [0.016, 0],
    [-0.024, 0],
    [0.024, 0],
    [-0.032, 0],
    [0.032, 0],
  ],
  [
    [0, 0],
    [-0.12, 0],
    [0.12, 0],
    [0, -0.12],
    [0, 0.12],
    [-0.08, -0.08],
    [-0.08, 0.08],
    [0.08, -0.08],
    [0.08, 0.08],
  ],
];

export interface Bullet {
  readonly firer: Soldier;
  readonly real: boolean;
  flags: number;
  target: Soldier | null;
  hitBy: number;
  checkForRoof: boolean;
  incX: number;
  incY: number;
  incZ: number;
  x: number;
  y: number;
  z: number;
  tileX: number;
  tileY: number;
  losX: number;
  losY: number;
  cubesZ: number;
  loop: number;
  impactReduction: number;
  impact: number;
  range: number;
  targetGrid: number;
  startCubesAbove: number;
  endCubesAbove: number;
  distanceLimit: number;
  gridNo: number;
  horizAngle: number;
  aimed: boolean;
  itemStatus: number;
  msPerUpdate: number;
  lastUpdate: number;
  tilesPerUpdate: number;
  toDelete: boolean;
  lastStructureHit: number;
}

export interface MissAnimation {
  readonly bullet: Bullet;
  readonly releaseAt: number;
}

const f32 = Math.fround;
const toFix = (f: number) => Math.trunc(f32(f) * FIX);
const fixInt = (q: number) => idiv(q, FIX);

export function bulletWorldXY(b: Bullet): { readonly x: number; readonly y: number } {
  return { x: fixInt(b.x), y: fixInt(b.y) };
}

export function drawnInFlight(b: Bullet): boolean {
  return b.real && !b.toDelete && (b.flags & (BulletFlag.STOPPED | SPECIAL_BULLETS)) === 0;
}

export function isKnife(b: Bullet): boolean {
  return (b.flags & BulletFlag.KNIFE) !== 0;
}

const DIRECTION_SCALE = 100;

export function knifeDirection(b: Bullet): number {
  const toward = (inc: number) => Math.trunc(f32(f32(inc / FIX) * DIRECTION_SCALE));
  return atan8(0, 0, toward(b.incX), toward(b.incY));
}

export function bulletHeightPixels(b: Bullet): number {
  return idiv(fixInt(b.z) * WALL_HEIGHT_PIXELS, WALL_HEIGHT_UNITS);
}
const tileOf = (q: number) => idiv(fixInt(q), 10);
const cellOf = (q: number) => (fixInt(q) % 10) >> 1;
const cubeOf = (heightUnits: number) => idiv(heightUnits, 64);
const centre = (g: number) => ({ x: (g % WORLD_COLS) * 10 + 5, y: idiv(g, WORLD_COLS) * 10 + 5 });
const landHU = (t: TacticalState, g: number) => landHeightUnits(losWorldOf(t), g);
const tileHeightPixels = (t: TacticalState, g: number) => t.world.level.heights[g] ?? 0;
const rowColToPos = (row: number, col: number) => (row < 0 || row >= 160 || col < 0 || col >= WORLD_COLS ? 0xffff : row * WORLD_COLS + col);
const ammoTypeOf = (b: Bullet) => b.firer.inv[b.firer.attackingHand]?.gunAmmoType ?? AmmoType.REGULAR;
const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;

function createBullet(t: TacticalState, firer: Soldier, fake: boolean, flags: number): Bullet | null {
  if (!fake && t.bullets.filter((b) => !b.toDelete).length >= NUM_BULLET_SLOTS) return null;
  return {
    firer,
    real: !fake,
    flags,
    target: null,
    hitBy: 0,
    checkForRoof: false,
    incX: 0,
    incY: 0,
    incZ: 0,
    x: 0,
    y: 0,
    z: 0,
    tileX: 0,
    tileY: 0,
    losX: 0,
    losY: 0,
    cubesZ: 0,
    loop: 0,
    impactReduction: 0,
    impact: 0,
    range: 0,
    targetGrid: 0,
    startCubesAbove: 0,
    endCubesAbove: 0,
    distanceLimit: 0,
    gridNo: 0,
    horizAngle: 0,
    aimed: false,
    itemStatus: 0,
    msPerUpdate: 0,
    lastUpdate: 0,
    tilesPerUpdate: 1,
    toDelete: false,
    lastStructureHit: 0,
  };
}

export function removeBullet(t: TacticalState, b: Bullet): void {
  if (!b.real) return;
  b.toDelete = true;
  b.firer.bulletsLeft--;
  void t;
}

function stopBullet(b: Bullet): void {
  b.flags |= BulletFlag.STOPPED;
}

function calculateFiringIncrements(t: TacticalState, hIn: number, vIn: number, d2: number, b: Bullet): [number, number] {
  let h = hIn;
  let v = vIn;
  const missedBy = -b.hitBy;
  if (missedBy > 0) {
    const vertPct = t.pre.int(50);
    const av = Math.abs(v);
    const above =
      av < DEGREES_22_5
        ? 60 + Math.trunc((20 * av) / DEGREES_22_5)
        : av < DEGREES_45
          ? 80 - Math.trunc((30 * (av - DEGREES_22_5)) / DEGREES_22_5)
          : 50;
    let limit = d2 / 10 / 200;
    if (limit > MAX_AIMING_SCREWUP / 2) limit = MAX_AIMING_SCREWUP / 2;
    const maxMiss = MAX_AIMING_SCREWUP - limit;
    let minMiss = MIN_AIMING_SCREWUP / (d2 / 10);
    if (minMiss > maxMiss) minMiss = maxMiss;
    const amount = ((maxMiss - minMiss) * missedBy) / 100 + minMiss;
    if (t.pre.int(2)) h += (amount * (100 - vertPct)) / 100;
    else h -= (amount * (100 - vertPct)) / 100;
    if (t.pre.int(100) < above) v += (amount * vertPct) / 100;
    else v -= (amount * vertPct) / 100;
  }
  b.incX = toFix(Math.cos(h));
  b.incY = toFix(Math.sin(h));
  b.incZ = toFix((Math.sin(v) / Math.sin(PI / 2 - v)) * 2.56);
  return [h, v];
}

function fireBullet(t: TacticalState, b: Bullet, fake: boolean): number {
  b.tileX = idiv(fixInt(b.x), 10);
  b.tileY = idiv(fixInt(b.y), 10);
  b.losX = (fixInt(b.x) % 10) >> 1;
  b.losY = (fixInt(b.y) % 10) >> 1;
  b.cubesZ = cubeOf(fixInt(b.z));
  b.loop = 1;
  b.impactReduction = 0;
  b.gridNo = rowColToPos(b.tileY, b.tileX);
  const firer = b.firer;
  if (fake) {
    b.target = firer.ctgtTarget;
    return calcChanceToGetThrough(t, b);
  }
  b.target = firer.target;
  b.lastUpdate = 0;
  b.tilesPerUpdate = 1;
  if (firer.profile !== NO_PROFILE && firer.team === Team.OUR && firer.target && firer.target.life > 0) firer.shotsFired++;
  const knife = t.content.items.byIndex.get(firer.attackingWeapon)?.itemClass === ItemClass.THROWING_KNIFE;
  b.msPerUpdate = knife ? 30 : idiv(t.content.items.byIndex.get(firer.attackingWeapon)?.weapon?.bulletSpeed ?? 0, 10);
  if (b.flags & BulletFlag.KNIFE) b.itemStatus = firer.inv[InvSlot.HAND]?.status[0] ?? 0;
  t.bullets.push(b);
  moveBullet(t, b);
  return 1;
}

export function fireBulletGivenTarget(
  t: TacticalState,
  firer: Soldier,
  endX: number,
  endY: number,
  endZ: number,
  item: number,
  hitByIn: number,
  buckshot: boolean,
  fake: boolean,
): number {
  const items = t.content.items;
  let hitBy = hitByIn;
  const startZ = calculateSoldierZPos(t, firer, ZPos.FIRING);
  const start = centre(firer.gridNo);
  const sx = f32(start.x);
  const sy = f32(start.y);
  const dx = f32(endX - sx);
  const dy = f32(endY - sy);
  const dz = f32(endZ - startZ);
  let d2 = f32(Math.hypot(dx, dy));
  let dist = Math.trunc(d2);
  if (d2 !== dist) {
    dist += 1;
    d2 = f32(dist);
  }
  const h0 = Math.atan2(dy, dx);
  const v0 = Math.atan2(dz, f32(d2 * f32(2.56)));
  let shots = 1;
  let spreadIndex = 0;
  let flags = 0;
  const def = items.byIndex.get(item);
  const weapon = def?.weapon;
  if (weapon?.monsterCalibre) flags |= BulletFlag.CREATURE_SPIT;
  else if (def?.itemClass === ItemClass.THROWING_KNIFE) {
    flags |= BulletFlag.KNIFE;
    if (item === itemIndex(t, 'BLOODY_THROWING_KNIFE')) flags |= BulletFlag.BLOODY;
  } else if (item === itemIndex(t, 'ROCKET_LAUNCHER')) flags |= BulletFlag.MISSILE;
  else if (item === itemIndex(t, 'TANK_CANNON')) flags |= BulletFlag.TANK_CANNON;
  else if (item === itemIndex(t, 'ROCKET_RIFLE') || item === itemIndex(t, 'AUTO_ROCKET_RIFLE')) flags |= BulletFlag.SMALL_MISSILE;
  else if (item === itemIndex(t, 'FLAMETHROWER')) {
    flags |= BulletFlag.FLAME;
    spreadIndex = 2;
  }
  let impact = weapon?.impact ?? 0;
  if (buckshot) {
    if (!fake) {
      shots = NUM_BUCKSHOT_PELLETS;
      if (hitBy > 0) hitBy = idiv(hitBy, 2);
      const gun = firer.inv[firer.attackingHand];
      if (gun?.attachments.some((a) => a.item === itemIndex(t, 'DUCKBILL'))) spreadIndex = 1;
      if (firer.target) firer.target.numPelletsHitBy = 0;
      flags |= BulletFlag.BUCKSHOT;
    }
    impact = idiv(impact, 4);
  }
  let adjH = h0;
  let adjV = v0;
  for (let k = 0; k < shots; k++) {
    const b = createBullet(t, firer, fake, flags);
    if (!b) return 0;
    b.hitBy = hitBy;
    const wallZ = WALL_HEIGHT_UNITS + ROOF_HIT_ADJUSTMENT + idiv(tileHeightPixels(t, firer.gridNo) * 256, 50);
    b.checkForRoof = startZ < wallZ ? endZ > startZ : endZ < startZ;
    let h: number;
    if (k === 0) {
      h = h0;
      if (hitBy > 0) {
        b.incX = toFix(f32(dx / f32(dist)));
        b.incY = toFix(f32(dy / f32(dist)));
        b.incZ = toFix(f32(dz / f32(dist)));
        adjH = h0;
        adjV = v0;
      } else [adjH, adjV] = calculateFiringIncrements(t, h0, v0, d2, b);
    } else {
      b.hitBy = 0;
      const spread = SHOTGUN_SPREAD[spreadIndex]?.[k] ?? [0, 0];
      h = adjH + spread[0];
      calculateFiringIncrements(t, h, adjV + spread[1], d2, b);
      b.hitBy = hitBy;
    }
    b.horizAngle = h;
    b.aimed = k === 0 && firer.doBurst < 2;
    if (b.flags & BulletFlag.KNIFE) b.itemStatus = firer.inv[firer.attackingHand]?.status[0] ?? 0;
    b.x = toFix(sx) + b.incX;
    b.y = toFix(sy) + b.incY;
    b.z = toFix(startZ) + b.incZ;
    if (b.hitBy > 0) {
      b.x += idiv(toFix(dx) - b.incX * dist, 2);
      b.y += idiv(toFix(dy) - b.incY * dist, 2);
      b.z += idiv(toFix(dz) - b.incZ * dist, 2);
    }
    b.impact = impact;
    b.range = gunRange(items, firer.inv[firer.attackingHand] as ItemObject);
    b.targetGrid = idiv(Math.trunc(endX), 10) + idiv(Math.trunc(endY), 10) * WORLD_COLS;
    b.startCubesAbove = cubeOf(Math.trunc(startZ) - landHU(t, firer.gridNo));
    b.endCubesAbove = cubeOf(Math.trunc(endZ) - landHU(t, b.targetGrid));
    b.distanceLimit = dist;
    if (fake) return fireBullet(t, b, true);
    fireBullet(t, b, false);
  }
  return 1;
}

export function chanceOfBulletHittingStructure(distanceIn: number, toTarget: number, hitBy: number): number {
  let distance = distanceIn;
  if (idiv(distance, 10) > MAX_DIST_FOR_LESS_THAN_MAX_CHANCE) return MAX_CHANCE_OF_HITTING_STRUCTURE;
  let penalty = idiv(distance, 5) - (toTarget - distance);
  if (penalty < 0) penalty = 0;
  if (hitBy < 0) distance += idiv(distance, 5);
  const index = idiv(distance + penalty, 10);
  if (index > MAX_DIST_FOR_LESS_THAN_MAX_CHANCE) return MAX_CHANCE_OF_HITTING_STRUCTURE;
  return STRUCTURE_HIT_CHANCE[index] ?? MAX_CHANCE_OF_HITTING_STRUCTURE;
}

function structureResistanceIncreasedByRange(reduction: number, range: number, distance: number): number {
  return idiv(reduction * (100 + idiv(PERCENT_BULLET_SLOWED_BY_RANGE * (distance - range), range)), 100);
}

function ammoAdjustedReduction(reduction: number, ammo: number, heatCountsAsAP: boolean): number {
  if (ammo === AmmoType.HP) return reduction * 2;
  if (ammo === AmmoType.AP || (heatCountsAsAP && ammo === AmmoType.HEAT)) return idiv(reduction * 3, 4);
  if (ammo === AmmoType.SUPER_AP) return idiv(reduction, 2);
  return reduction;
}

function shootLock(t: TacticalState, b: Bullet): void {
  const door = findDoorInfo(t, b.gridNo);
  if (!door) return;
  const lock = lockAt(t.content.locks, door.lockId);
  if (lock.pickDifficulty >= SHOOTABLE_PICK_LIMIT || lock.smashDifficulty >= SHOOTABLE_SMASH_LIMIT) return;
  if (t.pre.int(2) !== 0) return;
  let damage = i16(b.impact - b.impactReduction);
  damage = i16(damage + t.pre.int(u32(damage)));
  if (damageLock(t, b.firer, b.gridNo, damage))
    statChange(t, b.firer, StatKind.MARKSMANSHIP, LOCK_SHOT_MARKSMANSHIP_GAIN, StatCause.SUCCESS);
}

function handleBulletStructureInteraction(t: TacticalState, b: Bullet, s: StructureInstance): { remaining: number; hit: boolean } {
  if (b.flags & (BulletFlag.KNIFE | BulletFlag.MISSILE | BulletFlag.TANK_CANNON | BulletFlag.FLAME)) return { remaining: 0, hit: true };
  if (b.flags & BulletFlag.SMALL_MISSILE && ammoTypeOf(b) === AmmoType.HE) return { remaining: 0, hit: true };
  if (has(s.flags, StructureFlags.DOOR | StructureFlags.OPENABLE) && pythSpacesAway(b.targetGrid, s.gridNo) <= LOCK_SHOT_RADIUS)
    shootLock(t, b);
  if (t.pre.int(100) < s.def.density) {
    let reduction = t.content.materialArmour[s.def.armour] ?? 0;
    reduction = structureResistanceIncreasedByRange(reduction, b.range, b.loop);
    reduction = ammoAdjustedReduction(reduction, ammoTypeOf(b), true);
    b.impactReduction += reduction;
    if (s.def.armour === MATERIAL_LIGHT_VEGETATION) return { remaining: 1, hit: false };
    return { remaining: b.impact - b.impactReduction, hit: true };
  }
  return { remaining: 1, hit: false };
}

function hitMaterial(structure: StructureInstance | null): { material?: number; caveWall?: boolean } {
  if (!structure || has(structure.flags, StructureFlags.PERSON | StructureFlags.CORPSE)) return {};
  return { material: structure.def.armour, ...(has(structure.flags, StructureFlags.CAVEWALL) ? { caveWall: true } : {}) };
}

function structureHit(
  t: TacticalState,
  b: Bullet,
  structureId: number,
  impact: number,
  stopped: boolean,
  reason: 'structure' | 'ground' | 'roof',
): void {
  const attacker = b.firer;
  const weaponIndex = attacker.attackingWeapon;
  const weapon = t.content.items.byIndex.get(weaponIndex);
  const structure = structureId !== INVALID_STRUCTURE_ID ? t.world.structures.findById(b.gridNo, structureId) : null;
  if (stopped) {
    const opp = attacker.opponent;
    if (opp) agilityForEnemyMissingPlayer(t, attacker, opp, 5);
    t.events.push({ type: 'bulletStopped', soldier: attacker.id, gridNo: b.gridNo, reason, ...hitMaterial(structure) });
  }
  const sameAsBefore = structureId === b.lastStructureHit;
  const zPixels = idiv(fixInt(b.z) * 50, 256);
  const level = zPixels > 50 - ROOF_HIT_ADJUSTMENT + tileHeightPixels(t, attacker.gridNo) ? 1 : 0;
  const g = b.gridNo;
  let adjusted = g;
  if (structure?.wallOrientation) {
    const opposite = oppositeSideGridNo(structure, g);
    if (pythSpacesAway(attacker.gridNo, g) > pythSpacesAway(attacker.gridNo, opposite)) adjusted = opposite;
  }
  if (!sameAsBefore) makeNoise(t, attacker, adjusted, level, weapon?.weapon?.hitVolume ?? 0, NoiseKind.BULLET_IMPACT);
  if (stopped && (weaponIndex === itemIndex(t, 'ROCKET_LAUNCHER') || weaponIndex === itemIndex(t, 'TANK_CANNON'))) {
    removeBullet(t, b);
    freeUpAttacker(t, attacker);
    const payload = weaponIndex === itemIndex(t, 'ROCKET_LAUNCHER') ? 'C1' : 'TANK_SHELL';
    const payloadLevel = payload === 'C1' ? level : zPixels >= WALL_HEIGHT_PIXELS ? 1 : 0;
    igniteExplosion(t, attacker, 0, adjusted, itemIndex(t, payload), payloadLevel);
    return;
  }
  if (structure) damageStructureByGunfire(t, structure, attacker, fixInt(b.x), fixInt(b.y), g);
  void impact;
  let doMissForGun = false;
  switch (weapon?.weapon?.weaponClass) {
    case WeaponClass.HANDGUN:
    case WeaponClass.RIFLE:
    case WeaponClass.SHOTGUN:
    case WeaponClass.SMG:
    case WeaponClass.MG:
      doMissForGun = true;
      break;
    case WeaponClass.MONSTER:
      doSpecialEffectAmmoMiss(t, attacker, adjusted, impactPoint(b));
      removeBullet(t, b);
      freeUpAttacker(t, attacker);
      break;
    case WeaponClass.KNIFE:
      if (weapon?.itemClass === ItemClass.THROWING_KNIFE) {
        if (structureId === INVALID_STRUCTURE_ID)
          addItemToPool(t, g, createItem(t.content.items, itemIndex(t, 'THROWING_KNIFE'), b.itemStatus), Visibility.INVISIBLE, 0);
        removeBullet(t, b);
        freeUpAttacker(t, attacker);
      }
      break;
  }
  if (!doMissForGun) return;
  if (sameAsBefore) {
    if (stopped) {
      removeBullet(t, b);
      freeUpAttacker(t, attacker);
    }
    return;
  }
  if (stopped && doSpecialEffectAmmoMiss(t, attacker, g, impactPoint(b))) {
    removeBullet(t, b);
    freeUpAttacker(t, attacker);
  } else {
    const effect = SPLASHING_TERRAIN.has(t.world.terrain[g] ?? Terrain.NONE) ? 'splash' : 'dust';
    t.events.push({ type: 'bulletImpact', soldier: attacker.id, gridNo: g, ...impactPoint(b), effect });
    if (stopped) t.missAnimations.push({ bullet: b, releaseAt: t.clockMs + MISS_ANIM_MS });
  }
  b.lastStructureHit = structureId;
}

const SPLASHING_TERRAIN: ReadonlySet<number> = new Set([Terrain.LOW_WATER, Terrain.DEEP_WATER]);

function impactPoint(b: Bullet): ImpactPoint {
  return { ...bulletWorldXY(b), z: bulletHeightPixels(b) };
}

function damageStructureByGunfire(t: TacticalState, s: StructureInstance, owner: Soldier, x: number, y: number, g: number): void {
  if (has(s.flags, StructureFlags.PERSON | StructureFlags.CORPSE)) return;
  if (s.def.armour === MATERIAL_INDESTRUCTABLE_METAL || s.def.armour === MATERIAL_INDESTRUCTABLE_STONE) return;
  if (has(s.flags, StructureFlags.EXPLOSIVE) && t.rng.int(2)) {
    const base = t.world.structures.findBase(s);
    if (base) base.hitPoints = 0;
    igniteExplosionXY(t, owner, x, y, 0, g, itemIndex(t, 'STRUCTURE_IGNITE'), 0);
    return;
  }
  const caveWall = has(s.flags, StructureFlags.CAVEWALL);
  t.events.push({ type: 'structureStruck', soldier: owner.id, gridNo: g, material: s.def.armour, ...(caveWall ? { caveWall } : {}) });
}

function oppositeSideGridNo(s: StructureInstance, g: number): number {
  const base = has(s.flags, StructureFlags.BASE_TILE);
  const open = has(s.flags, StructureFlags.OPEN);
  for (const o of OPPOSITE_SIDE) {
    if (has(o.flags, s.flags) && o.base === base && o.open === open && o.orientation & s.wallOrientation)
      return g + (DIRECTION_INCREMENT[o.direction] ?? 0);
  }
  return g;
}

const ORIENT_INSIDE_LEFT = 1;
const ORIENT_INSIDE_RIGHT = 2;
const ORIENT_OUTSIDE_LEFT = 4;
const ORIENT_OUTSIDE_RIGHT = 8;
const OPPOSITE_SIDE: readonly { flags: number; open: boolean; base: boolean; orientation: number; direction: number }[] =
  buildOppositeSide();

function buildOppositeSide() {
  const WALL_LIKE = StructureFlags.WALL | StructureFlags.WALLNWINDOW;
  const N = 0;
  const E = 2;
  const S = 4;
  const W = 6;
  return [
    {
      flags: WALL_LIKE | StructureFlags.DOOR | StructureFlags.SLIDINGDOOR | StructureFlags.GARAGEDOOR,
      open: false,
      base: true,
      orientation: ORIENT_INSIDE_LEFT,
      direction: W,
    },
    {
      flags: WALL_LIKE | StructureFlags.DOOR | StructureFlags.SLIDINGDOOR | StructureFlags.GARAGEDOOR,
      open: false,
      base: true,
      orientation: ORIENT_INSIDE_RIGHT,
      direction: N,
    },
    {
      flags: WALL_LIKE | StructureFlags.SLIDINGDOOR | StructureFlags.GARAGEDOOR,
      open: true,
      base: true,
      orientation: ORIENT_INSIDE_LEFT,
      direction: W,
    },
    {
      flags: WALL_LIKE | StructureFlags.SLIDINGDOOR | StructureFlags.GARAGEDOOR,
      open: true,
      base: true,
      orientation: ORIENT_INSIDE_RIGHT,
      direction: N,
    },
    {
      flags: WALL_LIKE | StructureFlags.DOOR | StructureFlags.SLIDINGDOOR | StructureFlags.GARAGEDOOR,
      open: false,
      base: true,
      orientation: ORIENT_OUTSIDE_LEFT,
      direction: E,
    },
    {
      flags: WALL_LIKE | StructureFlags.DOOR | StructureFlags.SLIDINGDOOR | StructureFlags.GARAGEDOOR,
      open: false,
      base: true,
      orientation: ORIENT_OUTSIDE_RIGHT,
      direction: S,
    },
    { flags: StructureFlags.DOOR, open: true, base: true, orientation: ORIENT_INSIDE_LEFT, direction: N },
    { flags: StructureFlags.DOOR, open: true, base: true, orientation: ORIENT_INSIDE_RIGHT, direction: W },
  ];
}

function shotMiss(t: TacticalState, b: Bullet): void {
  const attacker = b.firer;
  const opp = attacker.opponent;
  if (opp) agilityForEnemyMissingPlayer(t, attacker, opp, 5);
  const gun = isGunClass(t.content.items.byIndex.get(attacker.attackingWeapon)?.weapon?.weaponClass);
  const explosiveAmmo = gun && isExplosiveAmmo(ammoTypeOf(b));
  t.events.push({
    type: 'bulletStopped',
    soldier: attacker.id,
    gridNo: b.gridNo,
    reason: 'offMap',
    ...(explosiveAmmo ? { explosiveAmmo } : {}),
  });
  freeUpAttacker(t, attacker);
}

const GUN_CLASSES: ReadonlySet<number> = new Set([
  WeaponClass.HANDGUN,
  WeaponClass.RIFLE,
  WeaponClass.SHOTGUN,
  WeaponClass.SMG,
  WeaponClass.MG,
]);

const isGunClass = (weaponClass: number | undefined) => weaponClass !== undefined && GUN_CLASSES.has(weaponClass);
const isExplosiveAmmo = (ammo: number) => ammo === AmmoType.HE || ammo === AmmoType.HEAT;

function adjacentSuppression(t: TacticalState, b: Bullet, p: Soldier): void {
  if (b.flags & BulletFlag.BUCKSHOT && t.rng.int(2) === 0) return;
  const end = endHeight(t.content, p.state);
  if (end === AnimHeight.PRONE && t.pre.int(4) === 0) return;
  if ((end === AnimHeight.PRONE || end === AnimHeight.CROUCH) && t.pre.int(4) === 0) return;
  p.suppressionPoints = u8(p.suppressionPoints + 1);
  p.suppressor = b.firer;
}

const isMercBody = (s: Soldier) => s.bodyType <= Body.REGFEMALE;

function outOfWorld(t: TacticalState, b: Bullet, elevation: number): boolean {
  return !onVisibleWorldTile(t, b.tileX + b.tileY * WORLD_COLS) || (b.cubesZ > PROFILE_Z_SIZE * elevation && fixInt(b.incZ) > 0);
}

interface LocalStructure {
  s: StructureInstance | null;
  timesHit: number;
}

export function moveBullet(t: TacticalState, b: Bullet): void {
  if (t.clockMs - b.lastUpdate < b.msPerUpdate) return;
  b.lastUpdate = t.clockMs;
  const elevation = tileHeightPixels(t, b.firer.gridNo) === 0 ? 2 : 4;
  let tiles = 0;
  let goingOver = false;
  do {
    const g = b.tileX + b.tileY * WORLD_COLS;
    if (outOfWorld(t, b, elevation)) {
      removeBullet(t, b);
      shotMiss(t, b);
      return;
    }
    const land = landHU(t, g) * FIX;
    const wall = WALL + land;
    const winLo = WIN_LO + land;
    const winHi = WIN_HI + land;
    const cubesAboveLevel = cubeOf(fixInt(b.z - land));
    const desiredLevel = cubesAboveLevel < STRUCTURE_ON_GROUND_MAX ? 0 : 1;
    const intended = g === b.targetGrid;
    const chanceOfHit = intended ? 100 : chanceOfBulletHittingStructure(b.loop, b.distanceLimit, b.hitBy);
    const local: LocalStructure[] = [];
    let roof: StructureInstance | null = null;
    for (const s of [...t.world.structures.at(g)]) {
      if (has(s.flags, ALWAYS_CONSIDER_HIT)) {
        if (has(s.flags, StructureFlags.ANYFENCE)) {
          const top = cubesAboveLevel === structureHeight(s) - 1;
          if (s.def.density < 100) {
            if (t.pre.int(100) < chanceOfHit) local.push({ s, timesHit: 0 });
          } else if (b.loop <= CLOSE_TO_FIRER && cubesAboveLevel <= b.startCubesAbove && b.endCubesAbove >= cubesAboveLevel && top) {
            if (t.pre.int(100) < chanceOfHit) local.push({ s, timesHit: 0 });
          } else if (b.distanceLimit - b.loop <= CLOSE_TO_FIRER && cubesAboveLevel <= b.endCubesAbove && top) {
            if (t.pre.int(100) < chanceOfHit) local.push({ s, timesHit: 0 });
          } else local.push({ s, timesHit: 0 });
        } else local.push({ s, timesHit: 0 });
      } else if (has(s.flags, StructureFlags.ROOF)) {
        if (b.checkForRoof) {
          roof = s;
          const last = b.z - b.incZ;
          if ((last > wall && b.z <= wall) || (last < wall && b.z >= wall)) {
            stopBullet(b);
            structureHit(t, b, INVALID_STRUCTURE_ID, 0, true, 'roof');
            return;
          }
        }
      } else if (has(s.flags, StructureFlags.PERSON)) {
        const p = t.soldiers[s.id];
        if (p && p !== b.firer) {
          if (intended) local.push({ s, timesHit: 0 });
          else if (isMonster(b.firer)) {
            if (!isMonster(p)) local.push({ s, timesHit: 0 });
          } else if (
            p.visible === 1 &&
            endHeight(t.content, p.state) === AnimHeight.STAND &&
            ((b.aimed && b.loop > MIN_DIST_FOR_HIT_FRIENDS) ||
              (!b.aimed && b.loop > MIN_DIST_FOR_HIT_FRIENDS_UNAIMED) ||
              t.pre.int(100) < MIN_CHANCE_TO_ACCIDENTALLY_HIT_SOMEONE)
          )
            local.push({ s, timesHit: 0 });
          if (p.team === Team.OUR && b.firer.team !== Team.OUR && desiredLevel === p.level) p.closeCall = true;
          if (isMercBody(p) && (p.side !== b.firer.side || b.loop > MIN_DIST_FOR_HIT_FRIENDS)) adjacentSuppression(t, b, p);
        }
      } else if (has(s.flags, StructureFlags.CORPSE)) {
        if ((intended || s.def.tiles.length >= 10) && !t.world.structures.find(g, StructureFlags.PERSON)) local.push({ s, timesHit: 0 });
      } else if (b.loop > CLOSE_TO_FIRER || intended) {
        if (t.pre.int(100) < chanceOfHit) local.push({ s, timesHit: 0 });
      }
    }
    if (cubesAboveLevel < STRUCTURE_ON_ROOF_MAX) {
      for (let dir = 0; dir < 8; dir++) {
        const adj = g + (DIRECTION_INCREMENT[dir] ?? 0);
        if (t.world.costs.get(adj, dir, desiredLevel) >= TravelCost.BLOCKED) continue;
        const p = whoIsThere(t, adj, desiredLevel);
        if (p && isMercBody(p) && b.firer.side !== p.side) adjacentSuppression(t, b, p);
      }
    }
    const oldTileX = b.tileX;
    const oldTileY = b.tileY;
    do {
      const above = fixInt(b.z - land);
      if (above < 0) {
        stopBullet(b);
        structureHit(t, b, INVALID_STRUCTURE_ID, 0, true, 'ground');
        return;
      }
      if (local.length === 0 && !roof) {
        const stepsX = b.incX > 0 ? idiv(TEN - (b.x % TEN), b.incX) : b.incX < 0 ? idiv(b.x % TEN, -b.incX) : 1000000;
        const stepsY = b.incY > 0 ? idiv(TEN - (b.y % TEN), b.incY) : b.incY < 0 ? idiv(b.y % TEN, -b.incY) : 1000000;
        let steps = Math.min(stepsX, stepsY) + 1;
        if (b.z + Math.imul(b.incZ, steps) < land) {
          steps = Math.min(steps, Math.abs(Math.trunc((b.z - land) / b.incZ)));
          b.x = i32(b.x + Math.imul(b.incX, steps));
          b.y = i32(b.y + Math.imul(b.incY, steps));
          b.z = i32(b.z + Math.imul(b.incZ, steps));
          stopBullet(b);
          structureHit(t, b, INVALID_STRUCTURE_ID, 0, true, 'ground');
          return;
        }
        if (b.flags & SPECIAL_BULLETS) goingOver = trailOnTheWay(t, b, steps, goingOver);
        b.x = i32(b.x + Math.imul(b.incX, steps));
        b.y = i32(b.y + Math.imul(b.incY, steps));
        b.z = i32(b.z + Math.imul(b.incZ, steps));
        b.loop += steps;
        b.tileX = tileOf(b.x);
        b.tileY = tileOf(b.y);
        b.cubesZ = cubeOf(fixInt(b.z));
        b.losX = cellOf(b.x);
        b.losY = cellOf(b.y);
      } else {
        let cubes = cubeOf(above);
        if (cubes < STRUCTURE_ON_ROOF_MAX) {
          const level = cubes < STRUCTURE_ON_GROUND_MAX ? 0 : STRUCTURE_ON_ROOF;
          if (level === STRUCTURE_ON_ROOF) cubes -= STRUCTURE_ON_ROOF;
          for (const entry of local) {
            const s = entry.s;
            if (!s || s.cubeOffset !== level) continue;
            if (!((s.tile.shape[b.losX * 5 + b.losY] ?? 0) & (1 << cubes))) continue;
            if (has(s.flags, StructureFlags.PERSON)) {
              if (bulletHitMerc(t, b, s, intended)) return;
              entry.s = null;
            } else if (has(s.flags, StructureFlags.WALLNWINDOW) && b.z >= winLo && b.z <= winHi) {
              if (resolveHitOnWall(losWorldOf(t), s, g, b.losX, b.losY, b.horizAngle)) {
                if (b.flags & BulletFlag.KNIFE) {
                  const r = handleBulletStructureInteraction(t, b, s);
                  if (r.remaining <= 0) {
                    const knife = itemIndex(t, b.flags & BulletFlag.BLOODY ? 'BLOODY_THROWING_KNIFE' : 'THROWING_KNIFE');
                    let knifeGrid = g;
                    if (s.wallOrientation & ORIENT_RIGHT) {
                      if (!(b.incX > 0)) knifeGrid += 1;
                    } else if (!(b.incY > 0)) knifeGrid += WORLD_ROWS;
                    const item = createItem(t.content.items, knife, b.itemStatus);
                    addItemToPool(t, knifeGrid, item, Visibility.INVISIBLE, GROUND_LEVEL, NO_FLAGS, LEVEL_HEIGHT);
                    stopBullet(b);
                    structureHit(t, b, s.id, 1, true, 'structure');
                    return;
                  }
                } else {
                  const blowSouth = s.wallOrientation & ORIENT_RIGHT ? b.incX > 0 : b.incY > 0;
                  windowHit(t, b.tileX + b.tileY * WORLD_COLS, s.id, blowSouth);
                  entry.s = null;
                }
              }
            } else if (b.loop > CLOSE_TO_FIRER || has(s.flags, ALWAYS_CONSIDER_HIT) || intended) {
              const resolve = has(s.flags, StructureFlags.WALLSTUFF)
                ? resolveHitOnWall(losWorldOf(t), s, g, b.losX, b.losY, b.horizAngle)
                : true;
              if (!resolve) continue;
              const r = handleBulletStructureInteraction(t, b, s);
              if (!r.hit) continue;
              if (has(s.flags, StructureFlags.CORPSE) && !(b.flags & SPECIAL_BULLETS)) {
                removeBullet(t, b);
                freeUpAttacker(t, b.firer);
                t.events.push({ type: 'bulletStopped', soldier: b.firer.id, gridNo: b.gridNo, reason: 'structure' });
                return;
              }
              if (r.remaining <= 0) {
                stopBullet(b);
                structureHit(t, b, s.id, 1, true, 'structure');
                return;
              }
              if (entry.timesHit === 0) {
                structureHit(t, b, s.id, 1, false, 'structure');
                entry.timesHit = 1;
              }
            }
          }
        }
        const oldX = b.losX;
        const oldY = b.losY;
        const oldCubes = b.cubesZ;
        do {
          b.x += b.incX;
          b.y += b.incY;
          if (roof) {
            const last = b.z;
            b.z += b.incZ;
            if ((last > wall && b.z <= wall) || (last < wall && b.z >= wall)) {
              stopBullet(b);
              structureHit(t, b, INVALID_STRUCTURE_ID, 0, true, 'roof');
              return;
            }
          } else b.z += b.incZ;
          b.losX = cellOf(b.x);
          b.losY = cellOf(b.y);
          b.cubesZ = cubeOf(fixInt(b.z));
          b.loop++;
          if (b.flags & SPECIAL_BULLETS && b.loop % trailSteps(b) === 0) addMissileTrail(t, b, b.x, b.y, b.z);
        } while (b.losX === oldX && b.losY === oldY && b.cubesZ === oldCubes);
        b.tileX = idiv(fixInt(b.x), 10);
        b.tileY = idiv(fixInt(b.y), 10);
      }
    } while (b.tileX === oldTileX && b.tileY === oldTileY);
    if (outOfWorld(t, b, elevation)) {
      removeBullet(t, b);
      shotMiss(t, b);
      return;
    }
    b.gridNo = rowColToPos(b.tileY, b.tileX);
    tiles++;
    if (b.loop > b.range * 2) b.incZ -= idiv(100 * FIX, b.range * 2);
    else if (b.flags & BulletFlag.FLAME && b.loop > b.range) b.incZ -= idiv(100 * FIX, b.range * 2);
    if (b.firer.target && !b.firer.attackNoticed && pythSpacesAway(b.gridNo, b.targetGrid) <= 3) b.firer.attackNoticed = true;
  } while (tiles < b.tilesPerUpdate);
}

const STEPS_FOR_BULLET_MOVE_TRAILS = 10;
const STEPS_FOR_BULLET_MOVE_SMALL_TRAILS = 5;
const STEPS_FOR_BULLET_MOVE_FIRE_TRAILS = 5;
const TRAIL_LOOPS_HIDDEN = 5;
const FLAME_TRAIL_DELAY_MS = 100;
const SHORT_TRAILS_HIDDEN_AT_FIRST = BulletFlag.SMALL_MISSILE | BulletFlag.FLAME | BulletFlag.CREATURE_SPIT;

function trailSteps(b: Bullet): number {
  if (b.flags & BulletFlag.SMALL_MISSILE) return STEPS_FOR_BULLET_MOVE_SMALL_TRAILS;
  return b.flags & BulletFlag.FLAME ? STEPS_FOR_BULLET_MOVE_FIRE_TRAILS : STEPS_FOR_BULLET_MOVE_TRAILS;
}

function trailOnTheWay(t: TacticalState, b: Bullet, steps: number, goingOver: boolean): boolean {
  const every = trailSteps(b);
  let i = 0;
  while (i < steps && (b.loop + i) % every !== 0) i++;
  const over = goingOver || i < steps;
  if (over) addMissileTrail(t, b, i32(b.x + Math.imul(b.incX, i)), i32(b.y + Math.imul(b.incY, i)), i32(b.z + Math.imul(b.incZ, i)));
  return over;
}

function trailKind(b: Bullet): MissileTrail {
  if (b.flags & (BulletFlag.MISSILE | BulletFlag.TANK_CANNON)) return 'smoke';
  if (b.flags & BulletFlag.SMALL_MISSILE) return 'small';
  return b.flags & BulletFlag.CREATURE_SPIT ? 'spit' : 'smoke';
}

function addMissileTrail(t: TacticalState, b: Bullet, x: number, y: number, z: number): void {
  if (b.flags & SHORT_TRAILS_HIDDEN_AT_FIRST && b.loop < TRAIL_LOOPS_HIDDEN) return;
  if (b.flags & BulletFlag.TANK_CANNON) return;
  const height = idiv(fixInt(z) * WALL_HEIGHT_PIXELS, WALL_HEIGHT_UNITS) - tileHeightPixels(t, b.firer.gridNo);
  const delay = b.flags & BulletFlag.FLAME ? { delay: FLAME_TRAIL_DELAY_MS } : {};
  t.events.push({ type: 'missileTrail', gridNo: b.gridNo, x: fixInt(x), y: fixInt(y), z: height, trail: trailKind(b), ...delay });
}

const isMonster = (s: Soldier) => s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER;

export function updateBullets(t: TacticalState): void {
  for (const b of [...t.bullets]) {
    if (b.flags & BulletFlag.STOPPED || b.toDelete) continue;
    moveBullet(t, b);
  }
  for (let i = t.bullets.length - 1; i >= 0; i--) if (t.bullets[i]?.toDelete) t.bullets.splice(i, 1);
}

export function updateMissAnimations(t: TacticalState): void {
  const due = t.missAnimations.filter((a) => t.clockMs >= a.releaseAt);
  if (due.length === 0) return;
  t.missAnimations.splice(0, t.missAnimations.length, ...t.missAnimations.filter((a) => t.clockMs < a.releaseAt));
  for (const a of due) {
    removeBullet(t, a.bullet);
    freeUpAttacker(t, a.bullet.firer);
  }
  for (let i = t.bullets.length - 1; i >= 0; i--) if (t.bullets[i]?.toDelete) t.bullets.splice(i, 1);
}

function ctgtReduction(t: TacticalState, b: Bullet, s: StructureInstance): number {
  if (b.flags & (BulletFlag.KNIFE | BulletFlag.MISSILE | BulletFlag.FLAME | BulletFlag.TANK_CANNON)) return b.impact;
  if (b.flags & BulletFlag.SMALL_MISSILE && ammoTypeOf(b) === AmmoType.HE) return b.impact;
  let reduction = idiv((t.content.materialArmour[s.def.armour] ?? 0) * s.def.density, 100);
  reduction = structureResistanceIncreasedByRange(reduction, b.range, b.loop);
  return ammoAdjustedReduction(reduction, ammoTypeOf(b), false);
}

interface CtgtStructure {
  readonly s: StructureInstance;
  readonly chance: number;
  timesHit: number;
}

function calcChanceToGetThrough(t: TacticalState, b: Bullet): number {
  let chanceThrough = 100;
  let lastZ = 0;
  do {
    const g = b.tileX + b.tileY * WORLD_COLS;
    const land = landHU(t, g) * FIX;
    const wall = WALL + land;
    const winLo = WIN_LO + land;
    const winHi = WIN_HI + land;
    let chanceOfHit = chanceOfBulletHittingStructure(b.loop, b.distanceLimit, 0);
    let roof: StructureInstance | null = null;
    const intended = g === b.targetGrid;
    if (intended) chanceOfHit = 100;
    let above = fixInt(b.z - land);
    if (above < 0) return 0;
    let cubesAboveLevel = cubeOf(above);
    const local: CtgtStructure[] = [];
    const tileStructures = g >= 0 && g < WORLD_COLS * 160 ? t.world.structures.at(g) : [];
    for (const s of tileStructures) {
      if (has(s.flags, ALWAYS_CONSIDER_HIT)) {
        let chance = 100;
        if (has(s.flags, StructureFlags.ANYFENCE)) {
          const top = cubesAboveLevel === structureHeight(s) - 1;
          if (s.def.density < 100) chance = chanceOfHit;
          else if (b.loop <= CLOSE_TO_FIRER && cubesAboveLevel <= b.startCubesAbove && b.endCubesAbove >= cubesAboveLevel && top)
            chance = chanceOfHit;
          else if (b.distanceLimit - b.loop <= CLOSE_TO_FIRER && cubesAboveLevel <= b.endCubesAbove && top) chance = chanceOfHit;
        }
        local.push({ s, chance, timesHit: 0 });
      } else if (has(s.flags, StructureFlags.ROOF)) {
        if (b.checkForRoof) {
          roof = s;
          lastZ = b.z - b.incZ;
          if ((lastZ > wall && b.z <= wall) || (lastZ < wall && b.z >= wall)) return 0;
        }
      } else if (has(s.flags, StructureFlags.PERSON)) {
        const p = t.soldiers[s.id];
        if (p && p !== b.firer && p !== b.target && !intended && p.visible === 1) {
          const likely =
            endHeight(t.content, p.state) === AnimHeight.STAND &&
            ((b.aimed && b.loop > MIN_DIST_FOR_HIT_FRIENDS) || (!b.aimed && b.loop > MIN_DIST_FOR_HIT_FRIENDS_UNAIMED));
          local.push({ s, chance: likely ? 100 : MIN_CHANCE_TO_ACCIDENTALLY_HIT_SOMEONE, timesHit: 0 });
        }
      } else if (has(s.flags, StructureFlags.CORPSE)) {
        if ((intended || s.def.tiles.length >= 10) && !t.world.structures.find(g, StructureFlags.PERSON))
          local.push({ s, chance: 100, timesHit: 0 });
      } else if (b.loop > CLOSE_TO_FIRER && !intended) local.push({ s, chance: chanceOfHit, timesHit: 0 });
    }
    const oldTileX = b.tileX;
    const oldTileY = b.tileY;
    do {
      above = fixInt(b.z - land);
      if (above < 0) return 0;
      if (roof && ((lastZ > wall && b.z < wall) || (lastZ < wall && b.z > wall))) return 0;
      if (tileStructures.length === 0) {
        const stepsX = b.incX > 0 ? idiv(TEN - (b.x % TEN), b.incX) : b.incX < 0 ? idiv(b.x % TEN, -b.incX) : 1000000;
        const stepsY = b.incY > 0 ? idiv(TEN - (b.y % TEN), b.incY) : b.incY < 0 ? idiv(b.y % TEN, -b.incY) : 1000000;
        const steps = Math.min(stepsX, stepsY) + 1;
        b.x = i32(b.x + Math.imul(b.incX, steps));
        b.y = i32(b.y + Math.imul(b.incY, steps));
        b.z = i32(b.z + Math.imul(b.incZ, steps));
        b.loop += steps;
        if (b.z < land && b.loop < b.distanceLimit) return 0;
        b.tileX = tileOf(b.x);
        b.tileY = tileOf(b.y);
        b.cubesZ = cubeOf(fixInt(b.z));
        b.losX = cellOf(b.x);
        b.losY = cellOf(b.y);
      } else {
        cubesAboveLevel = cubeOf(above);
        if (cubesAboveLevel < STRUCTURE_ON_ROOF_MAX) {
          const level = cubesAboveLevel < STRUCTURE_ON_GROUND_MAX ? 0 : STRUCTURE_ON_ROOF;
          if (level === STRUCTURE_ON_ROOF) cubesAboveLevel -= STRUCTURE_ON_ROOF;
          for (const entry of local) {
            const s = entry.s;
            if (s.cubeOffset !== level || !((s.tile.shape[b.losX * 5 + b.losY] ?? 0) & (1 << cubesAboveLevel))) continue;
            if (has(s.flags, StructureFlags.PERSON)) {
              if (intended) return u8(Math.trunc((chanceThrough * (b.impact - b.impactReduction)) / b.impact));
              entry.timesHit++;
            } else if (has(s.flags, StructureFlags.WALLNWINDOW) && b.z >= winLo && b.z <= winHi) {
              if (resolveHitOnWall(losWorldOf(t), s, g, b.losX, b.losY, b.horizAngle) && b.flags & BulletFlag.KNIFE) entry.timesHit++;
            } else if (b.loop > CLOSE_TO_FIRER || has(s.flags, ALWAYS_CONSIDER_HIT)) {
              const resolve = has(s.flags, StructureFlags.WALLSTUFF)
                ? resolveHitOnWall(losWorldOf(t), s, g, b.losX, b.losY, b.horizAngle)
                : true;
              if (resolve) entry.timesHit++;
            }
          }
        }
        const oldX = b.losX;
        const oldY = b.losY;
        const oldCubes = b.cubesZ;
        do {
          b.x += b.incX;
          b.y += b.incY;
          lastZ = b.z;
          b.z += b.incZ;
          b.loop++;
          b.losX = cellOf(b.x);
          b.losY = cellOf(b.y);
          b.cubesZ = cubeOf(fixInt(b.z));
        } while (b.losX === oldX && b.losY === oldY && b.cubesZ === oldCubes);
        b.tileX = idiv(fixInt(b.x), 10);
        b.tileY = idiv(fixInt(b.y), 10);
      }
    } while (b.loop < b.distanceLimit && b.tileX === oldTileX && b.tileY === oldTileY);
    if (b.tileX < 0 || b.tileX >= WORLD_COLS || b.tileY < 0 || b.tileY >= 160) return 0;
    b.gridNo = rowColToPos(b.tileY, b.tileX);
    if (b.loop > b.range * 2) b.incZ -= idiv(100 * FIX, b.range * 2);
    if (local.length > 0) {
      for (const entry of local) {
        if (entry.timesHit === 0) continue;
        const total = Math.min(ctgtReduction(t, b, entry.s) * entry.timesHit, b.impact);
        b.impactReduction += idiv(total * entry.chance, 100);
      }
      if (b.impactReduction >= b.impact) return 0;
    }
  } while (b.loop < b.distanceLimit);
  chanceThrough = Math.trunc((chanceThrough * (b.impact - b.impactReduction)) / b.impact);
  return u8(Math.max(0, chanceThrough));
}

function chanceToGetThrough(t: TacticalState, firer: Soldier, g: number, endZ: number): number {
  let weapon = firer.attackingWeapon;
  let buckshot = false;
  const cls = t.content.items.byIndex.get(weapon)?.itemClass;
  if (cls === ItemClass.GUN || cls === ItemClass.THROWING_KNIFE) {
    const hand = firer.inv[InvSlot.HAND];
    buckshot = hand?.item === weapon && hand.gunAmmoType === AmmoType.BUCKSHOT;
  } else weapon = itemIndex(t, 'GLOCK_17');
  const c = centre(g);
  return fireBulletGivenTarget(t, firer, c.x, c.y, endZ, weapon, 0, buckshot, true);
}

export function soldierToSoldierChanceToGetThrough(t: TacticalState, from: Soldier, to: Soldier): number {
  if (from === to) return 0;
  from.ctgtTarget = to;
  return chanceToGetThrough(t, from, to.gridNo, calculateSoldierZPos(t, to, ZPos.TARGET));
}

export function soldierToSoldierBodyPartChanceToGetThrough(t: TacticalState, from: Soldier, to: Soldier, aim: number): number {
  if (from === to) return 0;
  from.ctgtTarget = to;
  return chanceToGetThrough(t, from, to.gridNo, calculateSoldierZPos(t, to, aimPosType(aim)));
}

export function soldierToLocationChanceToGetThrough(
  t: TacticalState,
  from: Soldier,
  g: number,
  level: number,
  cubeLevel: number,
  target: Soldier | null,
): number {
  if (from.gridNo === g) return 0;
  const end = whoIsThere(t, g, level);
  if (end) return soldierToSoldierChanceToGetThrough(t, from, end);
  from.ctgtTarget = target;
  return chanceToGetThrough(t, from, g, targetZFromStructureHeight(t, g, level, cubeLevel));
}

export function aiSoldierToSoldierChanceToGetThrough(t: TacticalState, from: Soldier, to: Soldier, standing: number): number {
  if (from === to) return 0;
  const endZ = calculateSoldierZPos(t, to, ZPos.TARGET);
  const trueState = from.state;
  from.state = standing;
  from.ctgtTarget = null;
  const chance = chanceToGetThrough(t, from, to.gridNo, endZ);
  from.state = trueState;
  return chance;
}

export function aiSoldierToLocationChanceToGetThrough(
  t: TacticalState,
  from: Soldier,
  g: number,
  level: number,
  cubeLevel: number,
  standing: number,
): number {
  if (from.gridNo === g) return 0;
  const end = whoIsThere(t, g, level);
  if (end) return aiSoldierToSoldierChanceToGetThrough(t, from, end, standing);
  from.ctgtTarget = null;
  const trueState = from.state;
  from.state = standing;
  const chance = chanceToGetThrough(t, from, g, targetZFromStructureHeight(t, g, level, cubeLevel));
  from.state = trueState;
  return chance;
}
