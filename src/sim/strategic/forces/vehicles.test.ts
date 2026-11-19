import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, economyTestContext, loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { parseSectorString, type Sector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { numberInVehicle, passengersOf } from '../../vehicles/vehicle-list.ts';
import type { EconomyContext } from '../economy/ports.ts';
import { addSoldierToVehicle, Boarding, isVehicleAccessibleToSoldier, soldierMustDriveVehicle } from '../economy/vehicle-assignment.ts';
import { initStrategicMovementCosts } from '../map/init.ts';
import { Assignment } from './constants.ts';
import { getGroup } from './groups.ts';
import { FACT_OK_USE_HUMMER } from './helicopter.ts';
import {
  cancelPathOfCharacterWithRoute,
  confirmPathForCharacter,
  plotPathForCharacter,
  rebuildWayPointsForAllSelectedCharsGroups,
} from './routes.ts';
import { addCharacterToSquad, initSquads, initVehicles } from './squads.ts';
import { addVehicleToList, killAllInVehicle, removeSoldierFromVehicle, takeSoldierOutOfVehicle } from './vehicles.ts';

let content: EconomyTestContent;

beforeAll(async () => {
  content = await loadEconomyTestContent();
});

const S = (name: string): Sector => parseSectorString(name);
const HUMMER_TYPE = 1;
const VEHICLE_SOLDIER = 15;

function hummerWorld(okToUse = true, killInVehicle: (id: number) => boolean = () => true) {
  const facts = new Set<number>(okToUse ? [FACT_OK_USE_HUMMER] : []);
  const { ctx, crew } = economyTestContext({ content, helicopter: { fact: (id) => facts.has(id), killInVehicle } });
  initStrategicMovementCosts(ctx);
  initSquads(ctx);
  initVehicles(ctx);
  const vid = addVehicleToList(ctx, S('D13'), HUMMER_TYPE);
  const v = ctx.state.forces.vehicles[vid];
  if (!v) throw new Error('no vehicle');
  const vs = crew.add({ id: VEHICLE_SOLDIER, sector: S('D13'), isVehicle: true, assignment: Assignment.ASSIGNMENT_EMPTY });
  vs.vehicleId = vid;
  v.soldierId = VEHICLE_SOLDIER;
  for (const id of [0, 1]) {
    crew.add({ id, sector: S('D13'), assignment: Assignment.ON_DUTY });
    addCharacterToSquad(ctx, id, 0);
  }
  return { ctx, crew, v, vid };
}

function member(ctx: EconomyContext, id: number) {
  const m = ctx.crew.get(id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

describe('ground vehicles', () => {
  it('needs the hummer fact to be used', () => {
    const { ctx, v } = hummerWorld(false);
    expect(isVehicleAccessibleToSoldier(ctx, member(ctx, 0), v)).toBe(false);
  });

  it('puts the vehicle soldier on a squad and in its group, then seats a driver and a passenger in slot order', () => {
    const { ctx, v, vid } = hummerWorld();
    expect(addSoldierToVehicle(ctx, member(ctx, 0), v)).toBe(Boarding.BOARDED);
    expect(addSoldierToVehicle(ctx, member(ctx, 1), v)).toBe(Boarding.BOARDED);
    expect(passengersOf(v)).toEqual([0, 1]);
    const g = getGroup(ctx, v.movementGroup);
    expect(g?.members).toEqual([VEHICLE_SOLDIER, 0, 1]);
    expect(g?.transportMask).toBe(content.strategic.vehicles[HUMMER_TYPE]?.movementType);
    expect(member(ctx, VEHICLE_SOLDIER).assignment).toBe(1);
    expect(ctx.state.forces.squads[1]).toEqual([VEHICLE_SOLDIER]);
    expect(member(ctx, 0)).toMatchObject({ assignment: Assignment.VEHICLE, vehicleId: vid });
    expect(ctx.state.forces.squads[0]).toEqual([]);
  });

  it('frees the seat on leaving and returns an empty vehicle to its own group', () => {
    const { ctx, v } = hummerWorld();
    addSoldierToVehicle(ctx, member(ctx, 0), v);
    addSoldierToVehicle(ctx, member(ctx, 1), v);
    expect(removeSoldierFromVehicle(ctx, 0)).toBe(true);
    expect(v.passengers.slice(0, 2)).toEqual([-1, 1]);
    expect(numberInVehicle(v)).toBe(1);
    expect(takeSoldierOutOfVehicle(ctx, 1)).toBe(true);
    expect(numberInVehicle(v)).toBe(0);
    expect(member(ctx, VEHICLE_SOLDIER).assignment).toBe(Assignment.ASSIGNMENT_EMPTY);
    expect(getGroup(ctx, v.movementGroup)?.members).toEqual([VEHICLE_SOLDIER]);
    expect(ctx.state.forces.squads[1]).toEqual([]);
  });

  it('makes the only able passenger drive while the vehicle has a route', () => {
    const { ctx, v } = hummerWorld();
    addSoldierToVehicle(ctx, member(ctx, 0), v);
    expect(soldierMustDriveVehicle(ctx, member(ctx, 0), false)).toBe(false);
    expect(soldierMustDriveVehicle(ctx, member(ctx, 0), true)).toBe(true);
    v.path = [strategicIndex(S('D13')), strategicIndex(S('E13'))];
    expect(soldierMustDriveVehicle(ctx, member(ctx, 0), false)).toBe(true);
    addSoldierToVehicle(ctx, member(ctx, 1), v);
    expect(soldierMustDriveVehicle(ctx, member(ctx, 0), false)).toBe(false);
  });
});

describe('the route of a ground vehicle', () => {
  const plottedHummer = () => {
    const world = hummerWorld();
    addSoldierToVehicle(world.ctx, member(world.ctx, 0), world.v);
    expect(plotPathForCharacter(world.ctx, 0, S('E13'))).toBe(true);
    expect(world.v.path).toEqual([strategicIndex(S('D13')), strategicIndex(S('E13'))]);
    return world;
  };

  it('is cancelled through the vehicle when its own row cancels it (MapScreen.cc:7110 CancelPathForVehicle)', () => {
    const { ctx, v } = plottedHummer();
    confirmPathForCharacter(ctx, 0);
    const g = getGroup(ctx, v.movementGroup);
    expect(g).toMatchObject({ betweenSectors: true, sector: S('D13'), next: S('E13') });
    ctx.state.clock.seconds += 60;
    expect(cancelPathOfCharacterWithRoute(ctx, VEHICLE_SOLDIER)).toBe(true);
    expect(v.path).toEqual([]);
    expect(g).toMatchObject({ betweenSectors: true, sector: S('E13'), next: S('D13') });
  });

  it("drops the vehicle group's waypoints at each plotting click, until the end of the plot rebuilds them (MoveCharactersPathToVehicle, Vehicles.cc:402)", () => {
    const { ctx, v } = plottedHummer();
    confirmPathForCharacter(ctx, 0);
    expect(getGroup(ctx, v.movementGroup)?.waypoints).toEqual([S('E13')]);
    expect(plotPathForCharacter(ctx, 0, S('F13'))).toBe(true);
    expect(getGroup(ctx, v.movementGroup)).toMatchObject({ betweenSectors: true, waypoints: [] });
  });

  it("rebuilds with the vehicle's own path when the selected list is confirmed, whoever plots (MapScreen.cc:5626-5643)", () => {
    const { ctx, v } = plottedHummer();
    rebuildWayPointsForAllSelectedCharsGroups(ctx, member(ctx, 1), [1, 0]);
    expect(getGroup(ctx, v.movementGroup)).toMatchObject({ betweenSectors: true, next: S('E13'), waypoints: [S('E13')] });
  });

  it('is cancelled when its last passenger leaves, whatever the vehicle soldier holds (Vehicles.cc:356 reads the vehicle path)', () => {
    const { ctx, v } = plottedHummer();
    expect(member(ctx, VEHICLE_SOLDIER).path).toEqual([]);
    expect(removeSoldierFromVehicle(ctx, 0)).toBe(true);
    expect(v.path).toEqual([]);
  });
});

describe('killing everyone aboard (Vehicles.cc KillAllInVehicle)', () => {
  function crash(alreadyDead: ReadonlySet<number>): number[] {
    const hurt: number[] = [];
    const { ctx, v } = hummerWorld(true, (id) => {
      if (alreadyDead.has(id)) return false;
      hurt.push(id);
      return true;
    });
    addSoldierToVehicle(ctx, member(ctx, 0), v);
    addSoldierToVehicle(ctx, member(ctx, 1), v);
    expect(killAllInVehicle(ctx, v)).toEqual(hurt);
    return hurt;
  }

  it('hurts the passengers in seat order and stops at one already dead, so those seated behind him survive', () => {
    expect(crash(new Set())).toEqual([0, 1]);
    expect(crash(new Set([0]))).toEqual([]);
  });
});
