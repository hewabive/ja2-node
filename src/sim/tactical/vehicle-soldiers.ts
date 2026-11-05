// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc TacticalCreateSoldier (the vehicle bodies), InternalTacticalRemoveSoldier
// @src (fRemoveVehicle); Tactical/Vehicles.cc SetVehicleValuesIntoSoldierType; TileEngine/WorldDef.cc TrashWorld (the
// @src soldiers not on our team).

import { FULL_VEHICLE_FUEL, FULL_VEHICLE_FUEL_PERCENT } from '../vehicles/vehicle-fuel.ts';
import {
  fillVehicleSlot,
  isVehicleBody,
  removeVehicleFromList,
  type VehicleRecord,
  validVehicle,
  vehicleTypeOfBody,
} from '../vehicles/vehicle-list.ts';
import type { TacticalContent } from './content.ts';
import type { Refusal } from './refusal.ts';
import { type Soldier, Team } from './soldier.ts';
import type { SectorRef, TacticalState } from './state.ts';

const NO_SECTOR: SectorRef = { x: 0, y: 0, z: 0 };
const NO_MOVEMENT_GROUPS: readonly number[] = [];

export interface VehicleBoarding {
  okUseVehicle(vehicle: Soldier): boolean;
  putSoldierInVehicle(s: Soldier, vehicle: Soldier): Refusal | null;
  exitVehicle(s: Soldier): void;
  setAssignmentRepair(s: Soldier, vehicleUnderRepair: number): void;
}

export interface VehicleHooks {
  addVehicleToList(vehicles: VehicleRecord[], sector: SectorRef, type: number): number;
  killAllInVehicle(v: VehicleRecord): void;
  readonly boarding: VehicleBoarding | null;
}

export const PRIVATE_VEHICLE_LIST: VehicleHooks = {
  addVehicleToList: (vehicles, sector, type) => fillVehicleSlot(vehicles, sector, type, NO_MOVEMENT_GROUPS),
  killAllInVehicle: () => {},
  boarding: null,
};

export interface VehicleRegistry {
  readonly content: Pick<TacticalContent, 'vehicles'>;
  readonly vehicles?: VehicleRecord[];
  readonly vehicleHooks?: VehicleHooks;
  readonly sector?: SectorRef | null;
}

function setVehicleValuesIntoSoldierType(c: VehicleRegistry, s: Soldier, v: VehicleRecord): void {
  const type = c.content.vehicles[v.type];
  if (type) s.profile = type.profileId;
  s.breathRed = FULL_VEHICLE_FUEL;
  s.breath = FULL_VEHICLE_FUEL_PERCENT;
}

export function registerVehicleSoldier(c: VehicleRegistry, s: Soldier, givenVehicleId: number | undefined): void {
  const vehicles = c.vehicles;
  if (!vehicles) return;
  const hooks = c.vehicleHooks ?? PRIVATE_VEHICLE_LIST;
  s.vehicleId = givenVehicleId ?? hooks.addVehicleToList(vehicles, c.sector ?? NO_SECTOR, vehicleTypeOfBody(s.bodyType));
  const v = vehicles[s.vehicleId];
  if (!v) return;
  v.soldierId = s.id;
  setVehicleValuesIntoSoldierType(c, s, v);
}

export function removeVehicleOfSoldier(vehicles: readonly VehicleRecord[], s: Soldier): void {
  if (!isVehicleBody(s.bodyType)) return;
  const v = validVehicle(vehicles, s.vehicleId);
  if (v) removeVehicleFromList(v);
}

export function removeVehiclesNotOnOurTeam(t: Pick<TacticalState, 'vehicles' | 'soldiers'>): void {
  for (const s of t.soldiers) if (s && (s.placed || s.away) && s.team !== Team.OUR) removeVehicleOfSoldier(t.vehicles, s);
}
