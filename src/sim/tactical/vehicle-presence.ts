// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Find.cc IsOwnedMerc (a vehicle of ours is owned only with somebody aboard);
// @src Tactical/Soldier_Macros.h OK_CONTROLLABLE_MERC (a passenger's VEHICLE assignment takes no orders);
// @src Tactical/OppList.cc ManLooksForMan, NoticeUnseenAttacker (a vehicle of ours never looks);
// @src Tactical/Interface_Panels.cc GetUIApsToDisplay (the driver shows the vehicle's APs);
// @src Tactical/Vehicles.cc GetSoldierStructureForVehicle.

import { VehicleSeat } from '../strategic/forces/constants.ts';
import { isVehicleBody, numberInVehicle, passengersOf, type VehicleRecord, validVehicle } from '../vehicles/vehicle-list.ts';
import type { Refusal } from './refusal.ts';
import { inVehicle, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

type VehicleSource = Pick<TacticalState, 'vehicles' | 'soldiers'>;

export const IN_VEHICLE: Refusal = { token: 'inVehicle', reason: 'the soldier sits in a vehicle and takes no orders' };
export const NO_DRIVER: Refusal = { token: 'noDriver', reason: 'nobody sits in that vehicle of yours, so it takes no orders' };

function vehicleOfSoldier(t: Pick<TacticalState, 'vehicles'>, s: Soldier): VehicleRecord | null {
  return isVehicleBody(s.bodyType) ? validVehicle(t.vehicles, s.vehicleId) : null;
}

export function emptyVehicle(t: Pick<TacticalState, 'vehicles'>, s: Soldier): boolean {
  if (!isVehicleBody(s.bodyType)) return false;
  const v = vehicleOfSoldier(t, s);
  return v === null || numberInVehicle(v) === 0;
}

export function vehicleOfOurs(s: Soldier): boolean {
  return s.team === Team.OUR && isVehicleBody(s.bodyType);
}

export function crewRefusal(t: Pick<TacticalState, 'vehicles'>, s: Soldier): Refusal | null {
  if (inVehicle(s)) return IN_VEHICLE;
  return emptyVehicle(t, s) ? NO_DRIVER : null;
}

function vehicleIdCarrying(t: Pick<TacticalState, 'vehicles'>, s: Soldier): number {
  return t.vehicles.findIndex((v) => v?.valid && v.passengers.includes(s.id));
}

export function vehicleCarrying(t: VehicleSource, s: Soldier): Soldier | null {
  const v = t.vehicles[vehicleIdCarrying(t, s)];
  return v ? (t.soldiers[v.soldierId] ?? null) : null;
}

export function seatedVehicleId(t: Pick<TacticalState, 'vehicles'>, s: Soldier): number | null {
  const vid = inVehicle(s) ? vehicleIdCarrying(t, s) : -1;
  return vid < 0 ? null : vid;
}

export function passengersAboard(t: Pick<TacticalState, 'vehicles'>, s: Soldier): number[] {
  const v = vehicleOfSoldier(t, s);
  return v ? passengersOf(v) : [];
}

export function apsToDisplay(t: VehicleSource, s: Soldier): number {
  if (s.vehicleSeat !== VehicleSeat.DRIVER) return s.actionPoints;
  return vehicleCarrying(t, s)?.actionPoints ?? s.actionPoints;
}
