// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc SoldierTakeDamage (the vehicle's share of the damage); Tactical/Vehicles.cc
// @src VehicleTakeDamage, HandleCriticalHitForVehicleInLocation.

import { NOTHING } from '../../content/items/items.ts';
import { i8, i16, idiv } from '../../core/int.ts';
import { findSoldierType, type VehicleRecord, validVehicle } from '../vehicles/vehicle-list.ts';
import { checkForAndHandleSoldierDeath } from './combat/death.ts';
import { DamageReason } from './combat/types.ts';
import { igniteExplosion } from './explosions/explosion.ts';
import { isTank, OKLIFE, type Soldier, Visible } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { shownId } from './unseen-sources.ts';

const GUNFIRE_DIVISOR = 3;
const BIG_EXPLOSION_DAMAGE = 50;
const BIG_EXPLOSION_FACTOR = 2;
const WRECK_EXPLOSION = 'GREAT_BIG_EXPLOSION';
const WRECK_EXPLOSION_Z = 0;
const GROUND_LEVEL = 0;

const HARMED_BY: ReadonlySet<number> = new Set([DamageReason.GUNFIRE, DamageReason.EXPLOSION, DamageReason.STRUCTURE_EXPLOSION]);

export function vehicleShareOfDamage(vehicle: Soldier, reason: number, damage: number): number {
  if (isTank(vehicle)) return damage;
  if (reason === DamageReason.GUNFIRE) return idiv(damage, GUNFIRE_DIVISOR);
  if (reason === DamageReason.EXPLOSION && damage > BIG_EXPLOSION_DAMAGE) return i16(damage * BIG_EXPLOSION_FACTOR);
  return damage;
}

export function vehicleTakeDamage(
  t: TacticalState,
  vid: number,
  reason: number,
  damage: number,
  gridNo: number,
  attacker: Soldier | null,
): void {
  const v = validVehicle(t.vehicles, vid);
  if (!v || v.destroyed || !HARMED_BY.has(reason)) return;
  handleCriticalHitForVehicleInLocation(t, v, vid, damage, gridNo, attacker);
}

function lowerCondition(t: TacticalState, vs: Soldier, damage: number): void {
  const before = vs.life;
  vs.life = damage > vs.life ? 0 : i8(vs.life - damage);
  if (vs.life < OKLIFE) vs.life = 0;
  vs.damageWindow = i16(vs.damageWindow + damage);
  if (!vs.placed || vs.visible === Visible.HIDDEN || damage === 0) return;
  vs.displayDamage = true;
  vs.damageWindowSteps = 0;
  if (vs.life < before) t.events.push({ type: 'lifeLost', soldier: vs.id, amount: before - vs.life, shown: vs.damageWindow });
}

function active(s: Soldier | null | undefined): s is Soldier {
  return s != null && (s.placed || s.offMap || s.away);
}

function wreckExplosion(t: TacticalState): number {
  return t.content.items.byName.get(WRECK_EXPLOSION)?.index ?? NOTHING;
}

function handleCriticalHitForVehicleInLocation(
  t: TacticalState,
  v: VehicleRecord,
  vid: number,
  damage: number,
  gridNo: number,
  attacker: Soldier | null,
): void {
  const vs = findSoldierType(t.soldiers.filter(active), vid);
  if (!vs) return;
  lowerCondition(t, vs, damage);
  if (vs.life !== 0) return;
  v.destroyed = true;
  const killer = shownId(t, attacker);
  t.events.push({ type: 'vehicleDestroyed', soldier: vs.id, vehicle: vid, ...(killer === undefined ? {} : { killer }) });
  igniteExplosion(t, attacker, WRECK_EXPLOSION_Z, gridNo, wreckExplosion(t), GROUND_LEVEL);
  checkForAndHandleSoldierDeath(t, vs);
  t.vehicleHooks.killAllInVehicle(v);
}
