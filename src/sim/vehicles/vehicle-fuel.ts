// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc VehicleFuelRemaining, SpendVehicleFuel; Tactical/Vehicles.cc
// @src SetVehicleValuesIntoSoldierType (the full tank).

import { i8, i16, idiv } from '../../core/int.ts';

export const FULL_VEHICLE_FUEL = 10000;
export const FUEL_PER_PERCENT = 100;
export const FULL_VEHICLE_FUEL_PERCENT = idiv(FULL_VEHICLE_FUEL, FUEL_PER_PERCENT);

export interface VehicleFuel {
  breathRed: number;
  breath: number;
}

function fuelPercentRoundedUp(fuel: number): number {
  return i8(idiv(fuel + FUEL_PER_PERCENT - 1, FUEL_PER_PERCENT));
}

export function spendVehicleFuel(vs: VehicleFuel, spent: number): void {
  vs.breathRed = i16(Math.max(0, vs.breathRed - i16(spent)));
  vs.breath = fuelPercentRoundedUp(vs.breathRed);
}
