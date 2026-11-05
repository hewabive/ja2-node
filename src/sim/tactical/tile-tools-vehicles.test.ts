import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { addStubTank, addStubVehicle, seatInVehicle } from '../../../tests/support/vehicles.ts';
import { NOTHING } from '../../content/items/items.ts';
import { DIRECTION_COUNT, Direction, gridNo, gridSquare } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import type { SyntheticWorld } from '../../content/world/synthetic.ts';
import type { SimEvent } from '../events.ts';
import { createItem } from '../items/object.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import { FULL_VEHICLE_FUEL } from '../vehicles/vehicle-fuel.ts';
import { animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { AP } from './points.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { vehicleToolTarget, walkCostTo } from './tile-tools.ts';
import { enterCombatMode } from './turns/turns.ts';
import { PRIVATE_VEHICLE_LIST } from './vehicle-soldiers.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CAR_AT = gridNo(80, 70);
const CAR_FOOTPRINT: readonly number[] = [-2, -1, 0, 1, 2].flatMap((dx) => [-1, 0, 1].map((dy) => gridNo(80 + dx, 70 + dy)));
const SWEET_SPOT_SOUTH = gridNo(80, 72);
const SHORT_OF_THE_SWEET_SPOT = gridNo(80, 73);
const MERC_AT = gridNo(80, 78);
const ON_THE_ROOF = 1;
const TANK_AT = gridNo(60, 70);
const TRUCK_AT = gridNo(100, 70);
const FAR_ENEMY = gridNo(80, 130);
const NEAR_RADIUS = 5;
const MERC = 0;
const DRIVER = 5;
const ENEMY = 20;
const NO_APS = 0;
const FULL_STATUS = 100;
const FUEL_PER_GAS_CAN_STATUS = 50;
const ODD_STATUS = 33;
const FUEL_OF_ODD_STATUS = 1650;
const PERCENT_OF_ODD_STATUS = 16;
const WRAPPING_CIVILIAN_ID = 130;
const WRAPPED_VEHICLE_ID = 130 - 256;

interface Port {
  readonly repairs: (readonly [number, number])[];
}

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly car: Soldier;
  readonly port: Port;
}

function withCampaignPort(t: TacticalState): Port {
  const port: Port = { repairs: [] };
  t.vehicleHooks = {
    ...PRIVATE_VEHICLE_LIST,
    boarding: {
      okUseVehicle: () => true,
      putSoldierInVehicle: () => null,
      exitVehicle: () => {},
      setAssignmentRepair: (s, vehicleUnderRepair) => {
        port.repairs.push([s.id, vehicleUnderRepair]);
      },
    },
  };
  return port;
}

function walledIn(world: SyntheticWorld): void {
  const kept = new Set(CAR_FOOTPRINT);
  for (const g of gridSquare(CAR_AT, NEAR_RADIUS)) {
    if (kept.has(g)) continue;
    for (let direction = 0; direction < DIRECTION_COUNT; direction++) world.costs.force(g, direction, 0, TravelCost.OBSTACLE);
  }
}

function scene(tool: string, status = FULL_STATUS, shape: (world: SyntheticWorld) => void = () => undefined): Scene {
  const sim = newCombatSim(content, [], 3, new Set(), shape);
  const t = sim.state;
  const merc = spawnSoldier(sim, MERC, Team.OUR, MERC_AT, Direction.NORTH, { life: 100 });
  merc.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get(tool)?.index ?? NOTHING, status);
  const car = addStubVehicle(t, { body: Body.HUMVEE, team: Team.CIV, gridNo: CAR_AT, direction: Direction.WEST });
  sim.lookAround();
  return { sim, t, merc, car, port: withCampaignPort(t) };
}

function intoCombat(sim: TacticalSim): void {
  spawnSoldier(sim, ENEMY, Team.ENEMY, FAR_ENEMY, Direction.SOUTH);
  enterCombatMode(sim.state, Team.OUR);
  expect(sim.state.inCombat).toBe(true);
}

function emptyTank(car: Soldier): void {
  Object.assign(car, { breathRed: 0, breath: 0 });
}

function order(sim: TacticalSim, type: string, at: number): SimEvent[] {
  expect(sim.dispatch({ type, soldier: MERC, gridNo: at })).toEqual({ ok: true });
  return [...sim.drainEvents(), ...runUntilIdle(sim)];
}

function refusalOf(sim: TacticalSim, type: string, at: number, soldier = MERC): unknown {
  const result = sim.dispatch({ type, soldier, gridNo: at });
  return result.ok ? 'ok' : result.data?.refusal;
}

const refuelled = (events: readonly SimEvent[]) => events.filter((e) => e.type === 'vehicleRefuelled');
const hand = (s: Soldier) => s.inv[InvSlot.HAND];

describe('the toolkit on a vehicle (Handle_Items.cc HandleItem, EVENT_SoldierBeginRepair)', () => {
  it('walks one tile short of the sweet spot south of the car, crouches into GOTO_REPAIRMAN facing north and puts the merc on the repair of the car soldier, paying the walk and the crouch only (quirks)', () => {
    const { sim, t, merc, car, port } = scene('TOOLKIT');
    intoCombat(sim);
    expect(vehicleToolTarget(t, merc, CAR_AT)).toEqual({ gridNo: SWEET_SPOT_SOUTH, vehicleGridNo: CAR_AT });
    const walk = walkCostTo(t, merc, SHORT_OF_THE_SWEET_SPOT);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'repair', soldier: MERC, gridNo: CAR_AT + 1 })).toEqual({ ok: true });
    expect(merc.pendingTileTool).toEqual({ tool: 'repair', gridNo: CAR_AT, direction: Direction.NORTH });
    runUntilIdle(sim);
    expect([merc.gridNo, merc.direction, animName(content, merc.state)]).toEqual([
      SHORT_OF_THE_SWEET_SPOT,
      Direction.NORTH,
      'BEING_REPAIRMAN',
    ]);
    expect(before - merc.actionPoints).toBe(walk + AP.CROUCH);
    expect(port.repairs).toEqual([[MERC, car.id]]);
    expect(car.id).not.toBe(car.vehicleId);
  });

  it('hands the strategic side the car soldier id as an INT8, so a civilian car above id 127 is repaired as a negative vehicle (quirk)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const first = TEAM_FIRST_ID[Team.CIV];
    for (let id = first; id < WRAPPING_CIVILIAN_ID; id++) spawnSoldier(sim, id, Team.CIV, gridNo(60 + id - first, 100), Direction.SOUTH);
    const merc = spawnSoldier(sim, MERC, Team.OUR, MERC_AT, Direction.NORTH, { life: 100 });
    merc.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('TOOLKIT')?.index ?? NOTHING, FULL_STATUS);
    const car = addStubVehicle(t, { body: Body.HUMVEE, team: Team.CIV, gridNo: CAR_AT, direction: Direction.WEST });
    sim.lookAround();
    const port = withCampaignPort(t);
    expect(car.id).toBe(WRAPPING_CIVILIAN_ID);
    order(sim, 'repair', CAR_AT);
    expect(port.repairs).toEqual([[MERC, WRAPPED_VEHICLE_ID]]);
  });

  it('does nothing from the tile it would walk to: the repair begins on the free sweet spot, which holds no vehicle (quirk)', () => {
    const { sim, merc, port } = scene('TOOLKIT');
    merc.gridNo = SHORT_OF_THE_SWEET_SPOT;
    sim.state.occupant[0][MERC_AT] = -1;
    sim.state.occupant[0][SHORT_OF_THE_SWEET_SPOT] = MERC;
    expect(sim.dispatch({ type: 'repair', soldier: MERC, gridNo: CAR_AT })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect([merc.gridNo, merc.pendingTileTool, animName(content, merc.state), port.repairs]).toEqual([
      SHORT_OF_THE_SWEET_SPOT,
      null,
      'STANDING',
      [],
    ]);
  });
});

describe('the gas can on a vehicle (Handle_Items.cc HandleItem, EVENT_SoldierBeginRefuel, Soldier_Ani.cc code 769)', () => {
  it('walks up, pours the can of odd status into the empty tank at code 769, rounding the percentage down, and the empty can is gone; the walk and the crouch are all it pays (quirks)', () => {
    const { sim, t, merc, car } = scene('GAS_CAN', ODD_STATUS);
    emptyTank(car);
    intoCombat(sim);
    const walk = walkCostTo(t, merc, SHORT_OF_THE_SWEET_SPOT);
    const before = merc.actionPoints;
    const events = order(sim, 'refuel', CAR_AT);
    expect([car.breathRed, car.breath, hand(merc)?.item]).toEqual([FUEL_OF_ODD_STATUS, PERCENT_OF_ODD_STATUS, NOTHING]);
    expect(before - merc.actionPoints).toBe(walk + AP.CROUCH);
    expect(refuelled(events)).toEqual([
      { type: 'vehicleRefuelled', soldier: MERC, vehicle: car.vehicleId, gridNo: CAR_AT, tick: expect.any(Number) },
    ]);
  });

  it('takes nothing into a full tank: the can keeps its status and no refuel is reported', () => {
    const { sim, merc, car } = scene('GAS_CAN', ODD_STATUS);
    const events = order(sim, 'refuel', CAR_AT);
    expect([car.breathRed, hand(merc)?.status[0], refuelled(events)]).toEqual([FULL_VEHICLE_FUEL, ODD_STATUS, []]);
  });

  it('pours nothing from the tile it would walk to: a second refuel starts on the free sweet spot (quirk)', () => {
    const { sim, merc, car } = scene('GAS_CAN', FULL_STATUS);
    emptyTank(car);
    order(sim, 'refuel', CAR_AT);
    const fuel = car.breathRed;
    expect([merc.gridNo, hand(merc)?.item]).toEqual([SHORT_OF_THE_SWEET_SPOT, NOTHING]);
    merc.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('GAS_CAN')?.index ?? NOTHING, FULL_STATUS);
    expect(refuelled(order(sim, 'refuel', CAR_AT))).toEqual([]);
    expect([car.breathRed, hand(merc)?.status[0]]).toEqual([fuel, FULL_STATUS]);
  });
});

describe('the vehicle tools of any team (UI_Cursors.cc HandleRepairCursor, HandleRefuelCursor, Structure_Wrap.cc)', () => {
  it('pour fuel into a neutral truck and walk to an enemy tank alike (quirk)', () => {
    const { sim, t, merc } = scene('GAS_CAN');
    const truck = addStubVehicle(t, { body: Body.ICECREAMTRUCK, team: Team.CIV, gridNo: TRUCK_AT, direction: Direction.WEST });
    sim.lookAround();
    emptyTank(truck);
    expect(refuelled(order(sim, 'refuel', TRUCK_AT)).map((e) => e.type)).toEqual(['vehicleRefuelled']);
    expect(truck.breathRed).toBe(FULL_STATUS * FUEL_PER_GAS_CAN_STATUS);
    const tank = addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: TANK_AT, direction: Direction.SOUTH });
    merc.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('TOOLKIT')?.index ?? NOTHING, FULL_STATUS);
    expect(refusalOf(sim, 'repair', TANK_AT)).toBe('ok');
    expect(merc.pendingTileTool).toMatchObject({ tool: 'repair', gridNo: tank.gridNo });
  });
});

describe('refusals of repair and refuel (Handle_UI.cc UIMouseOnValidAttackLocation, HandleItem)', () => {
  it('refuse in the sandbox, which has no assignments to give', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, MERC, Team.OUR, MERC_AT, Direction.NORTH);
    for (const type of ['repair', 'refuel']) expect(refusalOf(sim, type, CAR_AT)).toBe('notInCampaign');
  });

  it('refuse another hand item, a tile without a vehicle, a merc on a roof and a merc aboard the vehicle', () => {
    const { sim, t, merc, car } = scene('TOOLKIT');
    expect(refusalOf(sim, 'refuel', CAR_AT)).toBe('noGasCan');
    expect(refusalOf(sim, 'repair', MERC_AT - 3)).toBe('noVehicle');
    merc.level = ON_THE_ROOF;
    expect(refusalOf(sim, 'repair', CAR_AT)).toBe('noVehicle');
    merc.level = 0;
    const driver = spawnSoldier(sim, DRIVER, Team.OUR, gridNo(70, 78), Direction.NORTH);
    driver.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('TOOLKIT')?.index ?? NOTHING, FULL_STATUS);
    seatInVehicle(t, driver, car, VehicleSeat.DRIVER);
    expect(refusalOf(sim, 'repair', CAR_AT, DRIVER)).toBe('inVehicle');
    merc.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('GAS_CAN')?.index ?? NOTHING, FULL_STATUS);
    expect(refusalOf(sim, 'repair', CAR_AT)).toBe('noToolKit');
  });

  it('refuse a car with no free tile around it and a walk the merc has not the APs for', () => {
    const walled = scene('TOOLKIT', FULL_STATUS, walledIn);
    expect(refusalOf(walled.sim, 'repair', CAR_AT)).toBe('noPath');
    const { sim, merc } = scene('GAS_CAN');
    intoCombat(sim);
    merc.actionPoints = NO_APS;
    expect(refusalOf(sim, 'refuel', CAR_AT)).toBe('notEnoughAP');
    expect(merc.pendingTileTool).toBeNull();
  });
});
