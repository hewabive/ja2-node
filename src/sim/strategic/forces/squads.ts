// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Squads.cc InitSquads, AddCharacterToSquad, AddCharacterToAnySquad, AddCharacterToUniqueSquad,
// @src RemoveCharacterFromSquads, RebuildSquad, AddDeadCharacterToSquadDeadGuys, ResetDeadSquadMemberList, SectorSquadIsIn,
// @src IsThisSquadOnTheMove, CopyPathOfSquadToCharacter, CopyPathOfCharacterToSquad, NumberOfPlayerControllableMercsInSquad,
// @src DoesVehicleExistInSquad, CheckSquadMovementGroups; Strategic/Assignments.cc AssignMercToAMovementGroup;
// @src StrategicMap.cc HandleSoldierLeavingSectorByThemSelf; Vehicles.cc InitVehicles.

import { type Sector, sameSector } from '../../../content/strategic/sector-ids.ts';
import {
  Assignment,
  MAX_VEHICLES,
  NO_CURRENT_SQUAD,
  NO_GROUP,
  NO_VEHICLE,
  NUMBER_OF_DEAD_SOLDIERS_ON_SQUAD,
  NUMBER_OF_SQUADS,
} from './constants.ts';
import {
  addPlayerToGroup,
  createNewPlayerGroupDepartingFromSector,
  createNewVehicleGroupDepartingFromSector,
  type Group,
  getGroup,
  removeGroup,
  removePlayerFromGroup,
  requireMerc,
  setGroupSectorValue,
} from './groups.ts';
import { helicopterGroup, removeSoldierFromHelicopter } from './helicopter.ts';
import { placeGroupInSector } from './movement.ts';
import type { StrategicContext } from './ports.ts';
import { inHelicopter, takeSoldierOutOfVehicle } from './vehicles.ts';

const EMPTY_DEAD_SLOT = -1;
const PERSISTENT_GROUP_SECTOR: Sector = { x: 1, y: 1, z: 0 };

function squad(ctx: StrategicContext, q: number): number[] {
  const members = ctx.state.forces.squads[q];
  if (!members) throw new RangeError(`invalid squad number ${q}`);
  return members;
}

function persistentSquadGroup(ctx: StrategicContext): number {
  const g = createNewPlayerGroupDepartingFromSector(ctx, PERSISTENT_GROUP_SECTOR);
  g.persistent = true;
  return g.id;
}

export function initSquads(ctx: StrategicContext): void {
  const f = ctx.state.forces;
  f.squads = [];
  f.squadGroupIds = [];
  f.deadSquadMembers = [];
  for (let q = 0; q < NUMBER_OF_SQUADS; q++) {
    f.squads.push([]);
    f.squadGroupIds.push(persistentSquadGroup(ctx));
    f.deadSquadMembers.push(new Array<number>(NUMBER_OF_DEAD_SOLDIERS_ON_SQUAD).fill(EMPTY_DEAD_SLOT));
  }
}

export function initVehicles(ctx: StrategicContext): void {
  const f = ctx.state.forces;
  f.vehicleGroupIds = [];
  for (let k = 0; k < MAX_VEHICLES; k++) {
    const g = createNewVehicleGroupDepartingFromSector(ctx, PERSISTENT_GROUP_SECTOR);
    g.persistent = true;
    f.vehicleGroupIds.push(g.id);
  }
}

export function squadIsEmpty(ctx: StrategicContext, q: number): boolean {
  return squad(ctx, q).length === 0;
}

export function isThisSquadFull(ctx: StrategicContext, q: number): boolean {
  return squad(ctx, q).length >= ctx.content.policy.squadSize;
}

export function getFirstEmptySquad(ctx: StrategicContext): number {
  for (let q = 0; q < NUMBER_OF_SQUADS; q++) if (squadIsEmpty(ctx, q)) return q;
  throw new RangeError('Found no empty squad');
}

export function sectorSquadIsIn(ctx: StrategicContext, q: number): Sector | null {
  const first = squad(ctx, q)[0];
  return first === undefined ? null : requireMerc(ctx, first).sector;
}

export function isThisSquadOnTheMove(ctx: StrategicContext, q: number): boolean {
  const first = squad(ctx, q)[0];
  return first !== undefined && requireMerc(ctx, first).betweenSectors;
}

export function doesVehicleExistInSquad(ctx: StrategicContext, q: number): boolean {
  if (q === NO_CURRENT_SQUAD) return false;
  return squad(ctx, q).some((id) => requireMerc(ctx, id).isVehicle);
}

export function numberOfPeopleInSquad(ctx: StrategicContext, q: number): number {
  return q === NO_CURRENT_SQUAD ? 0 : squad(ctx, q).length;
}

export function numberOfPlayerControllableMercsInSquad(ctx: StrategicContext, q: number): number {
  if (q === NO_CURRENT_SQUAD) return 0;
  return squad(ctx, q).filter((id) => !requireMerc(ctx, id).isVehicle).length;
}

function copyPathOfSquadToCharacter(ctx: StrategicContext, id: number, q: number): void {
  const other = squad(ctx, q).find((m) => m !== id);
  if (other === undefined) return;
  requireMerc(ctx, id).path = [...requireMerc(ctx, other).path];
}

export function copyPathOfCharacterToSquad(ctx: StrategicContext, id: number, q: number): void {
  const path = requireMerc(ctx, id).path;
  for (const other of squad(ctx, q)) if (other !== id) requireMerc(ctx, other).path = [...path];
}

function isDeadGuyOnSquad(ctx: StrategicContext, profile: number, q: number): boolean {
  return ctx.state.forces.deadSquadMembers[q]?.includes(profile) === true;
}

function addDeadCharacterToSquadDeadGuys(ctx: StrategicContext, id: number, q: number): boolean {
  const profile = requireMerc(ctx, id).profile;
  for (let k = 0; k < NUMBER_OF_SQUADS; k++) if (isDeadGuyOnSquad(ctx, profile, k)) return true;
  const dead = ctx.state.forces.deadSquadMembers[q];
  if (!dead) return false;
  const free = dead.findIndex((p) => p === EMPTY_DEAD_SLOT || ctx.mercs.byProfile(p) === undefined);
  if (free < 0) return false;
  dead[free] = profile;
  return true;
}

export function resetDeadSquadMemberList(ctx: StrategicContext, q: number): void {
  const dead = ctx.state.forces.deadSquadMembers[q];
  if (dead) dead.fill(EMPTY_DEAD_SLOT);
}

export function removeCharacterFromSquads(ctx: StrategicContext, id: number): boolean {
  const f = ctx.state.forces;
  for (let q = 0; q < f.squads.length; q++) {
    const members = squad(ctx, q);
    const at = members.indexOf(id);
    if (at < 0) continue;
    members.splice(at, 1);
    const m = requireMerc(ctx, id);
    m.path = [];
    removePlayerFromGroup(ctx, id);
    if (m.betweenSectors && m.isVehicle) addPlayerToGroup(ctx, createNewPlayerGroupDepartingFromSector(ctx, m.sector), id);
    if (m.life === 0) addDeadCharacterToSquadDeadGuys(ctx, id, q);
    return true;
  }
  return false;
}

export type SquadJoinRefusal = 'cannotJoinSquad' | 'squadHasVehicle' | 'squadMoving' | 'squadFull' | 'squadElsewhere';

export function squadJoinRefusal(ctx: StrategicContext, id: number, q: number): SquadJoinRefusal | null {
  if (ctx.state.movement.exitingVehicleToSquad) return 'cannotJoinSquad';
  const s = requireMerc(ctx, id);
  if (doesVehicleExistInSquad(ctx, q) && !(s.isPassengerOrDriver || s.isVehicle)) return 'squadHasVehicle';
  if (isThisSquadOnTheMove(ctx, q)) return 'squadMoving';
  const members = squad(ctx, q);
  if (members.includes(id)) return null;
  if (members.length >= ctx.content.policy.squadSize) return 'squadFull';
  const at = sectorSquadIsIn(ctx, q);
  if (at && !sameSector(at, s.sector)) return 'squadElsewhere';
  return null;
}

export function addCharacterToSquad(ctx: StrategicContext, id: number, q: number): boolean {
  if (squadJoinRefusal(ctx, id, q)) return false;
  const s = requireMerc(ctx, id);
  const members = squad(ctx, q);
  if (members.includes(id)) return true;
  removeCharacterFromSquads(ctx, id);
  copyPathOfSquadToCharacter(ctx, id, q);
  if (s.groupId !== NO_GROUP) {
    const old = s.groupId;
    removePlayerFromGroup(ctx, id);
    if (s.assignment >= Assignment.ON_DUTY && s.assignment !== Assignment.VEHICLE) {
      const g = getGroup(ctx, old);
      if (g) removeGroup(ctx, g);
    }
  }
  const g = getGroup(ctx, ctx.state.forces.squadGroupIds[q] ?? NO_GROUP);
  if (!g) throw new RangeError(`squad ${q} has no movement group`);
  if (s.assignment !== Assignment.VEHICLE || s.vehicleId === NO_VEHICLE) joinSquadGroup(ctx, g, id);
  else if (inHelicopter(ctx, s)) leaveHelicopterForSquad(ctx, g, id, squadIsEmpty(ctx, q));
  else {
    ctx.state.movement.exitingVehicleToSquad = true;
    takeSoldierOutOfVehicle(ctx, id);
    ctx.state.movement.exitingVehicleToSquad = false;
    joinSquadGroup(ctx, g, id);
  }
  members.push(id);
  ctx.mercs.changeAssignment(id, q);
  const f = ctx.state.forces;
  if (ctx.state.flow === 'tactical' && (f.currentSquad === NO_CURRENT_SQUAD || squadIsEmpty(ctx, f.currentSquad))) f.currentSquad = q;
  return true;
}

function joinSquadGroup(ctx: StrategicContext, g: Group, id: number): void {
  addPlayerToGroup(ctx, g, id);
  setGroupSectorValue(ctx, requireMerc(ctx, id).sector, g);
}

function leaveHelicopterForSquad(ctx: StrategicContext, g: Group, id: number, newSquad: boolean): void {
  removeSoldierFromHelicopter(ctx, id);
  joinSquadGroup(ctx, g, id);
  const heli = newSquad ? helicopterGroup(ctx) : undefined;
  if (heli) placeGroupInSector(ctx, g, heli.prev, heli.sector, false);
}

export function addCharacterToAnySquad(ctx: StrategicContext, id: number): number {
  removeCharacterFromSquads(ctx, id);
  let firstEmpty = -1;
  for (let q = 0; q < NUMBER_OF_SQUADS; q++) {
    if (!squadIsEmpty(ctx, q)) {
      if (addCharacterToSquad(ctx, id, q)) return q;
    } else if (firstEmpty === -1) firstEmpty = q;
  }
  if (firstEmpty !== -1 && addCharacterToSquad(ctx, id, firstEmpty)) return firstEmpty;
  throw new RangeError('Failed to add character to any squad');
}

export function addCharacterToUniqueSquad(ctx: StrategicContext, id: number): number {
  removeCharacterFromSquads(ctx, id);
  const q = getFirstEmptySquad(ctx);
  addCharacterToSquad(ctx, id, q);
  return q;
}

export function assignMercToAMovementGroup(ctx: StrategicContext, id: number): boolean {
  const s = requireMerc(ctx, id);
  if (s.assignment < Assignment.ON_DUTY) return false;
  if (s.assignment === Assignment.VEHICLE) return false;
  if (s.assignment === Assignment.IN_TRANSIT) return false;
  if (s.groupId !== NO_GROUP) return false;
  addPlayerToGroup(ctx, createNewPlayerGroupDepartingFromSector(ctx, s.sector), id);
  return true;
}

export function handleSoldierLeavingSectorByThemSelf(ctx: StrategicContext, id: number): void {
  const s = requireMerc(ctx, id);
  if (s.assignment < Assignment.ON_DUTY) {
    removeCharacterFromSquads(ctx, id);
    if (s.groupId !== NO_GROUP) removePlayerFromGroup(ctx, id);
  } else if (s.groupId !== NO_GROUP && s.assignment !== Assignment.VEHICLE) {
    const g = getGroup(ctx, s.groupId);
    if (g) removeGroup(ctx, g);
    s.groupId = NO_GROUP;
  }
  addCharacterToUniqueSquad(ctx, id);
  if (s.groupId === NO_GROUP) addPlayerToGroup(ctx, createNewPlayerGroupDepartingFromSector(ctx, s.sector), id);
}

export function checkSquadMovementGroups(ctx: StrategicContext): void {
  const ids = ctx.state.forces.squadGroupIds;
  for (let q = 0; q < ids.length; q++) if (!getGroup(ctx, ids[q] ?? NO_GROUP)) ids[q] = persistentSquadGroup(ctx);
}
