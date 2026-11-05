// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Vehicles.cc DoesVehicleNeedAnyRepairs, RepairVehicle, GetSoldierStructureForVehicle (a vehicle
// @src of ours from the roster, any other from the loaded sector); Strategic/Assignments.h VEHICLE_REPAIR_POINTS_DIVISOR.

import { i8, idiv } from '../../../core/int.ts';
import type { VehicleRecord } from '../../vehicles/vehicle-list.ts';
import { isHelicopter } from '../forces/vehicles.ts';
import type { EconomyContext, VehicleCondition } from './ports.ts';

export const VEHICLE_REPAIR_POINTS_DIVISOR = 10;

function vehicleSoldier(ctx: EconomyContext, v: VehicleRecord): VehicleCondition | null {
  return ctx.crew.get(v.soldierId) ?? ctx.hooks.loadedSectorSoldier(v.soldierId);
}

function damagedVehicleSoldier(ctx: EconomyContext, v: VehicleRecord): VehicleCondition | null {
  if (isHelicopter(ctx, v)) return null;
  const vs = vehicleSoldier(ctx, v);
  return vs !== null && vs.life !== vs.lifeMax ? vs : null;
}

export function doesVehicleNeedAnyRepairs(ctx: EconomyContext, v: VehicleRecord): boolean {
  return damagedVehicleSoldier(ctx, v) !== null;
}

export function repairVehicle(ctx: EconomyContext, v: VehicleRecord, pointsLeft: number): number {
  const vs = damagedVehicleSoldier(ctx, v);
  if (!vs) return 0;
  const before = vs.life;
  vs.life = i8(vs.life + idiv(i8(pointsLeft), VEHICLE_REPAIR_POINTS_DIVISOR));
  if (vs.life > vs.lifeMax) vs.life = vs.lifeMax;
  return i8((vs.life - before) * VEHICLE_REPAIR_POINTS_DIVISOR);
}
