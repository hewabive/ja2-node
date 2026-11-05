import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { addStubTank, addStubVehicle, ourHummerOnTheMap, seatInVehicle } from '../../../tests/support/vehicles.ts';
import { DIRECTION_COUNT, Direction, gridNo, gridSquare } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import type { SyntheticWorld } from '../../content/world/synthetic.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import type { TacticalContent } from './content.ts';
import { Opp } from './perception/opp.ts';
import { Body, OKLIFE, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { placeOutOfVehicle, vehicleExitSpot } from './vehicle-boarding.ts';
import { PRIVATE_VEHICLE_LIST } from './vehicle-soldiers.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CAR_AT = gridNo(80, 70);
const CAR_FOOTPRINT: readonly number[] = [-2, -1, 0, 1, 2].flatMap((dx) => [-1, 0, 1].map((dy) => gridNo(80 + dx, 70 + dy)));
const SOUTH_OF_THE_CAR = gridNo(80, 72);
const NORTH_OF_THE_CAR = gridNo(80, 68);
const MERC_AT = gridNo(80, 78);
const TANK_AT = gridNo(60, 70);
const CORRIDOR_SOUTH: readonly number[] = [72, 73, 74, 75].map((y) => gridNo(80, y));
const FIRST_OF_THE_TILES_SIX_AWAY = gridNo(80, 64);
const NEAR_RADIUS = 5;
const MERC = 0;
const WAITING = [1, 2, 3, 4];
const DRIVER = 5;
const ENEMY = 20;
const NO_APS = 0;

interface Boardings {
  readonly entered: (readonly [number, number])[];
  readonly exited: number[];
}

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly car: Soldier;
  readonly boardings: Boardings;
}

function withBoarding(t: TacticalState, usable: () => boolean = () => true): Boardings {
  const boardings: Boardings = { entered: [], exited: [] };
  t.vehicleHooks = {
    ...PRIVATE_VEHICLE_LIST,
    boarding: {
      okUseVehicle: usable,
      putSoldierInVehicle: (s, v) => {
        boardings.entered.push([s.id, v.id]);
        return null;
      },
      exitVehicle: (s) => {
        boardings.exited.push(s.id);
      },
      setAssignmentRepair: () => {},
    },
  };
  return boardings;
}

function walledInBut(open: readonly number[]): (world: SyntheticWorld) => void {
  const kept = new Set([...CAR_FOOTPRINT, ...open]);
  return (world) => {
    for (const g of gridSquare(CAR_AT, NEAR_RADIUS)) {
      if (kept.has(g)) continue;
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) world.costs.force(g, direction, 0, TravelCost.OBSTACLE);
    }
  };
}

function scene(shape: (world: SyntheticWorld) => void = () => undefined, usable: () => boolean = () => true): Scene {
  const sim = newCombatSim(content, [], 3, new Set(), shape);
  const t = sim.state;
  const merc = spawnSoldier(sim, MERC, Team.OUR, MERC_AT, Direction.NORTH, { life: 100 });
  const car = addStubVehicle(t, { body: Body.HUMVEE, team: Team.CIV, gridNo: CAR_AT, direction: Direction.WEST });
  sim.lookAround();
  return { sim, t, merc, car, boardings: withBoarding(t, usable) };
}

function crowdTheCorridor(sim: TacticalSim): void {
  for (const [k, g] of CORRIDOR_SOUTH.entries()) spawnSoldier(sim, WAITING[k] ?? 0, Team.OUR, g, Direction.NORTH);
}

function refusalOf(sim: TacticalSim, cmd: Record<string, unknown> & { readonly type: string }): unknown {
  const result = sim.dispatch(cmd);
  return result.ok ? 'ok' : result.data?.refusal;
}

describe('the click on a vehicle (Turn_Based_Input.cc CheckForAndHandleHandleVehicleInteractiveClick)', () => {
  it('refuses in its order: a vehicle the squad does not see, a tank or a wreck, one not to be used yet, one taken under the move cursor, no free tile within 5, too few APs', () => {
    let usable = false;
    const { sim, t, merc, car, boardings } = scene(walledInBut(CORRIDOR_SOUTH), () => usable);
    const enter = (vehicle: number, cursor = 'hand') => refusalOf(sim, { type: 'enterVehicle', soldier: MERC, vehicle, cursor });
    const tank = addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: TANK_AT, direction: Direction.SOUTH });
    expect(tank.visible).toBe(-1);
    expect(enter(tank.id)).toBe('noSuchTarget');
    sim.lookAround();
    expect(enter(tank.id)).toBe('notEnterable');
    car.life = OKLIFE - 1;
    expect(enter(car.id)).toBe('notEnterable');
    car.life = car.lifeMax;
    expect(enter(car.id)).toBe('notAllowed');
    usable = true;
    const driver = spawnSoldier(sim, DRIVER, Team.OUR, gridNo(70, 78), Direction.NORTH);
    seatInVehicle(t, driver, car, VehicleSeat.DRIVER);
    crowdTheCorridor(sim);
    expect(enter(car.id, 'move')).toBe('vehicleOccupied');
    expect(enter(car.id, 'hand')).toBe('noPath');
    expect(boardings.entered).toEqual([]);
    expect(merc.gridNo).toBe(MERC_AT);
  });

  it('refuses a walk the merc has not the APs for in combat', () => {
    const { sim, t, merc, car, boardings } = scene();
    t.inCombat = true;
    merc.actionPoints = NO_APS;
    expect(refusalOf(sim, { type: 'enterVehicle', soldier: MERC, vehicle: car.id })).toBe('notEnoughAP');
    expect(boardings.entered).toEqual([]);
  });

  it('walks to the free tile closest to the vehicle by rows and columns, then boards whatever enterable vehicle stands there, without asking again whether it may be used', () => {
    let usable = true;
    const { sim, merc, car, boardings } = scene(undefined, () => usable);
    expect(sim.dispatch({ type: 'enterVehicle', soldier: MERC, vehicle: car.id })).toEqual({
      ok: true,
      data: { actionGridNo: SOUTH_OF_THE_CAR, boarded: false },
    });
    expect(merc.pendingTileTool).toEqual({ tool: 'enterVehicle', gridNo: CAR_AT, direction: car.direction });
    usable = false;
    runUntilIdle(sim);
    expect(merc.gridNo).toBe(SOUTH_OF_THE_CAR);
    expect(boardings.entered).toEqual([[MERC, car.id]]);
    expect(merc.pendingTileTool).toBeNull();
  });

  it('never boards from where the merc stands: his own tile is never free to him, so beside the vehicle he walks round it to the next closest tile first (quirk)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, MERC, Team.OUR, SOUTH_OF_THE_CAR, Direction.NORTH, { life: 100 });
    const car = addStubVehicle(t, { body: Body.HUMVEE, team: Team.CIV, gridNo: CAR_AT, direction: Direction.WEST });
    sim.lookAround();
    const boardings = withBoarding(t);
    expect(sim.dispatch({ type: 'enterVehicle', soldier: MERC, vehicle: car.id })).toMatchObject({
      ok: true,
      data: { actionGridNo: NORTH_OF_THE_CAR, boarded: false },
    });
    expect(boardings.entered).toEqual([]);
    runUntilIdle(sim);
    expect([merc.gridNo, boardings.entered]).toEqual([NORTH_OF_THE_CAR, [[MERC, car.id]]]);
  });

  it('boards nothing on arrival when no enterable vehicle stands on the tile any more', () => {
    const { sim, t, car, boardings } = scene();
    expect(sim.dispatch({ type: 'enterVehicle', soldier: MERC, vehicle: car.id }).ok).toBe(true);
    car.life = OKLIFE - 1;
    runUntilIdle(sim);
    expect(boardings.entered).toEqual([]);
    expect(t.soldiers[MERC]?.gridNo).toBe(SOUTH_OF_THE_CAR);
  });
});

describe('a vehicle under orders to move (Turn_Based_Input.cc HandleMoveModeInteractiveClick: VEHICLE_CANT_MOVE_IN_TACTICAL)', () => {
  it('refuses vehicleCantMove for a move, the exchange cursor, a group move and a click on another vehicle (quirk)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const driver = spawnSoldier(sim, DRIVER, Team.OUR, gridNo(70, 78), Direction.NORTH);
    const beside = spawnSoldier(sim, MERC, Team.OUR, gridNo(86, 70), Direction.WEST);
    const hummer = ourHummerOnTheMap(t, CAR_AT);
    seatInVehicle(t, driver, hummer, VehicleSeat.DRIVER);
    const other = addStubVehicle(t, { body: Body.JEEP, team: Team.CIV, gridNo: gridNo(70, 60), direction: Direction.WEST });
    sim.lookAround();
    withBoarding(t);
    expect(refusalOf(sim, { type: 'move', soldier: hummer.id, to: gridNo(80, 90) })).toBe('vehicleCantMove');
    expect(refusalOf(sim, { type: 'swapPlaces', soldier: hummer.id, with: beside.id, cursor: true })).toBe('vehicleCantMove');
    expect(refusalOf(sim, { type: 'moveGroup', soldiers: [beside.id, hummer.id], to: gridNo(80, 90) })).toBe('vehicleCantMove');
    expect(refusalOf(sim, { type: 'enterVehicle', soldier: hummer.id, vehicle: other.id })).toBe('vehicleCantMove');
    expect([hummer.gridNo, hummer.pathSize, beside.pathSize]).toEqual([CAR_AT, 0, 0]);
  });
});

describe('boarding and leaving in the sandbox (no strategic layer)', () => {
  it('refuses enterVehicle and exitVehicle as notInCampaign', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, MERC, Team.OUR, MERC_AT, Direction.NORTH);
    const driver = spawnSoldier(sim, DRIVER, Team.OUR, gridNo(70, 78), Direction.NORTH);
    const car = addStubVehicle(t, { body: Body.HUMVEE, team: Team.CIV, gridNo: CAR_AT, direction: Direction.WEST });
    seatInVehicle(t, driver, car, VehicleSeat.DRIVER);
    sim.lookAround();
    expect(refusalOf(sim, { type: 'enterVehicle', soldier: MERC, vehicle: car.id })).toBe('notInCampaign');
    expect(refusalOf(sim, { type: 'exitVehicle', soldier: DRIVER })).toBe('notInCampaign');
  });
});

describe('the Exit Vehicle button (Interface_Panels.cc TMClickSecondHandInvCallbackPrimary)', () => {
  it('takes a merc aboard out and refuses one on foot as notInVehicle', () => {
    const { sim, t, merc, car, boardings } = scene();
    const driver = spawnSoldier(sim, DRIVER, Team.OUR, gridNo(70, 78), Direction.NORTH);
    seatInVehicle(t, driver, car, VehicleSeat.DRIVER);
    expect(refusalOf(sim, { type: 'exitVehicle', soldier: merc.id })).toBe('notInVehicle');
    expect(refusalOf(sim, { type: 'exitVehicle', soldier: DRIVER })).toBe('ok');
    expect(boardings.exited).toEqual([DRIVER]);
  });
});

describe('the way out of a vehicle (Vehicles.cc ExitVehicle)', () => {
  function seatedIn(shape: (world: SyntheticWorld) => void): Scene & { readonly driver: Soldier } {
    const s = scene(shape);
    const driver = spawnSoldier(s.sim, DRIVER, Team.OUR, gridNo(70, 78), Direction.SOUTH);
    seatInVehicle(s.t, driver, s.car, VehicleSeat.DRIVER);
    return { ...s, driver };
  }

  it('takes the free tile closest by rows and columns within 5 of the vehicle, and within 20 when none is free, ties to the first of the square', () => {
    const open = seatedIn(walledInBut(CORRIDOR_SOUTH));
    expect(vehicleExitSpot(open.t, open.driver, open.car)).toBe(SOUTH_OF_THE_CAR);
    const crowded = seatedIn(walledInBut(CORRIDOR_SOUTH));
    crowdTheCorridor(crowded.sim);
    expect(vehicleExitSpot(crowded.t, crowded.driver, crowded.car)).toBe(FIRST_OF_THE_TILES_SIX_AWAY);
  });

  it('marks the vehicle seen, puts him on the tile and lets him look from there', () => {
    const { sim, t, car, driver } = seatedIn(() => undefined);
    const enemy = spawnSoldier(sim, ENEMY, Team.ENEMY, gridNo(80, 80), Direction.NORTH);
    driver.vehicleSeat = VehicleSeat.NONE;
    driver.oppList.fill(Opp.NOT_HEARD_OR_SEEN);
    placeOutOfVehicle(t, driver, car, SOUTH_OF_THE_CAR);
    expect([driver.gridNo, driver.insertionGridNo, driver.insertionData]).toEqual([SOUTH_OF_THE_CAR, SOUTH_OF_THE_CAR, SOUTH_OF_THE_CAR]);
    expect([driver.oppList[car.id], driver.oppList[enemy.id]]).toEqual([Opp.SEEN_CURRENTLY, Opp.SEEN_CURRENTLY]);
    expect(t.occupant[0][SOUTH_OF_THE_CAR]).toBe(DRIVER);
  });
});
