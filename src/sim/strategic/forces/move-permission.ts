// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc CanCharacterMoveInStrategic, CanEntireMovementGroupMercIsInMove;
// @src Assignments.cc PlayerSoldierTooTiredToTravel (through MercPort.tooTiredToTravel); Tactical/Squads.cc
// @src IsRobotControllerInSquad and Tactical/Vehicles.cc IsRobotControllerInVehicle (through MercPort); the bloodcat
// @src ambush and the museum chalice checks of CanCharacterMoveInStrategic (2026-11-01).

import { sameSector } from '../../../content/strategic/sector-ids.ts';
import { MuseumRooms } from '../../tactical/narrative/constants.ts';
import { isProfileDead } from '../../tactical/profiles.ts';
import { OKLIFE } from '../../tactical/soldier.ts';
import { Npc } from '../narrative/npc-ids.ts';
import { Assignment, EncounterCode } from './constants.ts';
import { numHostilesInSector } from './groups.ts';
import { soldierAboardAirborneHeli } from './helicopter.ts';
import type { StrategicContext, StrategicMerc } from './ports.ts';

export const MoveRefusal = {
  TRANSIT: 'inTransit',
  POW: 'prisoner',
  UNDERGROUND: 'underground',
  VEHICLE_EMPTY: 'vehicleEmpty',
  VEHICLE_DAMAGED: 'vehicleDamaged',
  DEAD: 'dead',
  TOO_INJURED: 'tooInjured',
  COMBAT: 'inCombat',
  ENEMY: 'enemiesPresent',
  BUSY: 'onAssignment',
  TOO_TIRED: 'tooTired',
  EPC_ALONE: 'escortAlone',
  ROBOT_ALONE: 'robotAlone',
  CANNOT_LEAVE: 'cannotLeaveSector',
  MUSEUM: 'museumChalice',
} as const;
export type MoveRefusal = (typeof MoveRefusal)[keyof typeof MoveRefusal];

const MARIA = 88;
const SAN_MONA_C5 = { x: 5, y: 3 } as const;
const MUSEUM_SECTOR = { x: 12, y: 12, z: 0 } as const;
const NO_ROOM = 0;
const CHALICE = 'CHALICE';

export interface LoadedSectorStatus {
  readonly inCombat: boolean;
}

function passengers(ctx: StrategicContext, vehicleId: number): number {
  return ctx.mercs.all().filter((m) => !m.isVehicle && m.assignment === Assignment.VEHICLE && m.vehicleId === vehicleId).length;
}

function escortWithoutGuard(ctx: StrategicContext, m: StrategicMerc): boolean {
  if (!m.isEpc) return false;
  const guarded = (o: StrategicMerc) => !o.isEpc && !o.isVehicle && o.life > 0;
  if (m.assignment === Assignment.VEHICLE)
    return !ctx.mercs.all().some((o) => o.assignment === Assignment.VEHICLE && o.vehicleId === m.vehicleId && guarded(o));
  if (m.assignment < Assignment.ON_DUTY) return !ctx.mercs.all().some((o) => o.assignment === m.assignment && guarded(o));
  return false;
}

function robotWithoutController(ctx: StrategicContext, m: StrategicMerc): boolean {
  if (m.assignment === Assignment.VEHICLE) return !(ctx.mercs.robotControllerInVehicle?.(m.vehicleId) ?? true);
  if (m.assignment < Assignment.ON_DUTY) return !(ctx.mercs.robotControllerInSquad?.(m.assignment) ?? true);
  return false;
}

function stuckInSector(m: StrategicMerc): boolean {
  return m.profile === MARIA && m.sector.x === SAN_MONA_C5.x && m.sector.y === SAN_MONA_C5.y;
}

function bloodcatAmbushGoesOn(ctx: StrategicContext): boolean {
  return ctx.world.hostileBloodcatsPresent() && ctx.state.encounter.code === EncounterCode.BLOODCAT_AMBUSH;
}

function hostilesHere(ctx: StrategicContext, m: StrategicMerc, loaded: LoadedSectorStatus): MoveRefusal | null {
  if (m.betweenSectors || soldierAboardAirborneHeli(ctx, m)) return null;
  const world = ctx.state.worldSector;
  if (world && sameSector(world, m.sector)) {
    if (loaded.inCombat) return MoveRefusal.COMBAT;
    if (ctx.world.enemyInSector()) return MoveRefusal.ENEMY;
    if (bloodcatAmbushGoesOn(ctx)) return MoveRefusal.COMBAT;
  }
  return numHostilesInSector(ctx, m.sector) > 0 ? MoveRefusal.ENEMY : null;
}

function museumGuardAlive(ctx: StrategicContext): boolean {
  const eldin = ctx.state.profiles.get(Npc.ELDIN);
  return !eldin || !isProfileDead(eldin);
}

function inMuseumRooms(ctx: StrategicContext, m: StrategicMerc): boolean {
  const room = ctx.mercs.roomOf?.(m.id) ?? NO_ROOM;
  return room >= MuseumRooms.FIRST && room <= MuseumRooms.LAST;
}

function leavingMuseumWithChalice(ctx: StrategicContext, m: StrategicMerc): boolean {
  if (!sameSector(m.sector, MUSEUM_SECTOR) || m.betweenSectors || !museumGuardAlive(ctx) || !inMuseumRooms(ctx, m)) return false;
  return ctx.mercs.all().some((o) => ctx.mercs.carries?.(o.id, CHALICE) === true);
}

export function canCharacterMoveInStrategic(ctx: StrategicContext, m: StrategicMerc, loaded: LoadedSectorStatus): MoveRefusal | null {
  if (m.assignment === Assignment.IN_TRANSIT) return MoveRefusal.TRANSIT;
  if (m.assignment === Assignment.ASSIGNMENT_POW) return MoveRefusal.POW;
  if (m.sector.z !== 0) return MoveRefusal.UNDERGROUND;
  if (m.isVehicle) {
    if (passengers(ctx, m.vehicleId) === 0) return MoveRefusal.VEHICLE_EMPTY;
    if (m.life < OKLIFE) return MoveRefusal.VEHICLE_DAMAGED;
  } else {
    if (m.life <= 0) return MoveRefusal.DEAD;
    if (m.life < OKLIFE) return MoveRefusal.TOO_INJURED;
  }
  const hostile = hostilesHere(ctx, m, loaded);
  if (hostile) return hostile;
  if (leavingMuseumWithChalice(ctx, m)) return MoveRefusal.MUSEUM;
  if (m.assignment >= Assignment.ON_DUTY && m.assignment !== Assignment.VEHICLE) return MoveRefusal.BUSY;
  if (ctx.mercs.tooTiredToTravel(m.id)) return MoveRefusal.TOO_TIRED;
  if (m.isRobot) {
    if (robotWithoutController(ctx, m)) return MoveRefusal.ROBOT_ALONE;
  } else if (escortWithoutGuard(ctx, m)) return MoveRefusal.EPC_ALONE;
  if (stuckInSector(m)) return MoveRefusal.CANNOT_LEAVE;
  return null;
}

export function canEntireMovementGroupMove(ctx: StrategicContext, id: number, loaded: LoadedSectorStatus): MoveRefusal | null {
  const merc = ctx.mercs.get(id);
  if (!merc) return null;
  const own = canCharacterMoveInStrategic(ctx, merc, loaded);
  if (own) return own;
  for (const other of ctx.mercs.all()) {
    if (other.id === id || merc.groupId === 0 || other.groupId !== merc.groupId) continue;
    const refusal = canCharacterMoveInStrategic(ctx, other, loaded);
    if (refusal) return refusal;
  }
  return null;
}
