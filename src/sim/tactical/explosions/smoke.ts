// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/SmokeEffects.cc GetSmokeEffectOnTile, FromWorldFlagsToSmokeType, NewSmokeEffect,
// @src AddSmokeEffectToTile, RemoveSmokeEffectFromTile, DecaySmokeEffects, IsSoldierAlreadyAffectedBySmokeEffect;
// @src Explosion_Control.cc DishOutGasDamage; Tactical/Overhead.cc running into gas (HandleGotoNewGridNo);
// @src Soldier_Control.cc SOLDIER_GASSED in SetSoldierGridNo and EVENT_BeginMercTurn; TacticalAI/AIUtils.cc InGas,
// @src InSmoke, WearGasMaskIfAvailable.

import { SmokeEffectId, type SmokeEffectType } from '../../../content/items/explosions.ts';
import { NOTHING } from '../../../content/items/items.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { i8, i16, idiv, u16, u32, udiv } from '../../../core/int.ts';
import { type ItemObject, swapObjects, USABLE_STATUS } from '../../items/object.ts';
import { soldierTakeDamage } from '../combat/hit.ts';
import { DamageReason } from '../combat/types.ts';
import { findObjWithin, InvSlot, NO_SLOT, NUM_INV_SLOTS } from '../inventory.ts';
import { stopMerc } from '../movement.ts';
import { processImplicationsOfPCAttack } from '../narrative/civ-hostility.ts';
import { allTeamsLookForAll } from '../perception/sight.ts';
import { Body, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { Spread, spreadEffectSmoke } from './explosion.ts';
import { type SmokeCloud, SmokeFlags, worldSeconds } from './state.ts';

export const SmokeTile = { SMOKE: 0x01, TEARGAS: 0x02, MUSTARDGAS: 0x04, DISSIPATING: 0x40, CREATUREGAS: 0x80 } as const;
export const ANY_SMOKE = SmokeTile.SMOKE | SmokeTile.TEARGAS | SmokeTile.MUSTARDGAS | SmokeTile.CREATUREGAS;
export const HitByGas = { TEARGAS: 0x01, MUSTARDGAS: 0x02, CREATUREGAS: 0x04 } as const;

const NUM_SMOKE_EFFECT_SLOTS = 25;
const INDOOR_EXTRA_DURATION = 3;
const DISSIPATING_TURNS = 2;
const REALTIME_UPDATE_SECONDS = 10;
const GASMASK_MIN_STATUS = 70;
const GASSED_BREATH = 500;
const STEP_INTO_GAS_DIE = 5;

const TILE_FLAG_BY_ID: Readonly<Record<number, number>> = {
  [SmokeEffectId.SMOKE]: SmokeTile.SMOKE,
  [SmokeEffectId.TEARGAS]: SmokeTile.TEARGAS,
  [SmokeEffectId.MUSTARDGAS]: SmokeTile.MUSTARDGAS,
  [SmokeEffectId.CREATUREGAS]: SmokeTile.CREATUREGAS,
};

const HIT_FLAG_BY_ID: Readonly<Record<number, number>> = {
  [SmokeEffectId.CREATUREGAS]: HitByGas.CREATUREGAS,
  [SmokeEffectId.TEARGAS]: HitByGas.TEARGAS,
  [SmokeEffectId.MUSTARDGAS]: HitByGas.MUSTARDGAS,
};

const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;
const isMonster = (s: Soldier) => s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER;
const levelOf = (cloud: SmokeCloud) => (cloud.flags & SmokeFlags.ON_ROOF ? 1 : 0);
const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;

export function smokeTypeOf(t: TacticalState, name: string): SmokeEffectType | null {
  return t.content.explosions.smokeEffects.get(name) ?? null;
}

function smokeTypeById(t: TacticalState, id: number): SmokeEffectType | null {
  for (const type of t.content.explosions.smokeEffects.values()) if (type.id === id) return type;
  return null;
}

export function smokeTileFlag(type: SmokeEffectType): number {
  return TILE_FLAG_BY_ID[type.id] ?? 0;
}

export function smokeFlagsAt(t: TacticalState, g: number, level: number): number {
  return t.explosives.smokeTiles[level > 0 ? 1 : 0][g] ?? 0;
}

export function smokeEffectIdFromFlags(flags: number): number {
  if (flags & SmokeTile.SMOKE) return SmokeEffectId.SMOKE;
  if (flags & SmokeTile.TEARGAS) return SmokeEffectId.TEARGAS;
  if (flags & SmokeTile.MUSTARDGAS) return SmokeEffectId.MUSTARDGAS;
  if (flags & SmokeTile.CREATUREGAS) return SmokeEffectId.CREATUREGAS;
  return SmokeEffectId.NOTHING;
}

export function smokeEffectOnTile(t: TacticalState, g: number, level: number): number {
  const flags = smokeFlagsAt(t, g, level);
  return flags & ANY_SMOKE ? smokeEffectIdFromFlags(flags) : SmokeEffectId.NOTHING;
}

export function smokeTypeOnTile(t: TacticalState, g: number, level: number): SmokeEffectType | null {
  const id = smokeEffectOnTile(t, g, level);
  return id === SmokeEffectId.NOTHING ? null : smokeTypeById(t, id);
}

export function wearingGasMask(t: TacticalState, s: Soldier): boolean {
  const mask = itemIndex(t, 'GASMASK');
  return s.inv[InvSlot.HEAD1]?.item === mask || s.inv[InvSlot.HEAD2]?.item === mask;
}

function headSlotForGasMask(s: Soldier): number {
  if (s.inv[InvSlot.HEAD1]?.item === NOTHING) return InvSlot.HEAD1;
  return s.inv[InvSlot.HEAD2]?.item === NOTHING ? InvSlot.HEAD2 : InvSlot.HEAD1;
}

export function wearGasMaskIfAvailable(t: TacticalState, s: Soldier): boolean {
  const slot = findObjWithin(s.inv, itemIndex(t, 'GASMASK'), 0, NUM_INV_SLOTS - 1);
  if (slot === NO_SLOT || slot === InvSlot.HEAD1 || slot === InvSlot.HEAD2) return false;
  swapObjects(s.inv[slot] as ItemObject, s.inv[headSlotForGasMask(s)] as ItemObject);
  return true;
}

function gasMaskSlot(t: TacticalState, s: Soldier, minStatus: number): number {
  const mask = itemIndex(t, 'GASMASK');
  for (const slot of [InvSlot.HEAD1, InvSlot.HEAD2]) {
    const o = s.inv[slot];
    if (o?.item === mask && (o.status[0] ?? 0) >= minStatus) return slot;
  }
  return -1;
}

export function inSmoke(t: TacticalState, s: Soldier, g: number): boolean {
  return (smokeFlagsAt(t, g, s.level) & SmokeTile.SMOKE) !== 0;
}

export function inGas(t: TacticalState, s: Soldier, g: number): boolean {
  return (smokeFlagsAt(t, g, s.level) & (SmokeTile.TEARGAS | SmokeTile.MUSTARDGAS)) !== 0 && !wearingGasMask(t, s);
}

export function inGasOrSmoke(t: TacticalState, s: Soldier, g: number): boolean {
  return inSmoke(t, s, g) || inGas(t, s, g);
}

export function isGassed(t: TacticalState, s: Soldier): boolean {
  return t.explosives.gassed[s.id] !== 0;
}

function alreadyAffected(t: TacticalState, s: Soldier, type: SmokeEffectType): boolean {
  return ((t.explosives.hitByGas[s.id] ?? 0) & (HIT_FLAG_BY_ID[type.id] ?? 0)) !== 0;
}

function dealsAnyDamage(type: SmokeEffectType): boolean {
  return type.damage > 0 || type.breathDamage > 0;
}

export function newSmokeEffect(t: TacticalState, g: number, item: number, level: number, owner: Soldier | null): void {
  const def = t.content.items.byIndex.get(item)?.explosive?.smoke;
  const type = def ? smokeTypeOf(t, def.type) : null;
  if (!def || !type) return;
  const clouds = t.explosives.smokeClouds;
  let slot = clouds.indexOf(null);
  if (slot === -1) {
    if (clouds.length >= NUM_SMOKE_EFFECT_SLOTS) return;
    slot = clouds.length;
    clouds.push(null);
  }
  const indoors = t.world.terrain[g] === Terrain.FLAT_FLOOR;
  const cloud: SmokeCloud = {
    gridNo: g,
    item,
    type: type.id,
    owner,
    duration: def.duration + (indoors ? INDOOR_EXTRA_DURATION : 0),
    radius: def.initialRadius,
    age: 0,
    flags: (indoors ? SmokeFlags.INDOORS : 0) | (level ? SmokeFlags.ON_ROOF : 0),
    lastUpdate: worldSeconds(t),
  };
  clouds[slot] = cloud;
  spreadEffectSmoke(t, cloud, Spread.NORMAL, level);
}

export function restoreSmokeCloud(t: TacticalState, cloud: SmokeCloud): void {
  t.explosives.smokeClouds.push(cloud);
  spreadEffectSmoke(t, cloud, Spread.SUBSEQUENT, levelOf(cloud));
}

export function addSmokeEffectToTile(t: TacticalState, cloud: SmokeCloud, type: SmokeEffectType, g: number, level: number): void {
  const dissipating = cloud.duration - cloud.age < DISSIPATING_TURNS;
  if (dissipating) removeSmokeEffectFromTile(t, g, level);
  const tiles = t.explosives.smokeTiles[level > 0 ? 1 : 0];
  if ((tiles[g] ?? 0) & ANY_SMOKE) return;
  tiles[g] = (tiles[g] ?? 0) | (TILE_FLAG_BY_ID[type.id] ?? 0) | (dissipating ? SmokeTile.DISSIPATING : 0);
}

export function removeSmokeEffectFromTile(t: TacticalState, g: number, level: number): void {
  const tiles = t.explosives.smokeTiles[level > 0 ? 1 : 0];
  tiles[g] = (tiles[g] ?? 0) & ~(ANY_SMOKE | SmokeTile.DISSIPATING);
}

function ageCloud(t: TacticalState, k: number, cloud: SmokeCloud, updates: number): void {
  for (let i = 0; i < updates; i++) {
    cloud.age++;
    if (cloud.age === 1) {
      cloud.flags |= SmokeFlags.MARK_FOR_UPDATE;
      continue;
    }
    if (cloud.age <= cloud.duration) {
      cloud.flags |= SmokeFlags.MARK_FOR_UPDATE;
      const maxRadius = t.content.items.byIndex.get(cloud.item)?.explosive?.smoke?.maxRadius ?? 0;
      if (cloud.radius < maxRadius) cloud.radius++;
      continue;
    }
    spreadEffectSmoke(t, cloud, Spread.ERASE, levelOf(cloud));
    t.explosives.smokeClouds[k] = null;
    return;
  }
}

export function decaySmokeEffects(t: TacticalState): void {
  const e = t.explosives;
  const now = worldSeconds(t);
  e.hitByGas.fill(0);
  let update = false;
  let updates = 1;
  const count = e.smokeClouds.length;
  for (let k = 0; k < count; k++) {
    const cloud = e.smokeClouds[k];
    if (!cloud) continue;
    if (t.inCombat) update = true;
    else if (u32(now - cloud.lastUpdate) > REALTIME_UPDATE_SECONDS) {
      update = true;
      updates = u16(udiv(u32(now - cloud.lastUpdate), REALTIME_UPDATE_SECONDS));
    }
    if (update) {
      cloud.lastUpdate = now;
      ageCloud(t, k, cloud, updates);
    } else spreadEffectSmoke(t, cloud, Spread.REDO, levelOf(cloud));
  }
  for (const cloud of e.smokeClouds) {
    if (!cloud || !(cloud.flags & SmokeFlags.MARK_FOR_UPDATE)) continue;
    spreadEffectSmoke(t, cloud, Spread.SUBSEQUENT, levelOf(cloud));
    cloud.flags &= ~SmokeFlags.MARK_FOR_UPDATE;
  }
  allTeamsLookForAll(t, true);
}

function wearMask(t: TacticalState, s: Soldier, slot: number, range: number): void {
  const mask = s.inv[slot];
  if (mask) mask.status[0] = i8((mask.status[0] ?? 0) - i8(t.rng.int(range)));
}

interface GasDose {
  wound: number;
  breath: number;
}

function filterThroughMask(t: TacticalState, s: Soldier, slot: number, dose: GasDose): void {
  const status = s.inv[slot]?.status[0] ?? 0;
  if (status < GASMASK_MIN_STATUS) {
    dose.breath = i16(idiv(dose.breath * (100 - status), 100));
    if (dose.breath > GASSED_BREATH) t.explosives.gassed[s.id] = 1;
    if (s.team !== Team.OUR) return;
    if (dose.wound > 1) {
      wearMask(t, s, slot, 4);
      dose.wound = i16(idiv(dose.wound * (100 - (s.inv[slot]?.status[0] ?? 0)), 100));
    } else if (dose.wound === 1) wearMask(t, s, slot, 2);
    return;
  }
  dose.breath = 0;
  if (dose.wound > 0) wearMask(t, s, slot, dose.wound === 1 ? 2 : 4);
  dose.wound = 0;
}

export function dishOutGasDamage(t: TacticalState, s: Soldier, type: SmokeEffectType, sub: number, owner: Soldier | null): void {
  const dose: GasDose = {
    wound: i16(type.damage + t.pre.int(type.damage)),
    breath: i16(100 * (type.breathDamage + t.pre.int(idiv(type.breathDamage, 2)))),
  };
  if (!s.placed || s.life === 0 || isRobot(s)) return;
  if (!dealsAnyDamage(type)) return;
  if (!type.affectsMonsters && isMonster(s)) return;
  if (sub && alreadyAffected(t, s, type)) return;
  const slot = gasMaskSlot(t, s, USABLE_STATUS);
  if (slot !== -1 && !type.ignoresGasMask) filterThroughMask(t, s, slot, dose);
  if (!dose.wound && !dose.breath) return;
  t.explosives.hitByGas[s.id] = (t.explosives.hitByGas[s.id] ?? 0) | (HIT_FLAG_BY_ID[type.id] ?? 0);
  soldierTakeDamage(t, s, dose.wound, dose.breath, DamageReason.GAS, null);
  if (owner && owner.team === Team.OUR && s.team !== Team.OUR) processImplicationsOfPCAttack(t, owner, s);
}

export function checkForRunningIntoGas(t: TacticalState, s: Soldier): boolean {
  if (s.pathIndex <= 0) return false;
  if (!(smokeFlagsAt(t, s.gridNo, s.level) & ANY_SMOKE) || t.pre.int(STEP_INTO_GAS_DIE) !== 0) return false;
  const type = smokeTypeById(t, smokeEffectOnTile(t, s.gridNo, s.level));
  if (!type) return false;
  const maskProtects = gasMaskSlot(t, s, GASMASK_MIN_STATUS) !== -1 && !type.ignoresGasMask;
  const robotImmune = isRobot(s) && !type.affectsRobot;
  if (maskProtects || robotImmune || !dealsAnyDamage(type) || alreadyAffected(t, s, type)) return false;
  stopMerc(t, s);
  dishOutGasDamage(t, s, type, Spread.SUBSEQUENT, null);
  return true;
}

export function updateGassedOnNewGridNo(t: TacticalState, s: Soldier, g: number): void {
  if (smokeEffectOnTile(t, g, s.level) === SmokeEffectId.NOTHING) return;
  if (gasMaskSlot(t, s, GASMASK_MIN_STATUS) !== -1) return;
  t.explosives.gassed[s.id] = 1;
}

export function clearGassedAtTurnStart(t: TacticalState, s: Soldier): void {
  if (!t.explosives.gassed[s.id]) return;
  if (wearingGasMask(t, s) || smokeEffectOnTile(t, s.gridNo, s.level) === SmokeEffectId.NOTHING) t.explosives.gassed[s.id] = 0;
}
