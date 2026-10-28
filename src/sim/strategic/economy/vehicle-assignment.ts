// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc CanCharacterVehicle, VehicleMenuBtnCallback, HandleShadingOfLinesForVehicleMenu;
// @src Tactical/Vehicles.cc AddSoldierToVehicle (strategic part), PutSoldierInVehicle, IsThisVehicleAccessibleToSoldier,
// @src AnyAccessibleVehiclesInSoldiersSector, CanSoldierDriveVehicle, OnlyThisSoldierCanDriveVehicle, SoldierMustDriveVehicle.

import { sameSector } from '../../../content/strategic/sector-ids.ts';
import { addPlayerToGroup, getGroup, NO_PASSENGER, removeGroup, removePlayerFromGroup, type VehicleRecord } from '../forces/groups.ts';
import { okUseVehicle } from '../forces/helicopter.ts';
import { VehicleRole } from '../forces/ports.ts';
import { addCharacterToUniqueSquad, removeCharacterFromSquads } from '../forces/squads.ts';
import {
  findVehicle,
  isHelicopter,
  isThisVehicleAccessibleToSoldier,
  numberInVehicle,
  takeSoldierOutOfVehicle,
  vehicleIdOf,
  vehicleSeats,
} from '../forces/vehicles.ts';
import { changeSoldiersAssignment, setTimeOfAssignmentChange } from './assignment-done.ts';
import { AC, areAssignmentConditionsMet, isMechanical } from './conditions.ts';
import { Assignment, BREATHMAX_ABSOLUTE_MINIMUM, OKLIFE } from './constants.ts';
import type { CrewMember, EconomyContext } from './ports.ts';

export function isVehicleAccessibleToSoldier(ctx: EconomyContext, s: CrewMember, v: VehicleRecord): boolean {
  return isThisVehicleAccessibleToSoldier(s, v) && okUseVehicle(ctx, v);
}

export function anyAccessibleVehiclesInSoldiersSector(ctx: EconomyContext, s: CrewMember): boolean {
  return ctx.state.forces.vehicles.some((v) => v.valid && isVehicleAccessibleToSoldier(ctx, s, v));
}

export function canCharacterVehicle(ctx: EconomyContext, s: CrewMember): boolean {
  const world = ctx.state.worldSector;
  return (
    ctx.state.flow === 'strategic' &&
    anyAccessibleVehiclesInSoldiersSector(ctx, s) &&
    (!ctx.world.enemyInSector() || world === null || !sameSector(s.sector, world)) &&
    areAssignmentConditionsMet(ctx, s, AC.EPC | AC.MECHANICAL)
  );
}

function takeVehicleOver(ctx: EconomyContext, v: VehicleRecord): boolean {
  const vs = ctx.crew.get(v.soldierId);
  if (!vs) return false;
  if (numberInVehicle(v) !== 0) return true;
  addCharacterToUniqueSquad(ctx, vs.id);
  removePlayerFromGroup(ctx, vs.id);
  const g = getGroup(ctx, v.movementGroup);
  if (!g) return true;
  if (!g.members.includes(vs.id)) addPlayerToGroup(ctx, g, vs.id);
  else vs.groupId = v.movementGroup;
  return true;
}

function leavePreviousPlace(ctx: EconomyContext, s: CrewMember): void {
  if (s.assignment === Assignment.VEHICLE) takeSoldierOutOfVehicle(ctx, s.id);
  if (s.assignment < Assignment.ON_DUTY) removeCharacterFromSquads(ctx, s.id);
  else if (s.groupId !== 0) {
    const g = getGroup(ctx, s.groupId);
    if (g) removeGroup(ctx, g);
    s.groupId = 0;
  }
}

export function addSoldierToVehicle(ctx: EconomyContext, s: CrewMember, v: VehicleRecord): boolean {
  if (!isHelicopter(ctx, v) && !takeVehicleOver(ctx, v)) return false;
  if (v.passengers.includes(s.id)) return true;
  const vid = vehicleIdOf(ctx, v);
  const seats = vehicleSeats(ctx, v);
  for (let slot = 0; slot < seats; slot++) {
    if (v.passengers[slot] !== NO_PASSENGER) continue;
    v.passengers[slot] = s.id;
    leavePreviousPlace(ctx, s);
    if (s.assignment !== Assignment.VEHICLE || s.vehicleId !== vid) setTimeOfAssignmentChange(ctx, s);
    changeSoldiersAssignment(ctx, s, Assignment.VEHICLE);
    s.vehicleId = vid;
    const g = getGroup(ctx, v.movementGroup);
    if (v.movementGroup !== 0 && g) addPlayerToGroup(ctx, g, s.id);
    ctx.mercs.setVehicleRole?.(s.id, numberInVehicle(v) === 1 ? VehicleRole.DRIVER : VehicleRole.PASSENGER);
    if (ctx.mercs.removeFromGridNo) ctx.mercs.removeFromGridNo(s.id);
    else ctx.mercs.removeFromTacticalSector(s.id);
    return true;
  }
  return false;
}

function canSoldierDriveVehicle(ctx: EconomyContext, s: CrewMember, vid: number, ignoreAsleep: boolean): boolean {
  return (
    s.assignment === Assignment.VEHICLE &&
    vid === s.vehicleId &&
    vid !== ctx.state.forces.helicopterVehicleId &&
    (ignoreAsleep || !s.asleep) &&
    !isMechanical(s) &&
    !s.isEpc &&
    s.life >= OKLIFE &&
    s.breathMax > BREATHMAX_ABSOLUTE_MINIMUM
  );
}

function onlyThisSoldierCanDriveVehicle(ctx: EconomyContext, s: CrewMember, vid: number): boolean {
  return !ctx.crew.all().some((other) => other !== s && canSoldierDriveVehicle(ctx, other, vid, false));
}

export function soldierMustDriveVehicle(ctx: EconomyContext, s: CrewMember, tryingToTravel: boolean): boolean {
  const vid = s.vehicleId;
  const v = findVehicle(ctx, vid);
  if (!v) return false;
  if (!tryingToTravel && !v.betweenSectors && v.path.length === 0) return false;
  return canSoldierDriveVehicle(ctx, s, vid, true) && onlyThisSoldierCanDriveVehicle(ctx, s, vid);
}
