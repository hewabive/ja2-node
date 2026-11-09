import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { spawnCreature } from '../../../tests/support/creatures.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import { compileTileMovementCosts } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import type { TacticalContent } from './content.ts';
import { newSoldierCreate, tacticalCreateSoldier } from './creation.ts';
import { NEUTRAL_POPULATION } from './init-list.ts';
import { addSoldierToSector, Insertion } from './insertion.ts';
import { setSoldierHeight } from './roofs.ts';
import { removeSoldierFromTacticalSector } from './sector-presence.ts';
import { Body, NOWHERE, type Soldier, TEAM_FIRST_ID, Team } from './soldier.ts';
import { whoIsThere } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SWEET = gridNo(90, 80);
const CROWD_REACH = 2;
const ARRIVAL_FACING = Direction.SOUTHWEST;
const FORCED = 100;
const CREATURE_ID = TEAM_FIRST_ID[Team.CREATURE];
const SOLDIER_ID = TEAM_FIRST_ID[Team.MILITIA];

const at = (dx: number, dy: number) => SWEET + dx + dy * WORLD_COLS;

function crowdAroundTheSweetSpot(sim: TacticalSim): void {
  let id = TEAM_FIRST_ID[Team.ENEMY];
  for (let dy = -CROWD_REACH; dy <= CROWD_REACH; dy++)
    for (let dx = -CROWD_REACH; dx <= CROWD_REACH; dx++) {
      if (Math.abs(dx) === CROWD_REACH && Math.abs(dy) === CROWD_REACH) continue;
      spawnSoldier(sim, id++, Team.ENEMY, at(dx, dy), Direction.NORTH);
    }
}

function insert(sim: TacticalSim, s: Soldier, direction: number, calculateDirection: boolean) {
  s.insertionGridNo = SWEET;
  const order = { code: Insertion.GRIDNO, data: SWEET, direction };
  const placed = addSoldierToSector(sim.state, s, order, {}, calculateDirection);
  return { placed, gridNo: s.gridNo, direction: s.direction, orderDirection: order.direction };
}

const arrivingCreature = (sim: TacticalSim) => spawnCreature(sim, CREATURE_ID, Body.AM_MONSTER, gridNo(60, 60), Direction.SOUTH);
const arrivingSoldier = (sim: TacticalSim) => spawnSoldier(sim, SOLDIER_ID, Team.MILITIA, gridNo(60, 60), Direction.SOUTH);

describe('InternalAddSoldierToSector for the creature team (Soldier_Add.cc)', () => {
  it('takes the closest tile in cell coordinates its body fits and faces the first direction it fits, where a soldier takes the closest in rows plus columns and faces the centre', () => {
    const creatures = newCombatSim(content);
    crowdAroundTheSweetSpot(creatures);
    expect(insert(creatures, arrivingCreature(creatures), ARRIVAL_FACING, true)).toEqual({
      placed: true,
      gridNo: at(-2, -2),
      direction: Direction.NORTH,
      orderDirection: ARRIVAL_FACING,
    });
    const soldiers = newCombatSim(content);
    crowdAroundTheSweetSpot(soldiers);
    expect(insert(soldiers, arrivingSoldier(soldiers), ARRIVAL_FACING, true)).toMatchObject({
      placed: true,
      gridNo: at(0, -3),
      direction: Direction.WEST,
    });
  });

  it('keeps the insertion direction when the direction is not calculated, and ignores a forced one when it is', () => {
    const kept = newCombatSim(content);
    expect(insert(kept, arrivingCreature(kept), ARRIVAL_FACING, false)).toMatchObject({ gridNo: SWEET, direction: ARRIVAL_FACING });
    const forced = newCombatSim(content);
    expect(insert(forced, arrivingCreature(forced), ARRIVAL_FACING + FORCED, true)).toEqual({
      placed: true,
      gridNo: SWEET,
      direction: Direction.NORTH,
      orderDirection: ARRIVAL_FACING + FORCED,
    });
  });

  it('leaves a creature out when the search finds no tile, where a soldier falls back on the insertion tile', () => {
    const walledIn = () => {
      const sim = newCombatSim(content, [], 3, new Set(), (world) => {
        for (const step of DIRECTION_INCREMENT) {
          world.structures.add(SWEET + step, 0, syntheticStructure(StructureFlags.GENERIC));
          compileTileMovementCosts(world.costs, world, SWEET + step);
        }
      });
      spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, SWEET, Direction.NORTH);
      return sim;
    };
    const creatures = walledIn();
    expect(insert(creatures, arrivingCreature(creatures), ARRIVAL_FACING, true)).toMatchObject({ placed: false, gridNo: gridNo(60, 60) });
    const soldiers = walledIn();
    expect(insert(soldiers, arrivingSoldier(soldiers), ARRIVAL_FACING, true)).toMatchObject({ placed: true, gridNo: SWEET });
  });
});

const OUR_VEHICLE_SLOT = 18;
const NOBODY = -1;
const AWAY_FROM_IT = gridNo(60, 60);
const IN_THE_WEST_FACING_FOOTPRINT = 2;

function arrivingHummer(sim: TacticalSim): Soldier {
  const create = { ...newSoldierCreate(Team.OUR, Body.HUMVEE, Direction.SOUTH, AWAY_FROM_IT), life: 100, lifeMax: 100 };
  const s = tacticalCreateSoldier(sim.state, create, OUR_VEHICLE_SLOT, NEUTRAL_POPULATION);
  if (!s) throw new Error('no Hummer');
  return s;
}

function blockedAt(g: number): TacticalSim {
  return newCombatSim(content, [], 3, new Set(), (world) => {
    world.structures.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
    compileTileMovementCosts(world.costs, world, g);
  });
}

describe('InternalAddSoldierToSector for a vehicle (Soldier_Add.cc FindGridNoFromSweetSpotWithStructDataUsingGivenDirectionFirst)', () => {
  it('takes the closest tile its structure fits facing the insertion direction, which it keeps over the direction to the centre', () => {
    const sim = newCombatSim(content);
    const hummer = arrivingHummer(sim);
    expect(insert(sim, hummer, ARRIVAL_FACING, true)).toEqual({
      placed: true,
      gridNo: SWEET,
      direction: ARRIVAL_FACING,
      orderDirection: ARRIVAL_FACING,
    });
    expect(hummer.structure).not.toBeNull();
    expect(whoIsThere(sim.state, SWEET, 0)).toBe(hummer);
  });

  it('turns to the first of the eight directions its structure fits when the insertion direction does not, and keeps it as its insertion direction', () => {
    const sim = blockedAt(SWEET + IN_THE_WEST_FACING_FOOTPRINT);
    const hummer = arrivingHummer(sim);
    expect(insert(sim, hummer, Direction.WEST, false)).toEqual({
      placed: true,
      gridNo: SWEET,
      direction: Direction.NORTH,
      orderDirection: Direction.NORTH,
    });
    expect(hummer.structure).not.toBeNull();
  });
});

describe('InternalAddSoldierToSector for a merc seated in a vehicle (Soldier_Add.cc, Soldier_Control.cc UpdateAllVehiclePassengersGridNo)', () => {
  function seated(sim: TacticalSim, hummer: Soldier, id: number): Soldier {
    const merc = spawnSoldier(sim, id, Team.OUR, gridNo(70, 70 + id), Direction.NORTH);
    const v = sim.state.vehicles[hummer.vehicleId];
    if (!v) throw new Error('the Hummer has no vehicle');
    v.passengers[v.passengers.indexOf(NOBODY)] = merc.id;
    merc.vehicleSeat = id === 0 ? VehicleSeat.DRIVER : VehicleSeat.PASSENGER;
    removeSoldierFromTacticalSector(sim.state, merc);
    merc.gridNo = NOWHERE;
    return merc;
  }

  function enter(sim: TacticalSim, s: Soldier): boolean {
    s.insertionGridNo = SWEET;
    return addSoldierToSector(sim.state, s, { code: Insertion.NORTH, data: 0, direction: Direction.SOUTH }, {}, true);
  }

  it('is registered in his merc slot without a tile, before the vehicle, which takes him to its tile when it is placed', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const hummer = arrivingHummer(sim);
    const mercs = [seated(sim, hummer, 0), seated(sim, hummer, 1)];
    expect(mercs.map((m) => enter(sim, m))).toEqual([false, false]);
    expect(mercs.map((m) => [t.mercSlots.includes(m), m.placed, m.offMap, m.gridNo])).toEqual([
      [true, false, true, NOWHERE],
      [true, false, true, NOWHERE],
    ]);
    expect(insert(sim, hummer, ARRIVAL_FACING, true)).toMatchObject({ placed: true, gridNo: SWEET });
    expect(mercs.map((m) => [m.placed, m.offMap, m.gridNo, m.structure])).toEqual([
      [true, false, SWEET, null],
      [true, false, SWEET, null],
    ]);
    expect(whoIsThere(t, SWEET, 0)).toBe(hummer);
  });

  it('keeps the pending action a native save left him, as the entry stops before it places him (Soldier_Add.cc:707-708)', () => {
    const sim = newCombatSim(content);
    const merc = seated(sim, arrivingHummer(sim), 0);
    merc.savedPendingAction = { action: 2, giveTarget: 0, animCount: 1 };
    expect(enter(sim, merc)).toBe(false);
    expect(merc.savedPendingAction?.action).toBe(2);
  });

  it("takes the vehicle's tile at once when the vehicle is already placed, as a group arriving puts the vehicle in first", () => {
    const sim = newCombatSim(content);
    const hummer = arrivingHummer(sim);
    const merc = seated(sim, hummer, 0);
    insert(sim, hummer, ARRIVAL_FACING, true);
    expect(enter(sim, merc)).toBe(false);
    expect([merc.placed, merc.gridNo, merc.structure]).toEqual([true, SWEET, null]);
    expect(whoIsThere(sim.state, SWEET, 0)).toBe(hummer);
  });
});

describe('the pending action of a soldier added to the sector (Soldier_Add.cc AddSoldierToSectorGridNo)', () => {
  const MERC_PICKUPITEM = 2;

  it('is dropped once he stands on the map, for any team, the one a native save left him included', () => {
    const sim = newCombatSim(content);
    const militia = arrivingSoldier(sim);
    militia.savedPendingAction = { action: MERC_PICKUPITEM, giveTarget: 0, animCount: 1 };
    militia.pendingTalk = 0;
    expect(insert(sim, militia, ARRIVAL_FACING, true)).toMatchObject({ placed: true });
    expect([militia.savedPendingAction, militia.pendingTalk]).toEqual([null, null]);
  });
});

describe('the APs of a soldier added to the sector (Soldier_Add.cc InternalAddSoldierToSector)', () => {
  const LEFT_OVER = 3;

  it('keeps the APs he had, which only his creation and his turn starts count: the sector entry counts none', () => {
    const sim = newCombatSim(content);
    const s = arrivingSoldier(sim);
    removeSoldierFromTacticalSector(sim.state, s);
    s.actionPoints = LEFT_OVER;
    expect(insert(sim, s, ARRIVAL_FACING, true).placed).toBe(true);
    expect(s.actionPoints).toBe(LEFT_OVER);
  });
});

describe('a soldier added on the roof level (Soldier_Add.cc SECOND_LEVEL_Z_OFFSET)', () => {
  const CLIMBED_HEIGHT = 50;
  const roofAround = (g: number) => new Set([g - 1, g, g + 1, g - WORLD_COLS, g + WORLD_COLS]);

  it('stands him 58 px up where a roof is, 8 more than a climb leaves him, and on the ground where none is', () => {
    const roofed = newCombatSim(content, [], 3, roofAround(SWEET));
    const climber = arrivingSoldier(roofed);
    setSoldierHeight(roofed.state, climber, CLIMBED_HEIGHT);
    expect(insert(roofed, climber, ARRIVAL_FACING, false)).toMatchObject({ placed: true, gridNo: SWEET });
    expect([climber.level, climber.heightAdjustment]).toEqual([1, 58]);
    expect(whoIsThere(roofed.state, SWEET, 1)).toBe(climber);
    const bare = newCombatSim(content);
    const stranded = arrivingSoldier(bare);
    setSoldierHeight(bare.state, stranded, CLIMBED_HEIGHT);
    expect(insert(bare, stranded, ARRIVAL_FACING, false)).toMatchObject({ placed: true, gridNo: SWEET });
    expect([stranded.level, stranded.heightAdjustment]).toEqual([0, 0]);
    expect([whoIsThere(bare.state, SWEET, 0), whoIsThere(bare.state, SWEET, 1)]).toEqual([stranded, null]);
  });
});
