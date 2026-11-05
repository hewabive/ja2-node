// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Turn_Based_Input.cc CheckForAndHandleHandleVehicleInteractiveClick, HandleMoveModeInteractiveClick
// @src (VEHICLE_CANT_MOVE_IN_TACTICAL); Tactical/Soldier_Macros.h OK_ENTERABLE_VEHICLE; Tactical/Soldier_Control.cc
// @src EVENT_SoldierEnterVehicle; externalized/Soldier.cc handlePendingAction (MERC_ENTER_VEHICLE); Tactical/Vehicles.cc
// @src PutSoldierInVehicle, ExitVehicle (the action tile, the insertion, the opplist entry, the position and the sight).

import { plotPathCost } from './ai/utils.ts';
import { unSetUIBusy } from './combat/barrier.ts';
import { findSoldierAtGridNo } from './combat/melee-reach.ts';
import { getNewSoldierPath, setSoldierPosition } from './movement.ts';
import { removePendingAction } from './pending-action.ts';
import { Opp, SightFlags } from './perception/opp.ts';
import { handleSight } from './perception/sight.ts';
import { enoughPoints } from './points.ts';
import type { Refusal } from './refusal.ts';
import { isEnterableVehicle, NOWHERE, OKLIFE, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { ClosestTo, findGridNoFromSweetSpotWithStructDataFromSoldier } from './sweet-spots.ts';

export const ENTER_VEHICLE_RADIUS = 5;
const EXIT_VEHICLE_RADIUS = 5;
const WIDER_EXIT_VEHICLE_RADIUS = 20;
const PATH_FROM_THE_UI = 3;

export const VEHICLE_CANT_MOVE: Refusal = { token: 'vehicleCantMove', reason: 'a vehicle does not move on the tactical map' };
export const NOT_IN_CAMPAIGN: Refusal = { token: 'notInCampaign', reason: 'vehicles are boarded and left in a campaign only' };
export const NOT_IN_VEHICLE: Refusal = { token: 'notInVehicle', reason: 'the merc is not in a vehicle' };
const NO_VEHICLE_TARGET: Refusal = { token: 'noSuchTarget', reason: 'vehicle must be a soldier the squad sees' };
const NOT_ENTERABLE: Refusal = { token: 'notEnterable', reason: 'nobody gets into that: not a vehicle, a tank, or a wreck' };
const NOT_ALLOWED: Refusal = { token: 'notAllowed', reason: 'that vehicle may not be used yet' };
const OCCUPIED: Refusal = { token: 'vehicleOccupied', reason: 'the move cursor boards no vehicle with somebody aboard' };
const NO_PATH: Refusal = { token: 'noPath', reason: 'no path to a tile beside the vehicle' };

export const BoardingCursor = { HAND: 'hand', MOVE: 'move' } as const;
export type BoardingCursor = (typeof BoardingCursor)[keyof typeof BoardingCursor];

export interface BoardingRules {
  usable(vehicle: Soldier): boolean;
  aboard(vehicle: Soldier): number;
}

export interface BoardingWalk {
  readonly vehicle: Soldier;
  readonly actionGridNo: number;
  readonly apCost: number;
}

export function okEnterableVehicle(s: Soldier): boolean {
  return isEnterableVehicle(s) && s.life >= OKLIFE;
}

export function isBoardingRefusal(check: BoardingWalk | Refusal): check is Refusal {
  return 'token' in check;
}

function notEnoughAp(s: Soldier, apCost: number): Refusal {
  return { token: 'notEnoughAP', reason: `not enough APs: ${apCost} needed, ${s.actionPoints} left` };
}

function walkCost(t: TacticalState, s: Soldier, g: number): number {
  return g === s.gridNo ? 0 : plotPathCost(t, s, g, s.uiMovementMode);
}

export function enterVehicleWalk(
  t: TacticalState,
  s: Soldier,
  vehicle: Soldier | null,
  cursor: BoardingCursor,
  rules: BoardingRules,
): BoardingWalk | Refusal {
  if (!vehicle) return NO_VEHICLE_TARGET;
  if (!okEnterableVehicle(vehicle)) return NOT_ENTERABLE;
  if (!rules.usable(vehicle)) return NOT_ALLOWED;
  if (cursor === BoardingCursor.MOVE && rules.aboard(vehicle) !== 0) return OCCUPIED;
  const animState = s.uiMovementMode;
  const actionGridNo = findGridNoFromSweetSpotWithStructDataFromSoldier(
    t,
    s,
    animState,
    ENTER_VEHICLE_RADIUS,
    ClosestTo.SWEET_SPOT,
    vehicle,
  );
  if (actionGridNo === NOWHERE) return NO_PATH;
  return { vehicle, actionGridNo, apCost: walkCost(t, s, actionGridNo) };
}

export function enterVehicleCheck(
  t: TacticalState,
  s: Soldier,
  vehicle: Soldier | null,
  cursor: BoardingCursor,
  rules: BoardingRules,
): BoardingWalk | Refusal {
  const walk = enterVehicleWalk(t, s, vehicle, cursor, rules);
  if (isBoardingRefusal(walk) || enoughPoints(t.inCombat, s, walk.apCost)) return walk;
  return notEnoughAp(s, walk.apCost);
}

export function putSoldierInVehicle(t: TacticalState, s: Soldier, vehicle: Soldier): Refusal | null {
  return t.vehicleHooks.boarding?.putSoldierInVehicle(s, vehicle) ?? NOT_IN_CAMPAIGN;
}

function walkUpToEnter(t: TacticalState, s: Soldier, vehicle: Soldier, actionGridNo: number): Refusal | null {
  removePendingAction(t, s);
  s.pendingTileTool = { tool: 'enterVehicle', gridNo: vehicle.gridNo, direction: vehicle.direction };
  if (getNewSoldierPath(t, s, actionGridNo, s.uiMovementMode, PATH_FROM_THE_UI, s.noAPToFinishMove)) return null;
  s.pendingTileTool = null;
  return NO_PATH;
}

export function enterVehicle(t: TacticalState, s: Soldier, walk: BoardingWalk): Refusal | null {
  if (s.gridNo !== walk.actionGridNo) return walkUpToEnter(t, s, walk.vehicle, walk.actionGridNo);
  return putSoldierInVehicle(t, s, walk.vehicle);
}

export function soldierEnterVehicle(t: TacticalState, s: Soldier, gridNo: number): void {
  const vehicle = findSoldierAtGridNo(t, gridNo, s.level);
  if (vehicle && okEnterableVehicle(vehicle)) putSoldierInVehicle(t, s, vehicle);
  unSetUIBusy(t, s);
}

function exitSpotWithin(t: TacticalState, s: Soldier, vehicle: Soldier, radius: number): number {
  return findGridNoFromSweetSpotWithStructDataFromSoldier(t, s, s.uiMovementMode, radius, ClosestTo.SWEET_SPOT_WITHOUT_STRUCTURE, vehicle);
}

export function vehicleExitSpot(t: TacticalState, s: Soldier, vehicle: Soldier): number {
  const near = exitSpotWithin(t, s, vehicle, EXIT_VEHICLE_RADIUS);
  return near !== NOWHERE ? near : exitSpotWithin(t, s, vehicle, WIDER_EXIT_VEHICLE_RADIUS);
}

export function placeOutOfVehicle(t: TacticalState, s: Soldier, vehicle: Soldier, gridNo: number): void {
  s.insertionGridNo = gridNo;
  s.insertionData = gridNo;
  s.oppList[vehicle.id] = Opp.SEEN_CURRENTLY;
  if (gridNo !== NOWHERE) setSoldierPosition(t, s, gridNo);
  handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO);
}
