// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc AddGroupToList, RemoveGroupFromList, GetGroup, Create*Group*, RemoveGroup,
// @src RemoveAllGroups, RemoveGroupWaypoints, AddPlayerToGroup, RemovePlayerFromPGroup, RemovePlayerFromGroup,
// @src CancelEmptyPersistentGroupMovement, SetGroupSectorValue, SetEnemyGroupSector, SetGroupNextSectorValue,
// @src PlayerMercsInSector, PlayerGroupsInSector, FindPlayer/EnemyMovementGroupInSector, GroupAtFinalDestination,
// @src GetFinalWaypoint, GroupHasInTransitDeadOrPOWMercs, DoesPlayerExistInPGroup; Queen_Command.cc NumEnemiesInSector,
// @src NumHostilesInSector, NumEnemiesInAnySector; Town_Militia.cc CountAllMilitiaInSector; Vehicles.cc GetVehicleFromMvtGroup;
// @src Map_Screen_Helicopter.cc IsGroupTheHelicopterGroup. See docs/16 §2, §3.11, §3.14.

import { TransportMask } from '../../../content/strategic/policy.ts';
import { NO_PREVIOUS_SECTOR_ID, type Sector, sameSector, sectorFromId, sectorId } from '../../../content/strategic/sector-ids.ts';
import { u8 } from '../../../core/int.ts';
import { findUndergroundSector, sectorInfo, totalMilitia } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { deleteStrategicEvent } from '../time/event-queue.ts';
import { Assignment, MAX_GROUP_ID, MoveType, NO_GROUP } from './constants.ts';
import { createHelicopterState, type HelicopterState } from './helicopter-state.ts';
import type { StrategicContext, StrategicMerc } from './ports.ts';

export interface Waypoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EnemyGroup {
  numTroops: number;
  numElites: number;
  numAdmins: number;
  pendingReinforcements: number;
  adminsInBattle: number;
  intention: number;
  troopsInBattle: number;
  elitesInBattle: number;
}

export interface Group {
  readonly id: number;
  debug: boolean;
  readonly player: boolean;
  vehicle: boolean;
  persistent: boolean;
  size: number;
  sector: Sector;
  next: Sector;
  prev: Sector;
  originalSector: number;
  createdSectorId: number;
  sectorIdOfLastReassignment: number;
  betweenSectors: boolean;
  moveType: number;
  nextWaypointId: number;
  arrivalTime: number;
  traverseTime: number;
  waypoints: Waypoint[];
  transportMask: number;
  flags: number;
  members: number[];
  readonly enemy: EnemyGroup | null;
}

export const MAX_PASSENGERS_IN_VEHICLE = 10;
export const NO_PASSENGER = -1;

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

export function emptyPassengerSlots(): number[] {
  return new Array<number>(MAX_PASSENGERS_IN_VEHICLE).fill(NO_PASSENGER);
}

export function passengersOf(v: VehicleRecord): number[] {
  return v.passengers.filter((id) => id !== NO_PASSENGER);
}

export interface ForcesState {
  groups: Group[];
  squads: number[][];
  squadGroupIds: number[];
  deadSquadMembers: number[][];
  currentSquad: number;
  vehicleGroupIds: number[];
  vehicles: VehicleRecord[];
  helicopterVehicleId: number;
  helicopterAirborne: boolean;
  helicopter: HelicopterState;
}

export function createForcesState(): ForcesState {
  return {
    groups: [],
    squads: [],
    squadGroupIds: [],
    deadSquadMembers: [],
    currentSquad: 0,
    vehicleGroupIds: [],
    vehicles: [],
    helicopterVehicleId: -1,
    helicopterAirborne: false,
    helicopter: createHelicopterState(),
  };
}

function noSector(): Sector {
  return { x: 0, y: 0, z: 0 };
}

export function getGroup(ctx: StrategicContext, id: number): Group | undefined {
  return ctx.state.forces.groups.find((g) => g.id === id);
}

export function lowestFreeGroupId(groups: readonly Group[]): number {
  const used = new Set(groups.map((g) => g.id));
  for (let id = 1; id <= MAX_GROUP_ID; id++) if (!used.has(id)) return id;
  throw new RangeError('Out of group IDs');
}

function newGroup(
  ctx: StrategicContext,
  fields: Pick<Group, 'player' | 'vehicle' | 'sector' | 'next' | 'moveType' | 'transportMask'>,
): Group {
  const groups = ctx.state.forces.groups;
  const original = sectorId(fields.sector);
  const g: Group = {
    id: lowestFreeGroupId(groups),
    debug: false,
    persistent: false,
    size: 0,
    prev: noSector(),
    originalSector: original,
    createdSectorId: original,
    sectorIdOfLastReassignment: 255,
    betweenSectors: false,
    nextWaypointId: 0,
    arrivalTime: 0,
    traverseTime: 0,
    waypoints: [],
    flags: 0,
    members: [],
    enemy: null,
    ...fields,
  };
  groups.push(g);
  return g;
}

export function createNewPlayerGroupDepartingFromSector(ctx: StrategicContext, s: Sector): Group {
  return newGroup(ctx, { player: true, vehicle: false, sector: s, next: s, moveType: MoveType.ONE_WAY, transportMask: TransportMask.FOOT });
}

export function createNewVehicleGroupDepartingFromSector(ctx: StrategicContext, s: Sector): Group {
  return newGroup(ctx, { player: true, vehicle: true, sector: s, next: s, moveType: MoveType.ONE_WAY, transportMask: TransportMask.CAR });
}

export function createNewEnemyGroupDepartingFromSector(
  ctx: StrategicContext,
  id: number,
  admins: number,
  troops: number,
  elites: number,
): Group {
  const groups = ctx.state.forces.groups;
  const s = sectorFromId(id);
  const g: Group = {
    id: lowestFreeGroupId(groups),
    debug: false,
    player: false,
    vehicle: false,
    persistent: false,
    size: u8(troops + elites),
    sector: s,
    next: noSector(),
    prev: noSector(),
    originalSector: u8(id),
    createdSectorId: u8(id),
    sectorIdOfLastReassignment: 255,
    betweenSectors: false,
    moveType: MoveType.CIRCULAR,
    nextWaypointId: 0,
    arrivalTime: 0,
    traverseTime: 0,
    waypoints: [],
    transportMask: TransportMask.FOOT,
    flags: 0,
    members: [],
    enemy: {
      numTroops: troops,
      numElites: elites,
      numAdmins: admins,
      pendingReinforcements: 0,
      adminsInBattle: 0,
      intention: 0,
      troopsInBattle: 0,
      elitesInBattle: 0,
    },
  };
  groups.push(g);
  return g;
}

export function removeGroupWaypoints(g: Group): void {
  if (g.waypoints.length === 0) return;
  g.waypoints = [];
  g.nextWaypointId = 0;
}

export function cancelEmptyPersistentGroupMovement(ctx: StrategicContext, g: Group): void {
  if (g.vehicle) return;
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
  removeGroupWaypoints(g);
  g.traverseTime = 0;
  g.arrivalTime = 0;
  g.betweenSectors = false;
  g.prev = noSector();
  g.sector = noSector();
  g.next = noSector();
}

function removeGroupFromList(ctx: StrategicContext, g: Group): void {
  const groups = ctx.state.forces.groups;
  const at = groups.indexOf(g);
  if (at >= 0) groups.splice(at, 1);
}

export function removeGroup(ctx: StrategicContext, g: Group, removingAll = false): void {
  if (g.persistent && !removingAll) {
    cancelEmptyPersistentGroupMovement(ctx, g);
    return;
  }
  removeGroupWaypoints(g);
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
  if (g.player) g.members = [];
  else ctx.ai.removeGroupFromLists(g);
  removeGroupFromList(ctx, g);
  if (ctx.state.encounter.battleGroup === g.id) ctx.state.encounter.battleGroup = null;
}

export function removeAllGroups(ctx: StrategicContext): void {
  while (ctx.state.forces.groups.length > 0) {
    const g = ctx.state.forces.groups[0];
    if (g) removeGroup(ctx, g, true);
  }
}

export function requireMerc(ctx: StrategicContext, id: number): StrategicMerc {
  const m = ctx.mercs.get(id);
  if (!m) throw new RangeError(`no merc ${id}`);
  return m;
}

export function addPlayerToGroup(ctx: StrategicContext, g: Group, id: number): void {
  const m = requireMerc(ctx, id);
  m.groupId = g.id;
  if (g.members.length === 0) {
    g.members = [id];
    g.size = 1;
    g.prev = sectorFromId(m.prevSectorId);
    g.sector = m.sector;
    return;
  }
  g.members.push(id);
  g.size = u8(g.size + 1);
}

export function removePlayerFromPGroup(ctx: StrategicContext, g: Group, id: number): void {
  const at = g.members.indexOf(id);
  if (at < 0) return;
  g.members.splice(at, 1);
  const m = requireMerc(ctx, id);
  m.prevSectorId = sectorId(g.prev);
  m.groupId = NO_GROUP;
  g.size = u8(g.size - 1);
  if (g.size !== 0) return;
  if (!g.persistent) removeGroup(ctx, g);
  else cancelEmptyPersistentGroupMovement(ctx, g);
}

export function removePlayerFromGroup(ctx: StrategicContext, id: number): void {
  const m = requireMerc(ctx, id);
  const g = getGroup(ctx, m.groupId);
  if (!g) {
    m.groupId = NO_GROUP;
    return;
  }
  removePlayerFromPGroup(ctx, g, id);
}

export function groupMembers(ctx: StrategicContext, g: Group): StrategicMerc[] {
  return g.members.map((id) => requireMerc(ctx, id));
}

export function groupHasInTransitDeadOrPowMercs(ctx: StrategicContext, g: Group): boolean {
  return g.members.some((id) => {
    const a = ctx.mercs.get(id)?.assignment;
    return a === Assignment.IN_TRANSIT || a === Assignment.ASSIGNMENT_POW || a === Assignment.ASSIGNMENT_DEAD;
  });
}

export function vehicleOfGroup(ctx: StrategicContext, g: Group): VehicleRecord {
  const v = ctx.state.forces.vehicles.find((x) => x.valid && x.movementGroup === g.id);
  if (!v) throw new RangeError(`group ${g.id} does not contain a vehicle`);
  return v;
}

export function isHelicopterGroup(ctx: StrategicContext, g: Group): boolean {
  const f = ctx.state.forces;
  if (f.helicopterVehicleId === -1) return false;
  const heli = f.vehicles[f.helicopterVehicleId];
  return heli !== undefined && heli.movementGroup !== 0 && heli.movementGroup === g.id;
}

export function isHelicopterVehicle(ctx: StrategicContext, v: VehicleRecord): boolean {
  const f = ctx.state.forces;
  return f.helicopterVehicleId !== -1 && f.vehicles[f.helicopterVehicleId] === v;
}

export function vehicleGroupHasPassengers(ctx: StrategicContext, g: Group): boolean {
  return passengersOf(vehicleOfGroup(ctx, g)).length > 0;
}

function airborneHelicopterGroup(ctx: StrategicContext, g: Group): boolean {
  return isHelicopterGroup(ctx, g) && ctx.state.forces.helicopterAirborne;
}

export function findPlayerMovementGroupInSector(ctx: StrategicContext, s: Sector | null): Group | undefined {
  if (!s) return undefined;
  return ctx.state.forces.groups.find(
    (g) =>
      g.player &&
      g.size !== 0 &&
      !g.betweenSectors &&
      sameSector(g.sector, s) &&
      g.sector.z === 0 &&
      !groupHasInTransitDeadOrPowMercs(ctx, g) &&
      !airborneHelicopterGroup(ctx, g),
  );
}

export function findEnemyMovementGroupInSector(ctx: StrategicContext, s: Sector): Group | undefined {
  return ctx.state.forces.groups.find((g) => !g.player && sameSector(g.sector, s));
}

export function playerMercsInSector(ctx: StrategicContext, s: Sector): number {
  let n = 0;
  for (const g of ctx.state.forces.groups) {
    if (!g.player || g.betweenSectors || !sameSector(g.sector, s)) continue;
    for (const m of groupMembers(ctx, g)) if (m.life !== 0 && !m.isVehicle) n = u8(n + 1);
  }
  return n;
}

export function playerGroupsInSector(ctx: StrategicContext, s: Sector): number {
  let n = 0;
  for (const g of ctx.state.forces.groups) {
    if (!g.player || g.betweenSectors || !sameSector(g.sector, s)) continue;
    if (groupMembers(ctx, g).some((m) => m.life !== 0)) n = u8(n + 1);
  }
  return n;
}

export function getFinalWaypoint(g: Group): Waypoint | undefined {
  return g.waypoints[g.waypoints.length - 1];
}

export function groupAtFinalDestination(g: Group): boolean {
  if (g.moveType !== MoveType.ONE_WAY) return false;
  const wp = getFinalWaypoint(g);
  if (!wp) return true;
  return sameSector(g.sector, wp);
}

function mobileEnemiesIn(ctx: StrategicContext, s: Sector): number {
  let n = 0;
  for (const g of ctx.state.forces.groups) if (!g.player && !g.vehicle && sameSector(g.sector, s)) n = u8(n + g.size);
  return n;
}

export function numEnemiesInSector(ctx: StrategicContext, s: Sector): number {
  const info = sectorInfo(ctx.state.map, s);
  return u8(info.numAdmins + info.numTroops + info.numElites + mobileEnemiesIn(ctx, s));
}

export function numEnemiesInAnySector(ctx: StrategicContext, s: Sector): number {
  if (s.z) {
    const u = findUndergroundSector(ctx.state.map, s);
    return u ? u8(u.numElites + u.numTroops + u.numAdmins) : 0;
  }
  return numEnemiesInSector(ctx, s);
}

export function numHostilesInSector(ctx: StrategicContext, s: Sector): number {
  if (s.z) {
    const u = findUndergroundSector(ctx.state.map, s);
    return u ? u8(u.numElites + u.numTroops + u.numAdmins + u.numCreatures) : 0;
  }
  const info = sectorInfo(ctx.state.map, s);
  return u8(info.numAdmins + info.numTroops + info.numElites + info.numCreatures + mobileEnemiesIn(ctx, s));
}

export function countAllMilitiaInSector(ctx: StrategicContext, s: Sector): number {
  return totalMilitia(sectorInfo(ctx.state.map, s));
}

export function setLocationOfAllPlayerSoldiersInGroup(ctx: StrategicContext, g: Group, s: Sector): void {
  for (const m of groupMembers(ctx, g)) m.sector = s;
  if (!g.vehicle) return;
  const v = vehicleOfGroup(ctx, g);
  v.sector = s;
  if (isHelicopterVehicle(ctx, v)) return;
  const vs = ctx.mercs.get(v.soldierId);
  if (vs) vs.sector = s;
}

export function setGroupSectorValue(ctx: StrategicContext, s: Sector, g: Group): void {
  removeGroupWaypoints(g);
  g.sector = s;
  g.next = s;
  g.betweenSectors = false;
  g.originalSector = sectorId(s);
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
  for (const m of groupMembers(ctx, g)) {
    m.sector = s;
    m.betweenSectors = false;
  }
  ctx.world.checkAndHandleUnloadingOfCurrentWorld();
}

export function setEnemyGroupSector(ctx: StrategicContext, g: Group, id: number): void {
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
  if (!ctx.state.movement.randomizingPatrolGroup) removeGroupWaypoints(g);
  const s = sectorFromId(id);
  g.sector = s;
  g.next = s;
  g.betweenSectors = false;
}

export function setGroupNextSectorValue(g: Group, s: Sector): void {
  removeGroupWaypoints(g);
  g.next = s;
  g.betweenSectors = false;
  g.originalSector = sectorId(g.sector);
}

export function groupPreviousSectorIsNone(g: Group): boolean {
  return sectorId(g.prev) === NO_PREVIOUS_SECTOR_ID && g.prev.x === 16 && g.prev.y === 16;
}
