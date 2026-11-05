// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Vehicles.h VEHICLETYPE, MAX_PASSENGERS_IN_VEHICLE; Tactical/Vehicles.cc
// @src AddVehicleToList (the garbage collection and the slot), RemoveVehicleFromList, FindSoldierType, GetNumberInVehicle.

import { type Sector, sameSector } from '../../content/strategic/sector-ids.ts';
import { isVehicleBody } from '../../content/strategic/vehicle-types.ts';
import { NO_VEHICLE } from '../strategic/forces/constants.ts';

export { isVehicleBody, VehicleTypeId, vehicleTypeOfBody } from '../../content/strategic/vehicle-types.ts';

export const MAX_PASSENGERS_IN_VEHICLE = 10;
export const NO_PASSENGER = -1;
export const NO_VEHICLE_SOLDIER = -1;
export const NO_MOVEMENT_GROUP = 0;

export interface VehicleRecord {
  valid: boolean;
  destroyed: boolean;
  type: number;
  sector: Sector;
  movementGroup: number;
  path: number[];
  betweenSectors: boolean;
  readonly passengers: number[];
  soldierId: number;
}

export interface VehicleSoldier {
  readonly bodyType: number;
  readonly vehicleId: number;
}

export function emptyPassengerSlots(): number[] {
  return new Array<number>(MAX_PASSENGERS_IN_VEHICLE).fill(NO_PASSENGER);
}

export function passengersOf(v: VehicleRecord): number[] {
  return v.passengers.filter((id) => id !== NO_PASSENGER);
}

export function numberInVehicle(v: VehicleRecord): number {
  return passengersOf(v).length;
}

function collectDestroyedVehiclesElsewhere(list: readonly VehicleRecord[], sector: Sector): void {
  for (const v of list) if (v.destroyed && !sameSector(v.sector, sector)) v.valid = false;
}

function firstFreeVehicleSlot(list: readonly VehicleRecord[]): number {
  const free = list.findIndex((v) => !v.valid);
  return free < 0 ? list.length : free;
}

export function fillVehicleSlot(list: VehicleRecord[], sector: Sector, type: number, movementGroups: readonly number[]): number {
  collectDestroyedVehiclesElsewhere(list, sector);
  const vid = firstFreeVehicleSlot(list);
  list[vid] = {
    valid: true,
    destroyed: false,
    type,
    sector: { x: sector.x, y: sector.y, z: sector.z },
    movementGroup: movementGroups[vid] ?? NO_MOVEMENT_GROUP,
    path: [],
    betweenSectors: false,
    passengers: emptyPassengerSlots(),
    soldierId: NO_VEHICLE_SOLDIER,
  };
  return vid;
}

export function removeVehicleFromList(v: VehicleRecord): void {
  v.path = [];
  v.valid = false;
}

export function validVehicle(list: readonly VehicleRecord[], id: number): VehicleRecord | null {
  if (id === NO_VEHICLE) return null;
  const v = list[id];
  return v?.valid ? v : null;
}

export function findSoldierType<S extends VehicleSoldier>(soldiers: Iterable<S | null | undefined>, vid: number): S | null {
  for (const s of soldiers) if (s && isVehicleBody(s.bodyType) && s.vehicleId === vid) return s;
  return null;
}
