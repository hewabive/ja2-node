// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc ControllingRobot, CanRobotBeControlled, UpdateRobotControllerGivenRobot,
// @src UpdateRobotControllerGivenController; Tactical/Squads.cc IsRobotControllerInSquad; Tactical/Vehicles.cc
// @src IsRobotControllerInVehicle; Strategic/PreBattle_Interface.cc CheckForRobotAndIfItsControlled. See docs/25 §9.4.

import { sameSector } from '../../content/strategic/sector-ids.ts';
import { Assignment, NO_CURRENT_SQUAD } from '../strategic/forces/constants.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { wearsHeadGear } from '../tactical/inventory.ts';
import { OKLIFE } from '../tactical/soldier.ts';
import type { RosterMerc } from './roster.ts';

export interface RobotCrew {
  get(id: number): RosterMerc | undefined;
  byProfile(profile: number): RosterMerc | undefined;
  all(): readonly RosterMerc[];
}

export function robotOnTeam(crew: RobotCrew): RosterMerc | null {
  return crew.byProfile(Npc.ROBOT) ?? null;
}

export function controllingRobot(crew: RobotCrew, remote: number, s: RosterMerc): boolean {
  if (s.isEpc) return false;
  if (s.life < OKLIFE) return false;
  if (s.assignment >= Assignment.ON_DUTY && s.assignment !== Assignment.VEHICLE) return false;
  if (!wearsHeadGear(s.inv, remote)) return false;
  const robot = robotOnTeam(crew);
  if (!robot || !sameSector(robot.sector, s.sector) || robot.betweenSectors !== s.betweenSectors) return false;
  if (!robot.betweenSectors) return true;
  if (robot.assignment !== s.assignment) return false;
  return robot.assignment !== Assignment.VEHICLE || robot.vehicleId === s.vehicleId;
}

export function robotRemoteHolder(crew: RobotCrew, robot: RosterMerc): RosterMerc | null {
  return robot.remoteHolder === null ? null : (crew.get(robot.remoteHolder) ?? null);
}

export function canRobotBeControlled(crew: RobotCrew, remote: number, robot: RosterMerc): boolean {
  const holder = robotRemoteHolder(crew, robot);
  return holder !== null && controllingRobot(crew, remote, holder);
}

export function updateRobotControllerGivenRobot(crew: RobotCrew, remote: number, robot: RosterMerc): void {
  robot.remoteHolder = crew.all().find((s) => controllingRobot(crew, remote, s))?.id ?? null;
}

export function updateRobotControllerGivenController(crew: RobotCrew, remote: number, s: RosterMerc): void {
  if (!controllingRobot(crew, remote, s)) return;
  for (const m of crew.all()) if (m.isRobot) m.remoteHolder = s.id;
}

export function checkForRobotAndIfItsControlled(crew: RobotCrew, remote: number): void {
  const robot = crew.all().find((m) => m.life !== 0 && m.isRobot);
  if (!robot) return;
  updateRobotControllerGivenRobot(crew, remote, robot);
  const holder = robotRemoteHolder(crew, robot);
  if (holder) updateRobotControllerGivenController(crew, remote, holder);
}

export function robotControllerInSquad(crew: RobotCrew, remote: number, squad: number): boolean {
  if (squad === NO_CURRENT_SQUAD) return false;
  return crew.all().some((s) => s.assignment === squad && controllingRobot(crew, remote, s));
}

export function robotControllerInVehicle(crew: RobotCrew, remote: number, vehicleId: number): boolean {
  return crew
    .all()
    .some((s) => !s.isVehicle && s.assignment === Assignment.VEHICLE && s.vehicleId === vehicleId && controllingRobot(crew, remote, s));
}
