import { describe, expect, it } from 'vitest';
import { Assignment } from '../strategic/forces/constants.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { Body, createSoldier, Team } from '../tactical/soldier.ts';
import {
  canRobotBeControlled,
  checkForRobotAndIfItsControlled,
  controllingRobot,
  type RobotCrew,
  robotControllerInSquad,
  robotControllerInVehicle,
  updateRobotControllerGivenController,
  updateRobotControllerGivenRobot,
} from './robot-control.ts';
import { MercKind, RosterMerc } from './roster.ts';

const REMOTE = 259;
const ROBOT = 62;
const SQUAD = 2;
const OTHER_SQUAD = 3;
const VEHICLE_ID = 1;
const D13 = { x: 13, y: 4, z: 0 };
const STATS = {
  agility: 50,
  dexterity: 50,
  strength: 50,
  wisdom: 50,
  leadership: 50,
  marksmanship: 50,
  mechanical: 50,
  explosives: 50,
  medical: 50,
  experience: 3,
};

interface MercOptions {
  readonly profile?: number;
  readonly kind?: number;
  readonly body?: number;
  readonly remote?: boolean;
  readonly assignment?: number;
  readonly life?: number;
}

function merc(id: number, options: MercOptions = {}): RosterMerc {
  const soldier = createSoldier({
    id,
    team: Team.OUR,
    name: `M${id}`,
    profile: options.profile ?? id,
    bodyType: options.body ?? Body.REGMALE,
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    stats: { ...STATS },
    life: options.life ?? 60,
    gridNo: 0,
    direction: 0,
    state: 0,
  });
  const head = soldier.inv[InvSlot.HEAD1];
  if (options.remote && head) head.item = REMOTE;
  return new RosterMerc({
    soldier,
    profile: null,
    kind: options.kind ?? MercKind.AIM_MERC,
    statusFlags: 0,
    sector: { ...D13 },
    betweenSectors: false,
    groupId: 0,
    prevSectorId: 255,
    insertionCode: 0,
    insertionDirection: 0,
    path: [],
    assignment: options.assignment ?? SQUAD,
    vehicleId: -1,
    asleep: false,
  });
}

function crew(...mercs: RosterMerc[]): RobotCrew {
  return {
    get: (id) => mercs.find((m) => m.id === id),
    byProfile: (profile) => mercs.find((m) => m.profile === profile),
    all: () => [...mercs].sort((a, b) => a.id - b.id),
  };
}

const robotMerc = () => merc(5, { profile: ROBOT, kind: MercKind.EPC, body: Body.ROBOTNOWEAPON });

describe('ControllingRobot and the remote holder (Soldier_Control.cc)', () => {
  it('needs a conscious non-EPC on a squad or in a vehicle, wearing the remote, with the robot in the same sector', () => {
    const robot = robotMerc();
    const holder = merc(1, { remote: true });
    expect(controllingRobot(crew(holder, robot), REMOTE, holder)).toBe(true);
    expect(controllingRobot(crew(merc(1), robot), REMOTE, merc(1))).toBe(false);
    const escort = merc(2, { remote: true, kind: MercKind.EPC });
    expect(controllingRobot(crew(escort, robot), REMOTE, escort)).toBe(false);
    const hurt = merc(3, { remote: true, life: 14 });
    expect(controllingRobot(crew(hurt, robot), REMOTE, hurt)).toBe(false);
    const doctor = merc(4, { remote: true, assignment: Assignment.DOCTOR });
    expect(controllingRobot(crew(doctor, robot), REMOTE, doctor)).toBe(false);
    const driver = merc(6, { remote: true, assignment: Assignment.VEHICLE });
    expect(controllingRobot(crew(driver, robot), REMOTE, driver)).toBe(true);
    expect(controllingRobot(crew(holder), REMOTE, holder)).toBe(false);
    holder.sector = { x: 13, y: 3, z: 0 };
    expect(controllingRobot(crew(holder, robot), REMOTE, holder)).toBe(false);
  });

  it('on the road both must travel in the same squad, or in the same vehicle', () => {
    const robot = robotMerc();
    const holder = merc(1, { remote: true });
    robot.betweenSectors = true;
    expect(controllingRobot(crew(holder, robot), REMOTE, holder)).toBe(false);
    holder.betweenSectors = true;
    robot.assignment = SQUAD;
    expect(controllingRobot(crew(holder, robot), REMOTE, holder)).toBe(true);
    robot.assignment = OTHER_SQUAD;
    expect(controllingRobot(crew(holder, robot), REMOTE, holder)).toBe(false);
    robot.assignment = Assignment.VEHICLE;
    holder.assignment = Assignment.VEHICLE;
    robot.vehicleId = VEHICLE_ID;
    holder.vehicleId = VEHICLE_ID + 1;
    expect(controllingRobot(crew(holder, robot), REMOTE, holder)).toBe(false);
    holder.vehicleId = VEHICLE_ID;
    expect(controllingRobot(crew(holder, robot), REMOTE, holder)).toBe(true);
  });

  it('stores the first controller by soldier id and checks it again when asked whether the robot can be ordered', () => {
    const robot = robotMerc();
    const first = merc(1, { remote: true });
    const second = merc(2, { remote: true });
    const team = crew(second, first, robot);
    updateRobotControllerGivenRobot(team, REMOTE, robot);
    expect(robot.remoteHolder).toBe(1);
    expect(canRobotBeControlled(team, REMOTE, robot)).toBe(true);
    const head = first.inv[InvSlot.HEAD1];
    if (head) head.item = 0;
    expect(canRobotBeControlled(team, REMOTE, robot)).toBe(false);
    updateRobotControllerGivenController(team, REMOTE, first);
    expect(robot.remoteHolder).toBe(1);
    updateRobotControllerGivenController(team, REMOTE, second);
    expect(robot.remoteHolder).toBe(2);
    expect(canRobotBeControlled(team, REMOTE, robot)).toBe(true);
  });

  it('refreshes the holder before a battle (PreBattle_Interface.cc CheckForRobotAndIfItsControlled)', () => {
    const robot = robotMerc();
    const holder = merc(3, { remote: true });
    robot.remoteHolder = 9;
    checkForRobotAndIfItsControlled(crew(holder, robot), REMOTE);
    expect(robot.remoteHolder).toBe(3);
    const head = holder.inv[InvSlot.HEAD1];
    if (head) head.item = 0;
    checkForRobotAndIfItsControlled(crew(holder, robot), REMOTE);
    expect(robot.remoteHolder).toBeNull();
  });

  it('finds a controller in a squad or a vehicle for strategic moves', () => {
    const robot = robotMerc();
    const holder = merc(1, { remote: true, assignment: OTHER_SQUAD });
    expect(robotControllerInSquad(crew(holder, robot), REMOTE, SQUAD)).toBe(false);
    expect(robotControllerInSquad(crew(holder, robot), REMOTE, OTHER_SQUAD)).toBe(true);
    holder.assignment = Assignment.VEHICLE;
    holder.vehicleId = VEHICLE_ID;
    expect(robotControllerInVehicle(crew(holder, robot), REMOTE, VEHICLE_ID)).toBe(true);
    expect(robotControllerInVehicle(crew(holder, robot), REMOTE, VEHICLE_ID + 1)).toBe(false);
  });
});
