// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Vehicles.cc AddSoldierToVehicle (the seat at a ground vehicle), KillPersonInVehicle;
// @src Tactical/Soldier_Add.cc InternalAddSoldierToSector (a driver or passenger stops after his merc slot);
// @src Strategic/Strategic_Movement.cc GroupArrivedAtSector (the vehicle placed before its passengers); the EVENT_StopMerc of
// @src AddSoldierToVehicle, for a merc who boarded off the loaded map, at his next sector entry; AddSoldierToVehicle's
// @src RemoveSoldierFromGridNo for a vehicle with no soldier on the map, the helicopter, which keeps his opplist, and the
// @src helicopter's passengers over the loaded sector in their merc slots with no tile (2026-11-08); that EVENT_StopMerc's
// @src removePendingAnimation unless fDelayedMovement, and its fDelayedMovement cleared, as he boards off the loaded map or
// @src a vehicle off it (Vehicles.cc:266, Soldier_Control.cc:7381, 2026-11-09).

import { AnimFlags } from '../../content/anim/tables.ts';
import { hasAnimFlag, soldierGotoStationaryStance } from './animation.ts';
import { soldierTakeDamage } from './combat/hit.ts';
import { DamageReason } from './combat/types.ts';
import { dropHeldActions } from './give.ts';
import { removeSoldierFromGridNo, setSoldierPositionXY, stopMerc } from './movement.ts';
import { removePendingAction } from './pending-action.ts';
import { inSector, NO_PENDING_ANIMATION, NO_PENDING_DIRECTION, NOWHERE, type Soldier } from './soldier.ts';
import { registerSoldier, type TacticalState } from './state.ts';
import { vehicleCarrying } from './vehicle-presence.ts';

const KILLED_IN_VEHICLE_LIFE = 100;
const KILLED_IN_VEHICLE_BREATH = 100;

function waitInTheSectorWithNoTile(s: Soldier): void {
  s.placed = false;
  s.offMap = true;
}

export function seatAtVehicle(t: TacticalState, s: Soldier, vehicle: Soldier): void {
  removeSoldierFromGridNo(t, s);
  setSoldierPositionXY(t, s, vehicle.x, vehicle.y);
  stopMerc(t, s);
}

export function stopAsBoardedAwayFromTheVehicle(t: TacticalState | null, s: Soldier): void {
  if (!s.delayedMovement) {
    s.pendingAnimation = NO_PENDING_ANIMATION;
    s.pendingDirection = NO_PENDING_DIRECTION;
    if (t) removePendingAction(t, s);
    else dropHeldActions(s);
  }
  s.delayedMovement = 0;
}

export function seatWithNoVehicleOnTheMap(t: TacticalState, s: Soldier): void {
  if (!inSector(s)) return;
  removeSoldierFromGridNo(t, s);
  waitInTheSectorWithNoTile(s);
}

export function seatInTheHelicopterOnSectorEntry(t: TacticalState, s: Soldier): void {
  if (!t.mercSlots.includes(s)) registerSoldier(t, s);
  s.gridNo = NOWHERE;
  waitInTheSectorWithNoTile(s);
}

function haltAsBoarded(t: TacticalState, s: Soldier): void {
  s.pathIndex = 0;
  s.pathSize = 0;
  if (hasAnimFlag(t.content, s.state, AnimFlags.MOVING)) soldierGotoStationaryStance(t, s);
}

export function seatOnSectorEntry(t: TacticalState, s: Soldier): void {
  waitInTheSectorWithNoTile(s);
  haltAsBoarded(t, s);
  const vehicle = vehicleCarrying(t, s);
  if (vehicle?.placed) setSoldierPositionXY(t, s, vehicle.x, vehicle.y);
}

export function killPersonInVehicle(t: TacticalState, s: Soldier): boolean {
  if (s.life === 0) return false;
  soldierTakeDamage(t, s, KILLED_IN_VEHICLE_LIFE, KILLED_IN_VEHICLE_BREATH, DamageReason.BLOODLOSS, null);
  return true;
}
