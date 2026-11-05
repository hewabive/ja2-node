// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Vehicles.h (the vehicle types); Tactical/Soldier_Create.cc TacticalCreateSoldier (the vehicle
// @src type of each vehicle body).

import { Body } from '../anim/body-types.ts';

export const VehicleTypeId = { ELDORADO_CAR: 0, HUMMER: 1, ICE_CREAM_TRUCK: 2, JEEP_CAR: 3, TANK_CAR: 4, HELICOPTER: 5 } as const;

const VEHICLE_TYPE_OF_BODY: Readonly<Record<number, number>> = {
  [Body.HUMVEE]: VehicleTypeId.HUMMER,
  [Body.ELDORADO]: VehicleTypeId.ELDORADO_CAR,
  [Body.ICECREAMTRUCK]: VehicleTypeId.ICE_CREAM_TRUCK,
  [Body.JEEP]: VehicleTypeId.JEEP_CAR,
  [Body.TANK_NW]: VehicleTypeId.TANK_CAR,
  [Body.TANK_NE]: VehicleTypeId.TANK_CAR,
};

export function isVehicleBody(bodyType: number): boolean {
  return VEHICLE_TYPE_OF_BODY[bodyType] !== undefined;
}

export function vehicleTypeOfBody(bodyType: number): number {
  const type = VEHICLE_TYPE_OF_BODY[bodyType];
  if (type === undefined) throw new RangeError(`body ${bodyType} is not a vehicle`);
  return type;
}
