import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { NO_VEHICLE } from '../strategic/forces/constants.ts';
import { NO_MOVEMENT_GROUP, VehicleTypeId } from '../vehicles/vehicle-list.ts';
import { handleSoldierDeath } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { type CreationContext, newSoldierCreate, tacticalCreateSoldier } from './creation.ts';
import { NEUTRAL_POPULATION } from './init-list.ts';
import { setSoldierPosition } from './movement.ts';
import { Body, NO_PROFILE, type Soldier, TEAM_FIRST_ID, Team } from './soldier.ts';
import { registerSoldier, type TacticalState } from './state.ts';
import { FULL_VEHICLE_FUEL, removeVehiclesNotOnOurTeam } from './vehicle-soldiers.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const D13 = { x: 13, y: 4, z: 0 };
const AT = 12080;
const EAST = 2;
const LIFE = 100;
const PROF_HUMMER = 160;
const PROF_ELDERODO = 161;
const PROF_ICECREAM = 162;
const NPC164 = 164;
const FUEL_PERCENT = 100;

function createVehicle(c: CreationContext, team: number, body: number, id: number, givenVehicleId?: number): Soldier {
  const create = { ...newSoldierCreate(team, body, EAST, AT), life: LIFE, lifeMax: LIFE };
  const s = tacticalCreateSoldier(c, givenVehicleId === undefined ? create : { ...create, givenVehicleId }, id, NEUTRAL_POPULATION);
  if (!s) throw new Error(`no soldier of body ${body}`);
  return s;
}

function placed(t: TacticalState, s: Soldier, at: number): Soldier {
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  s.placed = true;
  return s;
}

function recordDraws(t: TacticalState): number[] {
  const ranges: number[] = [];
  const rng = t.rng as unknown as { int(n: number): number };
  const int = rng.int.bind(rng);
  rng.int = (n: number) => {
    ranges.push(n);
    return int(n);
  };
  return ranges;
}

const VEHICLES: readonly (readonly [body: number, team: number, type: number, profile: number])[] = [
  [Body.HUMVEE, Team.CIV, VehicleTypeId.HUMMER, PROF_HUMMER],
  [Body.ELDORADO, Team.ENEMY, VehicleTypeId.ELDORADO_CAR, PROF_ELDERODO],
  [Body.ICECREAMTRUCK, Team.OUR, VehicleTypeId.ICE_CREAM_TRUCK, PROF_ICECREAM],
  [Body.JEEP, Team.MILITIA, VehicleTypeId.JEEP_CAR, NPC164],
  [Body.TANK_NW, Team.ENEMY, VehicleTypeId.TANK_CAR, NPC164],
  [Body.TANK_NE, Team.CREATURE, VehicleTypeId.TANK_CAR, NPC164],
];

describe('vehicle soldiers at creation (Soldier_Create.cc TacticalCreateSoldier, Vehicles.cc SetVehicleValuesIntoSoldierType)', () => {
  it('registers a vehicle for every vehicle body on any team, each in the first free slot of a list of its own outside a campaign, with its type, sector and soldier', () => {
    const t = newCombatSim(content).state;
    t.sector = D13;
    const soldiers = VEHICLES.map(([body, team], k) => createVehicle(t, team, body, (TEAM_FIRST_ID[team] ?? 0) + k));
    expect(soldiers.map((s) => s.vehicleId)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.vehicles.map((v) => v.type)).toEqual(VEHICLES.map(([, , type]) => type));
    expect(t.vehicles.map((v) => v.soldierId)).toEqual(soldiers.map((s) => s.id));
    expect(t.vehicles.every((v) => v.valid && v.sector.x === D13.x && v.sector.y === D13.y)).toBe(true);
    expect(t.vehicles.every((v) => v.movementGroup === NO_MOVEMENT_GROUP)).toBe(true);
  });

  it("gives each vehicle soldier the profile of its vehicle type and a full tank: a tank becomes NPC164, the jeep's profile too", () => {
    const t = newCombatSim(content).state;
    const soldiers = VEHICLES.map(([body, team], k) => createVehicle(t, team, body, (TEAM_FIRST_ID[team] ?? 0) + k));
    expect(soldiers.map((s) => s.profile)).toEqual(VEHICLES.map(([, , , profile]) => profile));
    expect(soldiers.map((s) => [s.breathRed, s.breath])).toEqual(soldiers.map(() => [FULL_VEHICLE_FUEL, FUEL_PERCENT]));
  });

  it('registers nothing for another body', () => {
    const t = newCombatSim(content).state;
    const s = createVehicle(t, Team.ENEMY, Body.REGMALE, TEAM_FIRST_ID[Team.ENEMY]);
    expect([s.vehicleId, s.profile, t.vehicles.length]).toEqual([NO_VEHICLE, NO_PROFILE, 0]);
  });

  it('draws nothing for the registration: the tank draws what any soldier of its creation does', () => {
    const registering = newCombatSim(content).state;
    const unlisted = newCombatSim(content).state;
    const listedDraws = recordDraws(registering);
    const unlistedDraws = recordDraws(unlisted);
    createVehicle(registering, Team.ENEMY, Body.TANK_NW, TEAM_FIRST_ID[Team.ENEMY]);
    const { vehicles: _noList, ...withoutList } = unlisted;
    createVehicle(withoutList, Team.ENEMY, Body.TANK_NW, TEAM_FIRST_ID[Team.ENEMY]);
    expect([registering.vehicles.length, unlisted.vehicles.length]).toEqual([1, 0]);
    expect(listedDraws).toEqual(unlistedDraws);
  });

  it('keeps a given vehicle instead of adding one, and points the vehicle at the new soldier', () => {
    const t = newCombatSim(content).state;
    const civilian = createVehicle(t, Team.CIV, Body.HUMVEE, TEAM_FIRST_ID[Team.CIV]);
    const ours = createVehicle(t, Team.OUR, Body.HUMVEE, 18, civilian.vehicleId);
    expect([ours.vehicleId, t.vehicles.length, t.vehicles[0]?.soldierId]).toEqual([0, 1, 18]);
    expect([ours.profile, ours.breathRed]).toEqual([PROF_HUMMER, FULL_VEHICLE_FUEL]);
  });
});

describe('vehicles leaving the list with their soldier (Soldier_Create.cc InternalTacticalRemoveSoldier)', () => {
  it('removes the vehicles not on our team at the unload, and keeps ours even when a soldier left by a team change still names it (WorldDef.cc TrashWorld)', () => {
    const t = newCombatSim(content).state;
    const civilian = placed(t, createVehicle(t, Team.CIV, Body.ICECREAMTRUCK, TEAM_FIRST_ID[Team.CIV]), AT);
    const tank = placed(t, createVehicle(t, Team.ENEMY, Body.TANK_NE, TEAM_FIRST_ID[Team.ENEMY]), AT + 10);
    const leftBehind = createVehicle(t, Team.CIV, Body.HUMVEE, TEAM_FIRST_ID[Team.CIV] + 1);
    t.soldiers[leftBehind.id] = leftBehind;
    const ours = placed(t, createVehicle(t, Team.OUR, Body.HUMVEE, 18, leftBehind.vehicleId), AT + 20);
    removeVehiclesNotOnOurTeam(t);
    expect([civilian, tank, ours].map((s) => t.vehicles[s.vehicleId]?.valid)).toEqual([false, false, true]);
  });

  it('removes a vehicle not on our team with its corpse, and keeps ours (Rotting_Corpses.cc TurnSoldierIntoCorpse)', () => {
    const t = newCombatSim(content).state;
    const civilian = placed(t, createVehicle(t, Team.CIV, Body.HUMVEE, TEAM_FIRST_ID[Team.CIV]), AT);
    const ours = placed(t, createVehicle(t, Team.OUR, Body.HUMVEE, 18), AT + 20);
    for (const s of [civilian, ours]) {
      s.life = 0;
      handleSoldierDeath(t, s);
    }
    expect([civilian.placed, ours.placed]).toEqual([false, false]);
    expect([civilian, ours].map((s) => t.vehicles[s.vehicleId]?.valid)).toEqual([false, true]);
  });

  it('removes nothing for a vehicle soldier with no place in the list', () => {
    const t = newCombatSim(content).state;
    const civilian = placed(t, createVehicle(t, Team.CIV, Body.HUMVEE, TEAM_FIRST_ID[Team.CIV]), AT);
    const unlisted = placed(t, createVehicle(t, Team.CIV, Body.HUMVEE, TEAM_FIRST_ID[Team.CIV] + 1), AT + 10);
    unlisted.vehicleId = NO_VEHICLE;
    removeVehiclesNotOnOurTeam(t);
    expect(t.vehicles.map((v) => v.valid)).toEqual([false, true]);
    expect(civilian.vehicleId).toBe(0);
  });
});
