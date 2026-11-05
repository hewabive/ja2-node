// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc VehicleFuelRemaining, SpendVehicleFuel, AddFuelToVehicle (the gas can,
// @src 2026-11-05); Tactical/Vehicles.cc SetVehicleValuesIntoSoldierType (the full tank).

import { i8, i16, idiv } from '../../core/int.ts';

export const FULL_VEHICLE_FUEL = 10000;
export const FUEL_PER_PERCENT = 100;
export const FULL_VEHICLE_FUEL_PERCENT = idiv(FULL_VEHICLE_FUEL, FUEL_PER_PERCENT);

const FUEL_PER_GAS_CAN_STATUS = 50;

export interface VehicleFuel {
  breathRed: number;
  breath: number;
}

export interface GasCan {
  readonly status: number[];
}

function fuelPercentRoundedUp(fuel: number): number {
  return i8(idiv(fuel + FUEL_PER_PERCENT - 1, FUEL_PER_PERCENT));
}

export function spendVehicleFuel(vs: VehicleFuel, spent: number): void {
  vs.breathRed = i16(Math.max(0, vs.breathRed - i16(spent)));
  vs.breath = fuelPercentRoundedUp(vs.breathRed);
}

function fuelPercentRoundedDown(fuel: number): number {
  return i8(idiv(fuel, FUEL_PER_PERCENT));
}

export function addFuelToVehicle(vs: VehicleFuel, can: GasCan): boolean {
  if (vs.breathRed === FULL_VEHICLE_FUEL) return false;
  const canStatus = can.status[0] ?? 0;
  const added = Math.min(i16(FULL_VEHICLE_FUEL - vs.breathRed), i16(canStatus * FUEL_PER_GAS_CAN_STATUS));
  vs.breathRed = i16(vs.breathRed + added);
  vs.breath = fuelPercentRoundedDown(vs.breathRed);
  can.status[0] = i8(canStatus - idiv(added, FUEL_PER_GAS_CAN_STATUS));
  return true;
}

export function isGasCanEmpty(can: GasCan): boolean {
  return (can.status[0] ?? 0) === 0;
}
