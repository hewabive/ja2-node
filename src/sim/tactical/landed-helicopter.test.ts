import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { Direction, gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import { compileWorldMovementCosts, TravelCost } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { typeIndex } from '../../content/world/tile-tables.ts';
import { type HelicopterLandingSite, setHelicopterOnMap } from './landed-helicopter.ts';
import { Team } from './soldier.ts';
import { TacticalSim } from './tactical-sim.ts';
import { tileChangeViews } from './world-view.ts';

const AIRFIELD = 'stubs/world/maps/airfield.dat';
const HELIPAD = 9001;
const NORTH_PIECE = HELIPAD - 800;
const FUSELAGE_TILE = HELIPAD - WORLD_COLS;
const NORTH_EAST_OF_FUSELAGE = FUSELAGE_TILE + 1 - WORLD_COLS;
const HELIPAD_X = HELIPAD % WORLD_COLS;
const HELIPAD_Y = Math.trunc(HELIPAD / WORLD_COLS);

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function airfield(): TacticalSim {
  return new TacticalSim(kit.world(AIRFIELD), kit.content, 3);
}

function drassen(sim: TacticalSim): HelicopterLandingSite {
  return { gridNo: HELIPAD, heliTileType: typeIndex(sim.world.tables, 'FIRSTOSTRUCT') };
}

function firstHelicopterTile(sim: TacticalSim): number {
  return sim.world.tables.types[typeIndex(sim.world.tables, 'FIRSTOSTRUCT')]?.start ?? -1;
}

function vehiclesAt(sim: TacticalSim, g: number): number {
  return sim.state.world.structures.at(g).filter((s) => (s.flags & StructureFlags.VEHICLE) !== 0).length;
}

describe('the helicopter on the loaded map', () => {
  it('appends its six pieces to the structure layer of the landing site and five rows north of it, with their structures', () => {
    const sim = airfield();
    const first = firstHelicopterTile(sim);
    setHelicopterOnMap(sim.state, drassen(sim), true);
    expect(tileChangeViews(sim.state)).toEqual([
      { kind: 'append', gridNo: HELIPAD, level: 0, tile: first },
      { kind: 'append', gridNo: HELIPAD, level: 0, tile: first + 1 },
      { kind: 'append', gridNo: NORTH_PIECE, level: 0, tile: first + 2 },
      { kind: 'append', gridNo: HELIPAD, level: 0, tile: first + 3 },
      { kind: 'append', gridNo: HELIPAD, level: 0, tile: first + 4 },
      { kind: 'append', gridNo: NORTH_PIECE, level: 0, tile: first + 5 },
    ]);
    expect(vehiclesAt(sim, FUSELAGE_TILE)).toBe(1);
    expect(vehiclesAt(sim, NORTH_PIECE)).toBe(1);
  });

  it('adds nothing on a second landing: a piece standing on the map leaves no room for itself', () => {
    const sim = airfield();
    setHelicopterOnMap(sim.state, drassen(sim), true);
    setHelicopterOnMap(sim.state, drassen(sim), true);
    expect(vehiclesAt(sim, HELIPAD)).toBe(1);
    expect(vehiclesAt(sim, NORTH_PIECE)).toBe(1);
    expect(tileChangeViews(sim.state)).toHaveLength(6);
  });

  it('takes every piece and its structure off the map at takeoff', () => {
    const sim = airfield();
    setHelicopterOnMap(sim.state, drassen(sim), true);
    setHelicopterOnMap(sim.state, drassen(sim), false);
    expect(vehiclesAt(sim, HELIPAD)).toBe(0);
    expect(vehiclesAt(sim, NORTH_PIECE)).toBe(0);
    expect(tileChangeViews(sim.state)).toEqual([]);
    expect(sim.state.landedHelicopter).toBeNull();
  });

  it('leaves the movement costs to the next full compile: a landing does not block the path, a takeoff does not free it', () => {
    const sim = airfield();
    const costs = sim.state.world.costs;
    const open = costs.get(FUSELAGE_TILE, Direction.NORTH, 0);
    expect(open).not.toBe(TravelCost.OBSTACLE);
    setHelicopterOnMap(sim.state, drassen(sim), true);
    expect(costs.get(FUSELAGE_TILE, Direction.NORTH, 0)).toBe(open);
    costs.replaceWith(compileWorldMovementCosts(sim.state.world).values);
    expect(costs.get(FUSELAGE_TILE, Direction.NORTH, 0)).toBe(TravelCost.OBSTACLE);
    setHelicopterOnMap(sim.state, drassen(sim), false);
    expect(costs.get(FUSELAGE_TILE, Direction.NORTH, 0)).toBe(TravelCost.OBSTACLE);
  });

  it('bumps a soldier from under the helicopter east to the nearest free tile, where the sweep of the square meets him again and bumps him north', () => {
    const sim = airfield();
    const merc = spawnSoldier(sim, 0, Team.OUR, FUSELAGE_TILE, Direction.NORTH);
    setHelicopterOnMap(sim.state, drassen(sim), true);
    expect(merc.gridNo).toBe(NORTH_EAST_OF_FUSELAGE);
  });

  it('bumps every soldier of the ten-tile square around the landing site off his own tile, the square ending a tile short south and east', () => {
    const sim = airfield();
    const at = (dx: number, dy: number) => gridNo(HELIPAD_X + dx, HELIPAD_Y + dy);
    const northWest = spawnSoldier(sim, 0, Team.OUR, at(-5, -5), Direction.NORTH);
    const southEast = spawnSoldier(sim, 1, Team.OUR, at(4, 4), Direction.NORTH);
    const east = spawnSoldier(sim, 2, Team.OUR, at(5, 0), Direction.NORTH);
    const south = spawnSoldier(sim, 3, Team.OUR, at(0, 5), Direction.NORTH);
    setHelicopterOnMap(sim.state, drassen(sim), true);
    expect(northWest.gridNo).toBe(at(-5, -6));
    expect(southEast.gridNo).toBe(at(4, 3));
    expect(east.gridNo).toBe(at(5, 0));
    expect(south.gridNo).toBe(at(0, 5));
  });

  it('bumps nobody at takeoff', () => {
    const sim = airfield();
    setHelicopterOnMap(sim.state, drassen(sim), true);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(HELIPAD_X + 2, HELIPAD_Y), Direction.NORTH);
    setHelicopterOnMap(sim.state, drassen(sim), false);
    expect(merc.gridNo).toBe(gridNo(HELIPAD_X + 2, HELIPAD_Y));
  });
});
