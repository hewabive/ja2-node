// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Vehicles.cc AddVehicleToList, RemoveVehicleFromList, GetVehicle, GetNumberInVehicle,
// @src GetNumberOfNonEPCsInVehicle, IsEnoughSpaceInVehicle, GetVehicleSeats, RemoveSoldierFromVehicle, TakeSoldierOutOfVehicle,
// @src ExitVehicle (strategic part), SetSoldierExitHelicopterInsertionData, SetVehicleSectorValues, KillAllInVehicle,
// @src KillPersonInVehicle, TeleportVehicleToItsClosestSector, MoveCharactersPathToVehicle, SetUpMvtGroupForVehicle,
// @src IsThisVehicleAccessibleToSoldier (without OKUseVehicle); Strategic/Map_Screen_Interface_Map.cc CancelPathForVehicle;
// @src Strategic/Map_Screen_Helicopter.h IsHelicopter, InHelicopter.

import { type Sector, sameSector, sectorFromId } from '../../../content/strategic/sector-ids.ts';
import { OKLIFE } from '../../tactical/soldier.ts';
import { setSectorFlag } from '../map/sectors.ts';
import { worldDay, worldTotalMinutes } from '../time/world-clock.ts';
import { Assignment, InsertionCode, NO_VEHICLE, SectorFlag } from './constants.ts';
import {
  addPlayerToGroup,
  emptyPassengerSlots,
  getGroup,
  NO_PASSENGER,
  passengersOf,
  removePlayerFromGroup,
  requireMerc,
  type VehicleRecord,
} from './groups.ts';
import { placeGroupInSector, rebuildWayPointsForGroupPath } from './movement.ts';
import { type StrategicContext, type StrategicMerc, VehicleRole } from './ports.ts';
import { addCharacterToUniqueSquad, removeCharacterFromSquads } from './squads.ts';

export const HELICOPTER_EXIT_GRIDNO_AT_AIRPORT = 10125;

export function vehicleSeats(ctx: StrategicContext, v: VehicleRecord): number {
  return ctx.content.vehicles[v.type]?.seats ?? 0;
}

export function numberInVehicle(v: VehicleRecord): number {
  return passengersOf(v).length;
}

export function isEnoughSpaceInVehicle(ctx: StrategicContext, v: VehicleRecord): boolean {
  return numberInVehicle(v) !== vehicleSeats(ctx, v);
}

export function findVehicle(ctx: StrategicContext, id: number): VehicleRecord | null {
  const v = ctx.state.forces.vehicles[id];
  return v?.valid ? v : null;
}

export function getVehicle(ctx: StrategicContext, id: number): VehicleRecord {
  const v = findVehicle(ctx, id);
  if (!v) throw new RangeError(`invalid vehicle id ${id}`);
  return v;
}

export function vehicleIdOf(ctx: StrategicContext, v: VehicleRecord): number {
  return ctx.state.forces.vehicles.indexOf(v);
}

export function isHelicopter(ctx: StrategicContext, v: VehicleRecord): boolean {
  return vehicleIdOf(ctx, v) === ctx.state.forces.helicopterVehicleId;
}

export function inHelicopter(ctx: StrategicContext, m: StrategicMerc): boolean {
  return m.assignment === Assignment.VEHICLE && m.vehicleId === ctx.state.forces.helicopterVehicleId;
}

export function isThisVehicleAccessibleToSoldier(m: StrategicMerc, v: VehicleRecord): boolean {
  return !m.betweenSectors && !v.betweenSectors && sameSector(m.sector, v.sector) && !v.destroyed;
}

export function addVehicleToList(ctx: StrategicContext, s: Sector, type: number): number {
  const f = ctx.state.forces;
  for (const v of f.vehicles) if (v.destroyed && !sameSector(v.sector, s)) v.valid = false;
  let vid = f.vehicles.findIndex((v) => !v.valid);
  if (vid < 0) vid = f.vehicles.length;
  const record: VehicleRecord = {
    valid: true,
    destroyed: false,
    type,
    sector: { ...s },
    movementGroup: f.vehicleGroupIds[vid] ?? 0,
    path: [],
    betweenSectors: false,
    passengers: emptyPassengerSlots(),
    soldierId: -1,
  };
  f.vehicles[vid] = record;
  const g = getGroup(ctx, record.movementGroup);
  if (!g) return vid;
  g.transportMask = ctx.content.vehicles[type]?.movementType ?? g.transportMask;
  g.sector = { ...s };
  g.next = { ...s };
  g.traverseTime = 0;
  g.arrivalTime = 0;
  return vid;
}

export function removeVehicleFromList(v: VehicleRecord): void {
  v.path = [];
  v.valid = false;
}

export function setVehicleSectorValues(ctx: StrategicContext, v: VehicleRecord, s: Sector): void {
  v.sector = { ...s };
  for (const id of passengersOf(v)) {
    const m = requireMerc(ctx, id);
    m.sector = { ...s };
    m.betweenSectors = false;
  }
}

export function cancelPathForVehicle(ctx: StrategicContext, v: VehicleRecord, alreadyReversed: boolean): void {
  v.path = [];
  const g = getGroup(ctx, v.movementGroup);
  if (!g) return;
  g.waypoints = [];
  g.nextWaypointId = 0;
  if (!alreadyReversed) rebuildWayPointsForGroupPath(ctx, v.path, g);
}

function vehicleIdOfSoldier(m: StrategicMerc): number {
  if (m.isVehicle || m.assignment === Assignment.VEHICLE) return m.vehicleId;
  return NO_VEHICLE;
}

export function setUpMvtGroupForVehicle(ctx: StrategicContext, m: StrategicMerc): void {
  const v = findVehicle(ctx, vehicleIdOfSoldier(m));
  if (!v) return;
  m.path = [...v.path];
  m.groupId = v.movementGroup;
}

export function moveCharactersPathToVehicle(ctx: StrategicContext, m: StrategicMerc): boolean {
  const v = findVehicle(ctx, vehicleIdOfSoldier(m));
  if (!v) {
    m.path = [];
    return false;
  }
  v.path = [...m.path];
  m.path = [];
  return true;
}

export function setSoldierExitHelicopterInsertionData(ctx: StrategicContext, m: StrategicMerc): void {
  if (ctx.mercs.inTacticalSector?.(m.id)) return;
  if (sameSector(m.sector, sectorFromId(ctx.content.shipping.primaryDeliverySector))) {
    m.insertionCode = InsertionCode.GRIDNO;
    ctx.mercs.setInsertionData?.(m.id, HELICOPTER_EXIT_GRIDNO_AT_AIRPORT);
  } else m.insertionCode = InsertionCode.CENTER;
}

function teleportVehicleToItsClosestSector(ctx: StrategicContext, groupId: number): void {
  const g = getGroup(ctx, groupId);
  if (!g) return;
  const now = worldTotalMinutes(ctx.state.clock);
  const toNext = g.arrivalTime - now;
  const toLast = g.traverseTime - toNext;
  const [prev, next] = toNext >= toLast ? [g.next, g.sector] : [g.sector, g.next];
  g.arrivalTime = now;
  placeGroupInSector(ctx, g, prev, next, false);
}

function emptyGroundVehicle(ctx: StrategicContext, v: VehicleRecord): void {
  const vs = ctx.mercs.get(v.soldierId);
  if (!vs) return;
  if (vs.path.length > 0) cancelPathForVehicle(ctx, v, false);
  if (v.betweenSectors) teleportVehicleToItsClosestSector(ctx, vs.groupId);
  removeCharacterFromSquads(ctx, vs.id);
  const g = getGroup(ctx, v.movementGroup);
  if (g && !g.members.includes(vs.id)) addPlayerToGroup(ctx, g, vs.id);
  ctx.mercs.changeAssignment(vs.id, Assignment.ASSIGNMENT_EMPTY);
}

export function removeSoldierFromVehicle(ctx: StrategicContext, id: number): boolean {
  const m = requireMerc(ctx, id);
  const v = getVehicle(ctx, m.vehicleId);
  const slot = v.passengers.indexOf(id);
  if (slot < 0) return false;
  v.passengers[slot] = NO_PASSENGER;
  removePlayerFromGroup(ctx, id);
  m.sector = { ...v.sector };
  ctx.mercs.setVehicleRole?.(id, VehicleRole.NONE);
  if (isHelicopter(ctx, v)) {
    if (m.life >= OKLIFE) setSectorFlag(ctx.state.map, m.sector, SectorFlag.ALREADY_VISITED, worldDay(ctx.state.clock));
    setSoldierExitHelicopterInsertionData(ctx, m);
    const world = ctx.state.worldSector;
    if (world && sameSector(m.sector, world)) ctx.mercs.updateMercInSector(id, world);
    return true;
  }
  if (numberInVehicle(v) === 0) emptyGroundVehicle(ctx, v);
  return true;
}

function exitVehicle(ctx: StrategicContext, id: number): boolean {
  const m = requireMerc(ctx, id);
  removeSoldierFromVehicle(ctx, id);
  m.vehicleId = NO_VEHICLE;
  const world = ctx.state.worldSector;
  if (world) ctx.mercs.updateMercInSector(id, world);
  addCharacterToUniqueSquad(ctx, id);
  return true;
}

export function takeSoldierOutOfVehicle(ctx: StrategicContext, id: number): boolean {
  const m = requireMerc(ctx, id);
  if (m.assignment !== Assignment.VEHICLE) return false;
  const world = ctx.state.worldSector;
  const loadedHere = world !== null && sameSector(m.sector, world) && ctx.mercs.inTacticalSector?.(id) === true;
  if (loadedHere && !inHelicopter(ctx, m)) return exitVehicle(ctx, id);
  return removeSoldierFromVehicle(ctx, id);
}

export function killAllInVehicle(ctx: StrategicContext, v: VehicleRecord): number[] {
  const killed: number[] = [];
  for (const id of [...v.passengers]) {
    if (id === NO_PASSENGER) continue;
    if (!ctx.helicopter.killInVehicle(id)) break;
    killed.push(id);
  }
  return killed;
}
