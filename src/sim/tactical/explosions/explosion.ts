// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc InternalIgniteExplosion, IgniteExplosion, IgniteExplosionXY,
// @src GenerateExplosionFromExplosionPointer, RemoveExplosionData, ExpAffect (with the blood of BLOOD_SPREAD_EFFECT),
// @src GetRayStopInfo, SpreadEffect, SpreadEffectSmoke;
// @src TileEngine/Tile_Animation.cc UpdateAniTiles, DeleteAniTile (explosion and water ripple key frames);
// @src TileEngine/Structure.cc GetBlockingStructureInfo; Tactical/PathAI.cc InternalDoorTravelCost (no soldier).

import { NOTHING } from '../../../content/items/items.ts';
import { CELL_X_SIZE, CELL_Y_SIZE, DIRECTION_INCREMENT, Direction, newGridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { isDoorTravelCost, recompileLocalMovementCosts, TravelCost } from '../../../content/world/movement-costs.ts';
import {
  has,
  ORIENT_LEFT,
  ORIENT_RIGHT,
  STRUCTURE_ON_GROUND,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  type StructureInstance,
  structureHeight,
} from '../../../content/world/structures.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { i16, idiv, u8 } from '../../../core/int.ts';
import { TICK_MS } from '../../clock.ts';
import { reduceAttackBusyCount } from '../combat/barrier.ts';
import {
  type LightSprite,
  lightSpriteCreate,
  lightSpriteDestroy,
  lightSpritePosition,
  lightSpritePower,
  MIN_AMB_LEVEL_FOR_MERC_LIGHTS,
} from '../lighting/lighting.ts';
import { checkPowPathsInAlmaPrison } from '../narrative/pow-rules.ts';
import { doorObstacleIfClosed, doorState, terrainCost } from '../pathfinding.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import { BloodKind, DROPPED_IN_SIGHT, internalDropBlood, MAX_BLOOD_QUANTITY } from '../smell.ts';
import type { Soldier } from '../soldier.ts';
import { onVisibleWorldTile, type TacticalState, whoIsThere } from '../state.ts';
import { itemsAt, removeWorldItem } from '../world-items.ts';
import { damageSoldierFromBlast, reduceDamageAmount } from './blast-damage.ts';
import { damageItemOnGround } from './item-damage.ts';
import { addSmokeEffectToTile, dishOutGasDamage, newSmokeEffect, removeSmokeEffectFromTile, smokeTypeOf } from './smoke.ts';
import type { AniTile, ExplosionTile, SmokeCloud } from './state.ts';
import { explosiveDamageGridNo, recompileChangedTiles, type StructureChanges, windowHit } from './structure-damage.ts';

export const Spread = { NORMAL: 0, SUBSEQUENT: 1, ERASE: 2, BLOOD: 3, REDO: 4 } as const;

export const Blocking = {
  NOTHING: 0,
  REDUCE_RANGE: 1,
  NEXT_TILE: 10,
  TOPLEFT_WINDOW: 30,
  TOPRIGHT_WINDOW: 40,
  TOPLEFT_DOOR: 50,
  TOPRIGHT_DOOR: 60,
  FULL: 70,
  TOPLEFT_OPEN_WINDOW: 90,
  TOPRIGHT_OPEN_WINDOW: 100,
} as const;

const NUM_EXPLOSION_SLOTS = 100;
const ROOF_LEVEL_HEIGHT = 50;
const RIPPLE_DELAY_MS = 50;
const RIPPLE_KEYFRAME = 11;
const RIPPLE_FRAMES = RIPPLE_KEYFRAME + 1;
const MAX_RECOMPILE_RADIUS = 2;
const STRUCTURE_DAMAGE_PER_TILE = 30;
const MIN_ITEM_BLAST_DAMAGE = 10;
const THIN_DENSITY = 15;
const TALL_STRUCTURE = 4;
const BLAST_RANGE_REDUCTION = 2;
const DEBRIS_THRESHOLD = 20;
const BLOOD_LOST_PER_TILE = 2;
const EXPLOSION_LIGHT_TEMPLATE = 'L-R04.LHT';
const OPEN_WINDOWS: ReadonlySet<number> = new Set([Blocking.TOPLEFT_OPEN_WINDOW, Blocking.TOPRIGHT_OPEN_WINDOW]);
const CLOSED_WINDOWS: ReadonlySet<number> = new Set([Blocking.TOPLEFT_WINDOW, Blocking.TOPRIGHT_WINDOW]);
const BLOWN_SOUTH: ReadonlySet<number> = new Set([Direction.SOUTH, Direction.SOUTHEAST, Direction.SOUTHWEST]);

const itemDef = (t: TacticalState, item: number) => t.content.items.byIndex.get(item);
const inc = (dir: number) => DIRECTION_INCREMENT[dir] ?? 0;
const HALF_TILES_PER_DIAGONAL_STEP = 3;
const HALF_TILES_PER_STRAIGHT_STEP = 2;
const isDiagonal = (dir: number) => (dir & 1) === 1;
const halfTilesPerStep = (dir: number) => (isDiagonal(dir) ? HALF_TILES_PER_DIAGONAL_STEP : HALF_TILES_PER_STRAIGHT_STEP);

function isWaterTile(t: TacticalState, g: number): boolean {
  const terrain = t.world.terrain[g] ?? 0;
  return terrain >= Terrain.LOW_WATER && terrain <= Terrain.DEEP_WATER;
}

function explosionCount(t: TacticalState): number {
  return t.explosives.aniTiles.filter((a) => a.kind === 'explosion').length;
}

function explosionLight(t: TacticalState, x: number, y: number): LightSprite | null {
  if (t.lighting.ambient < MIN_AMB_LEVEL_FOR_MERC_LIGHTS) return null;
  const light = lightSpriteCreate(t, EXPLOSION_LIGHT_TEMPLATE);
  if (!light) return null;
  lightSpritePower(light, true);
  lightSpritePosition(t, light, idiv(x, CELL_X_SIZE), idiv(y, CELL_Y_SIZE));
  return light;
}

export function internalIgniteExplosion(
  t: TacticalState,
  owner: Soldier | null,
  x: number,
  y: number,
  z: number,
  g: number,
  item: number,
  level: number,
): void {
  const explosive = itemDef(t, item)?.explosive;
  if (!explosive) return;
  t.perception.disallowSight = true;
  t.turn.checkSightAtEndOfAttack = true;
  t.turn.attackBusyCount++;
  if (explosionCount(t) >= NUM_EXPLOSION_SLOTS) return;
  const animations = t.content.explosions.animations;
  const animation = explosive.animation ? animations.get(explosive.animation) : undefined;
  if (!animation) return;
  const water = isWaterTile(t, g) && animation.waterAnimation ? animations.get(animation.waterAnimation) : undefined;
  const shown = water ?? animation;
  const shownZ = z === 0 && level > 0 ? ROOF_LEVEL_HEIGHT : z;
  t.explosives.aniTiles.unshift({
    kind: 'explosion',
    owner,
    item,
    x: i16(x),
    y: i16(y),
    z: shownZ,
    gridNo: g,
    level,
    animation: shown,
    delay: animation.blastSpeed,
    light: explosionLight(t, i16(x), i16(y)),
    frame: 0,
    lastUpdate: t.clockMs,
  });
  t.events.push({
    type: 'explosion',
    item,
    gridNo: g,
    level,
    owner: owner?.id ?? null,
    animation: shown.name,
    x: i16(x),
    y: i16(y),
    z: shownZ,
    delay: animation.blastSpeed,
  });
}

export function igniteExplosion(t: TacticalState, owner: Soldier | null, z: number, g: number, item: number, level: number): void {
  internalIgniteExplosion(t, owner, (g % WORLD_COLS) * 10 + 5, Math.trunc(g / WORLD_COLS) * 10 + 5, z, g, item, level);
}

export function igniteExplosionXY(
  t: TacticalState,
  owner: Soldier | null,
  x: number,
  y: number,
  z: number,
  g: number,
  item: number,
  level: number,
): void {
  internalIgniteExplosion(t, owner, x, y, z, g, item, level);
}

function frameDelay(a: AniTile): number {
  return a.kind === 'explosion' ? a.delay : RIPPLE_DELAY_MS;
}

function frameCount(a: AniTile): number {
  return a.kind === 'explosion' ? a.animation.frames : RIPPLE_FRAMES;
}

function removeAniTile(t: TacticalState, a: AniTile): void {
  const tiles = t.explosives.aniTiles;
  const k = tiles.indexOf(a);
  if (k >= 0) tiles.splice(k, 1);
}

function applyExplosionEffect(t: TacticalState, a: ExplosionTile): void {
  const explosive = itemDef(t, a.item)?.explosive;
  if (!explosive) return;
  if (explosive.smoke) newSmokeEffect(t, a.gridNo, a.item, a.level, a.owner);
  if (explosive.blast || explosive.stun) {
    const radius = Math.max(explosive.blast?.radius ?? 0, explosive.stun?.radius ?? 0);
    spreadEffect(t, a.gridNo, radius, a.item, a.owner, Spread.NORMAL, a.level, null);
  }
}

export function stepExplosions(t: TacticalState): void {
  const e = t.explosives;
  if (!t.inCombat) e.worldMs += TICK_MS;
  for (const a of [...e.aniTiles]) {
    if (t.clockMs - a.lastUpdate <= frameDelay(a)) continue;
    a.lastUpdate = t.clockMs;
    if (a.frame + 1 >= frameCount(a)) {
      removeAniTile(t, a);
      if (a.kind === 'explosion') {
        if (a.light) lightSpriteDestroy(t, a.light);
        t.perception.disallowSight = false;
        reduceAttackBusyCount(t, a.owner, false);
      }
      return;
    }
    a.frame++;
    if (a.kind === 'ripple' && a.frame === RIPPLE_KEYFRAME) igniteExplosionXY(t, a.owner, a.x, a.y, 0, a.gridNo, a.item, 0);
    if (a.kind === 'explosion' && a.frame === a.animation.damageKeyframe) {
      applyExplosionEffect(t, a);
      return;
    }
  }
}

interface BlockingInfo {
  readonly blocking: number;
  readonly height: number;
  readonly structure: StructureInstance | null;
}

const NOTHING_BLOCKING: BlockingInfo = { blocking: Blocking.NOTHING, height: 0, structure: null };

function wallFacesRay(s: StructureInstance, dir: number): boolean {
  if (dir >= Direction.NORTH && dir <= Direction.SOUTH && s.wallOrientation & ORIENT_RIGHT) return false;
  if (dir >= Direction.EAST && dir <= Direction.WEST && s.wallOrientation & ORIENT_LEFT) return false;
  return true;
}

function windowBlocking(s: StructureInstance): number {
  const open = has(s.flags, StructureFlags.OPEN);
  if (s.wallOrientation & ORIENT_LEFT) return open ? Blocking.TOPLEFT_OPEN_WINDOW : Blocking.TOPLEFT_WINDOW;
  return open ? Blocking.TOPRIGHT_OPEN_WINDOW : Blocking.TOPRIGHT_WINDOW;
}

function doorBlocking(s: StructureInstance): number {
  if (!has(s.flags, StructureFlags.OPEN)) return Blocking.FULL;
  return s.wallOrientation & ORIENT_LEFT ? Blocking.TOPLEFT_DOOR : Blocking.TOPRIGHT_DOOR;
}

function blockingStructureInfo(t: TacticalState, g: number, dir: number, level: number): BlockingInfo {
  const desired = level === 0 ? STRUCTURE_ON_GROUND : STRUCTURE_ON_ROOF;
  let ok = false;
  let minimum = false;
  let last: StructureInstance | null = null;
  for (const s of t.world.structures.at(g)) {
    if (s.cubeOffset !== desired) continue;
    ok = true;
    last = s;
    if (has(s.flags, StructureFlags.ROOF) && level === 1) ok = false;
    if (has(s.flags, StructureFlags.CORPSE | StructureFlags.PERSON)) ok = false;
    if (has(s.flags, StructureFlags.TREE | StructureFlags.ANYFENCE)) minimum = true;
    if (has(s.flags, StructureFlags.WALL)) {
      ok = wallFacesRay(s, dir);
      if (ok) break;
    }
    if (has(s.flags, StructureFlags.WALLNWINDOW)) return { blocking: windowBlocking(s), height: structureHeight(s), structure: s };
    if (has(s.flags, StructureFlags.ANYDOOR)) return { blocking: doorBlocking(s), height: structureHeight(s), structure: s };
  }
  if (!ok || !last) return NOTHING_BLOCKING;
  return { blocking: minimum ? Blocking.REDUCE_RANGE : Blocking.NEXT_TILE, height: structureHeight(last), structure: last };
}

function doorCostWithoutSoldier(t: TacticalState, g: number, cost: number): number {
  const ref = doorObstacleIfClosed(cost, g);
  const replacement = ref.obstacleIfClosed ? TravelCost.DOOR : cost;
  const state = doorState(t.pathEnv, ref.door, false);
  let open: boolean;
  if (ref.door2 === -1) {
    if (!has(state, StructureFlags.ANYDOOR)) return cost;
    open = has(state, StructureFlags.OPEN);
  } else {
    const state2 = doorState(t.pathEnv, ref.door2, false);
    if (!has(state, StructureFlags.ANYDOOR) && !has(state2, StructureFlags.ANYDOOR)) return cost;
    if (!has(state, StructureFlags.OPEN) || !has(state2, StructureFlags.OPEN)) return replacement;
    open = true;
  }
  if (open) return ref.obstacleIfClosed ? terrainCost(t.pathWorld, g) : replacement;
  if (!ref.obstacleIfClosed) return terrainCost(t.pathWorld, g);
  const door = t.pathWorld.mapDoors.get(ref.door);
  return door && !door.locked ? terrainCost(t.pathWorld, g) : replacement;
}

function travelCostObstacle(t: TacticalState, g: number, dir: number, level: number): boolean {
  const cost = t.world.costs.get(g, dir, level);
  if (isDoorTravelCost(cost)) return doorCostWithoutSoldier(t, g, cost) >= TravelCost.BLOCKED;
  return cost === TravelCost.WALL;
}

const isThin = (s: StructureInstance | null) => s !== null && s.def.density <= THIN_DENSITY;

interface RayStop {
  readonly keepGoing: boolean;
  readonly range: number;
}

export function getRayStopInfo(
  t: TacticalState,
  g: number,
  dir: number,
  level: number,
  smoke: boolean,
  cnt: number,
  rangeIn: number,
): RayStop {
  let range = rangeIn;
  let obstacle = travelCostObstacle(t, g, dir, level);
  let reduce = true;
  const first = blockingStructureInfo(t, g, dir, level);
  let height = first.height;
  if (first.structure) {
    if (has(first.structure.flags, StructureFlags.CAVEWALL)) obstacle = true;
    else if (isThin(first.structure)) {
      obstacle = false;
      reduce = false;
    }
  }
  if (obstacle && smoke) {
    if (OPEN_WINDOWS.has(first.blocking)) obstacle = false;
    for (const side of [Direction.WEST, Direction.NORTH]) {
      if (!obstacle) break;
      const info = blockingStructureInfo(t, newGridNo(g, inc(side)), dir, level);
      height = info.height;
      if (OPEN_WINDOWS.has(info.blocking)) obstacle = false;
      if (isThin(info.structure)) {
        obstacle = false;
        reduce = false;
      }
    }
  } else if (obstacle) {
    if (CLOSED_WINDOWS.has(first.blocking) && first.structure) windowHit(t, g, first.structure.id, BLOWN_SOUTH.has(dir));
    for (const side of [Direction.WEST, Direction.NORTH]) {
      const neighbour = newGridNo(g, inc(side));
      const info = blockingStructureInfo(t, neighbour, dir, level);
      height = info.height;
      if (isThin(info.structure)) {
        obstacle = false;
        reduce = false;
      }
      if (CLOSED_WINDOWS.has(info.blocking) && info.structure) windowHit(t, neighbour, info.structure.id, false);
    }
  }
  let keepGoing: boolean;
  if (first.blocking !== Blocking.NOTHING && !obstacle) {
    if (height > TALL_STRUCTURE) keepGoing = false;
    else {
      if (reduce) range -= smoke ? smokeRangeReduction(height) : BLAST_RANGE_REDUCTION;
      keepGoing = cnt <= range;
    }
  } else keepGoing = !obstacle;
  if (level === 1 && !t.world.structures.find(g, StructureFlags.ROOF)) keepGoing = false;
  return { keepGoing, range };
}

function smokeRangeReduction(height: number): number {
  if (height === 3) return 2;
  if (height === 2) return 1;
  return 0;
}

interface SpreadContext {
  readonly bombGridNo: number;
  readonly item: number;
  readonly owner: Soldier | null;
  readonly sub: number;
  readonly level: number;
  readonly smoke: SmokeCloud | null;
  readonly changes: StructureChanges;
  anyMercHit: boolean;
}

function damageStructuresAround(t: TacticalState, ctx: SpreadContext, g: number, wound: number, distance: number): void {
  explosiveDamageGridNo(t, g, wound, distance, false, -1, ctx.owner, ctx.level, ctx.changes);
  for (const dir of [Direction.NORTH, Direction.WEST]) {
    const next = newGridNo(g, inc(dir));
    if (onVisibleWorldTile(t, next)) explosiveDamageGridNo(t, next, wound, distance, true, -1, ctx.owner, ctx.level, ctx.changes);
  }
}

function damageItemsOnGround(t: TacticalState, ctx: SpreadContext, g: number, damage: number): void {
  for (const wi of itemsAt(t, g, ctx.level)) {
    if (damageItemOnGround(t, wi.object, g, ctx.level, damage, ctx.owner)) removeWorldItem(t, wi);
  }
}

function hurtSoldiers(t: TacticalState, ctx: SpreadContext, g: number, distance: number, wound: number, breath: number): void {
  const target = whoIsThere(t, g, ctx.level);
  if (target) damageSoldierFromBlast(t, target, ctx.owner, ctx.bombGridNo, wound, breath, distance, ctx.item);
  if (ctx.level !== 1) return;
  const below = whoIsThere(t, g, 0);
  if (!below || Math.trunc(wound / 2) <= DEBRIS_THRESHOLD) return;
  const halfBreath = Math.trunc(breath / 2) - DEBRIS_THRESHOLD;
  const debrisBreath = halfBreath > 0 ? t.rng.int(halfBreath) : 1;
  const debrisWound = t.rng.int(Math.trunc(wound / 2) - DEBRIS_THRESHOLD);
  damageSoldierFromBlast(t, below, ctx.owner, ctx.bombGridNo, debrisWound, debrisBreath, distance, ctx.item);
}

function sprayedBlood(distance: number): number {
  const lost = distance * BLOOD_LOST_PER_TILE;
  return lost > MAX_BLOOD_QUANTITY ? 0 : MAX_BLOOD_QUANTITY - lost;
}

function expAffect(t: TacticalState, ctx: SpreadContext, g: number, distance: number): void {
  const explosive = ctx.item !== NOTHING ? itemDef(t, ctx.item)?.explosive : null;
  if (ctx.item !== NOTHING && !explosive) return;
  const blast = ctx.smoke ? null : (explosive?.blast ?? null);
  const stun = ctx.smoke ? null : (explosive?.stun ?? null);
  const gas = explosive?.smoke ?? null;
  const roll = blast || stun ? t.pre.int(100) : 0;
  let wound = 0;
  let breath = 0;
  if (blast) {
    wound = reduceDamageAmount(i16(blast.damage + Math.trunc((blast.damage * roll) / 100)), blast.radius, distance);
    if (wound > 0) {
      if (distance <= Math.max(1, Math.trunc(blast.damage / STRUCTURE_DAMAGE_PER_TILE))) damageStructuresAround(t, ctx, g, wound, distance);
      if (blast.damage > MIN_ITEM_BLAST_DAMAGE && distance * 2 <= blast.radius) damageItemsOnGround(t, ctx, g, wound * 2);
    }
  }
  if (stun) {
    const bd = stun.breathDamage;
    breath = reduceDamageAmount(i16(bd * 100 + Math.trunc((Math.trunc(bd / 2) * 100 * roll) / 100)), stun.radius, distance);
  }
  const gasType = gas ? smokeTypeOf(t, gas.type) : null;
  if (gasType) {
    if (ctx.sub === Spread.ERASE) removeSmokeEffectFromTile(t, g, ctx.level);
    else if (ctx.sub !== Spread.REDO && ctx.smoke) addSmokeEffectToTile(t, ctx.smoke, gasType, g, ctx.level);
  }
  if (ctx.sub === Spread.BLOOD) internalDropBlood(t, g, 0, BloodKind.HUMAN, sprayedBlood(distance), DROPPED_IN_SIGHT);
  if (ctx.sub === Spread.ERASE || ctx.sub === Spread.BLOOD) return;
  if (wound || breath) hurtSoldiers(t, ctx, g, distance, wound, breath);
  if (gasType) {
    const s = whoIsThere(t, g, ctx.level);
    if (!s) return;
    dishOutGasDamage(t, s, gasType, ctx.sub, ctx.owner);
  }
  ctx.anyMercHit = true;
}

function spreadBranch(
  t: TacticalState,
  ctx: SpreadContext,
  from: number,
  cnt: number,
  blastRange: number,
  dir: number,
  smoke: boolean,
): void {
  let spot = from;
  let branchRange = u8(blastRange - cnt);
  if (!branchRange) return;
  const branchDir = (dir + 1) % 8;
  for (let branchCnt = halfTilesPerStep(branchDir); branchCnt <= branchRange; branchCnt += halfTilesPerStep(branchDir)) {
    const next = newGridNo(spot, inc(branchDir));
    if (next === spot) continue;
    const stop = getRayStopInfo(t, next, branchDir, ctx.level, smoke, branchCnt, branchRange);
    branchRange = stop.range;
    if (!stop.keepGoing) continue;
    expAffect(t, ctx, next, Math.trunc((cnt + branchCnt) / 2));
    spot = next;
  }
}

function spreadRay(t: TacticalState, ctx: SpreadContext, g: number, blastRange: number, dir: number, smoke: boolean): void {
  let spot = g;
  let rayRange = blastRange;
  for (let cnt = halfTilesPerStep(dir); cnt <= rayRange; cnt += halfTilesPerStep(dir)) {
    const next = newGridNo(spot, inc(dir));
    if (next === spot) return;
    const stop = getRayStopInfo(t, next, dir, ctx.level, smoke, cnt, rayRange);
    rayRange = stop.range;
    if (!stop.keepGoing) return;
    spot = next;
    expAffect(t, ctx, next, Math.trunc(cnt / 2));
    spreadBranch(t, ctx, next, cnt, blastRange, dir, smoke);
  }
}

export function spreadEffect(
  t: TacticalState,
  g: number,
  radius: number,
  item: number,
  owner: Soldier | null,
  sub: number,
  level: number,
  smoke: SmokeCloud | null,
): void {
  const explosive = item !== NOTHING ? itemDef(t, item)?.explosive : null;
  const isSmoke = (explosive?.smoke ?? null) !== null && smoke !== null;
  const ctx: SpreadContext = { bombGridNo: g, item, owner, sub, level, smoke, changes: { gridNos: new Set() }, anyMercHit: false };
  const blastRange = radius * HALF_TILES_PER_STRAIGHT_STEP;
  expAffect(t, ctx, g, 0);
  for (let dir = Direction.NORTH; dir <= Direction.NORTHWEST; dir++) spreadRay(t, ctx, g, blastRange, dir, isSmoke);
  if (ctx.changes.gridNos.size > 0) {
    recompileChangedTiles(t, ctx.changes);
    recompileLocalMovementCosts(t.world.costs, t.world, g, MAX_RECOMPILE_RADIUS);
    checkPowPathsInAlmaPrison(t);
  }
  if (ctx.anyMercHit) t.explosives.hurtByExplosion.fill(0);
  if (sub !== Spread.BLOOD && explosive) makeNoise(t, null, g, level, explosive.noise, NoiseKind.EXPLOSION);
}

export function spreadEffectSmoke(t: TacticalState, cloud: SmokeCloud, sub: number, level: number): void {
  spreadEffect(t, cloud.gridNo, cloud.radius, cloud.item, cloud.owner, sub, level, cloud);
}
