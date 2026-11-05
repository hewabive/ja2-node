// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Vehicles.cc AddSoldierToVehicle (the seat at a ground vehicle), KillPersonInVehicle;
// @src Tactical/Soldier_Add.cc InternalAddSoldierToSector (a driver or passenger stops after his merc slot);
// @src Strategic/Strategic_Movement.cc GroupArrivedAtSector (the vehicle placed before its passengers); the EVENT_StopMerc of
// @src AddSoldierToVehicle, for a merc who boarded off the loaded map, at his next sector entry.

import { AnimFlags } from '../../content/anim/tables.ts';
import { hasAnimFlag, soldierGotoStationaryStance } from './animation.ts';
import { soldierTakeDamage } from './combat/hit.ts';
import { DamageReason } from './combat/types.ts';
import { removeSoldierFromGridNo, setSoldierPositionXY, stopMerc } from './movement.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { vehicleCarrying } from './vehicle-presence.ts';

const KILLED_IN_VEHICLE_LIFE = 100;
const KILLED_IN_VEHICLE_BREATH = 100;

export function seatAtVehicle(t: TacticalState, s: Soldier, vehicle: Soldier): void {
  removeSoldierFromGridNo(t, s);
  setSoldierPositionXY(t, s, vehicle.x, vehicle.y);
  stopMerc(t, s);
}

function haltAsBoarded(t: TacticalState, s: Soldier): void {
  s.pathIndex = 0;
  s.pathSize = 0;
  if (hasAnimFlag(t.content, s.state, AnimFlags.MOVING)) soldierGotoStationaryStance(t, s);
}

export function seatOnSectorEntry(t: TacticalState, s: Soldier): void {
  s.placed = false;
  s.offMap = true;
  haltAsBoarded(t, s);
  const vehicle = vehicleCarrying(t, s);
  if (vehicle?.placed) setSoldierPositionXY(t, s, vehicle.x, vehicle.y);
}

export function killPersonInVehicle(t: TacticalState, s: Soldier): boolean {
  if (s.life === 0) return false;
  soldierTakeDamage(t, s, KILLED_IN_VEHICLE_LIFE, KILLED_IN_VEHICLE_BREATH, DamageReason.BLOODLOSS, null);
  return true;
}
