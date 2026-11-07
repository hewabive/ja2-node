import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { ourHummerOnTheMap, seatInVehicle } from '../../../tests/support/vehicles.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import type { MapDoor } from '../../content/formats/map.ts';
import { DIRECTION_COUNT, Direction, gridNo } from '../../content/world/grid.ts';
import { recompileLocalMovementCosts, TravelCost } from '../../content/world/movement-costs.ts';
import { absoluteScreenXY, mapPosFromAbsoluteScreenXY, restrictedScrollIdOf } from '../../content/world/render-bounds.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { type SyntheticWorld, syntheticStructure } from '../../content/world/synthetic.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import { states } from './animation.ts';
import { Insertion } from './insertion.ts';
import { addExitGridToWorld } from './map-changes.ts';
import { setSoldierPosition } from './movement.ts';
import { NOWHERE } from './pathfinding.ts';
import {
  adjustSoldierPathToGoOffEdge,
  checkMercsWaiting,
  ExitDirection,
  findGridNoFromSweetSpotCloseToExitGrid,
  mirrorGridNo,
  pickGridNoNearestEdge,
  pickGridNoToWalkIn,
  setActionToDoOnceMercsGetToLocation,
  soldierOKForSectorExit,
} from './sector-exit.ts';
import { createSoldier, type Soldier, Team } from './soldier.ts';
import { onVisibleWorldTile, registerSoldier, WaitForMercs } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const STATS = {
  agility: 80,
  dexterity: 80,
  strength: 80,
  wisdom: 80,
  leadership: 50,
  marksmanship: 80,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

function merc(sim: TacticalSim, gridNo: number, id = 0): Soldier {
  const t = sim.state;
  const palettes = { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' };
  const s = createSoldier({
    id,
    team: Team.OUR,
    name: 'M',
    bodyType: 0,
    palettes,
    stats: STATS,
    life: 80,
    gridNo: -1,
    direction: 0,
    state: states(t.content.animations).STANDING,
  });
  registerSoldier(t, s);
  setSoldierPosition(t, s, gridNo);
  return s;
}

function screenOf(sim: TacticalSim, g: number): { readonly x: number; readonly y: number } {
  return absoluteScreenXY(restrictedScrollIdOf(sim.state.world), g);
}

describe('screen-space exit thresholds', () => {
  it('allow an east exit only within 160 screen pixels of the edge', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const near = merc(sim, 75 * 160 + 147);
    expect(screenOf(sim, near.gridNo).x).toBe(3020);
    expect(soldierOKForSectorExit(sim.state, near, ExitDirection.EAST, 0)).toBe(true);
    const far = merc(sim, 75 * 160 + 146, 1);
    expect(soldierOKForSectorExit(sim.state, far, ExitDirection.EAST, 0)).toBe(false);
    expect(soldierOKForSectorExit(sim.state, near, ExitDirection.WEST, 0)).toBe(false);
  });

  it('use the smaller visible area of a basement', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a10_b1.dat'), kit.content, 1);
    expect(onVisibleWorldTile(sim.state, 80 * 160 + 80)).toBe(true);
    expect(onVisibleWorldTile(sim.state, 80 * 160 + 112)).toBe(false);
    const a9 = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    expect(onVisibleWorldTile(a9.state, 80 * 160 + 112)).toBe(true);
  });

  it('maps screen positions back to grid numbers', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const g = 70 * 160 + 90;
    const { x, y } = screenOf(sim, g);
    expect(mapPosFromAbsoluteScreenXY(restrictedScrollIdOf(sim.state.world), x, y)).toBe(g);
  });
});

describe('walking off and on', () => {
  it('picks the last reachable tile toward the edge and mirrors the position to the far side', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const s = merc(sim, 75 * 160 + 140);
    const edge = pickGridNoNearestEdge(sim.state, s, Direction.EAST);
    expect(onVisibleWorldTile(sim.state, edge)).toBe(true);
    expect(screenOf(sim, edge).x).toBeGreaterThan(3020);
    const mirror = mirrorGridNo(sim.state, s, Direction.EAST);
    expect(screenOf(sim, mirror).x).toBeLessThanOrEqual(4);
    const walkIn = pickGridNoToWalkIn(sim.state, s, Insertion.WEST);
    expect(walkIn.attempts).toBe(1);
    expect(screenOf(sim, walkIn.gridNo).x).toBeLessThan(80);
  });

  it('adds two steps beyond the edge to the path', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const s = merc(sim, 75 * 160 + 150);
    s.pathSize = 0;
    adjustSoldierPathToGoOffEdge(s, s.gridNo, Direction.EAST);
    expect(s.path.slice(0, 2)).toEqual([Direction.NORTHEAST, Direction.NORTHEAST]);
    expect(s.finalDestination).toBe(s.gridNo - 2 * 159);
  });

  it('releases the wait after 2500 ms even if nobody arrived', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const t = sim.state;
    let over = -1;
    t.sectorHooks = { ...t.sectorHooks, mercsWaitOver: (_t, code) => (over = code) };
    setActionToDoOnceMercsGetToLocation(t, WaitForMercs.WALKOFF_SCREEN, 2);
    expect(t.perception.disallowSight).toBe(true);
    t.clockMs += 2500;
    checkMercsWaiting(t);
    expect(over).toBe(-1);
    t.clockMs += 5;
    checkMercsWaiting(t);
    expect(over).toBe(WaitForMercs.WALKOFF_SCREEN);
    expect(t.perception.disallowSight).toBe(false);
    expect(t.mercsWaiting).toBeNull();
  });
});

describe('the way to an exit grid (Exit_Grids.cc FindGridNoFromSweetSpotCloseToExitGrid)', () => {
  const CAR_AT = gridNo(80, 70);
  const DRIVER_AT = gridNo(90, 78);
  const WALL_X = 76;
  const WALL_TOP = 55;
  const WALL_BOTTOM = 85;
  const GAP = gridNo(WALL_X, 70);
  const EXIT_AT = gridNo(72, 70);
  const BASEMENT = { x: 9, y: 2, z: 1 };
  const SEARCH_RADIUS = 10;
  const DRIVER = 5;
  const IN_THE_GAP = 6;

  function wallWithAGap(world: SyntheticWorld): void {
    for (let y = WALL_TOP; y <= WALL_BOTTOM; y++) {
      const g = gridNo(WALL_X, y);
      if (g === GAP) continue;
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) world.costs.force(g, direction, 0, TravelCost.OBSTACLE);
    }
  }

  it('finds a vehicle the exit tile past a gap one tile wide with a merc in it: the search floods as a lone walker through people, the zeroed dummy soldier of the original, and fits the vehicle on the exit tile only (quirk)', () => {
    const sim = newCombatSim(kit.content, [], 3, new Set(), wallWithAGap, { exitGrids: [] });
    const t = sim.state;
    const driver = spawnSoldier(sim, DRIVER, Team.OUR, DRIVER_AT, Direction.NORTH);
    const hummer = ourHummerOnTheMap(t, CAR_AT);
    seatInVehicle(t, driver, hummer, VehicleSeat.DRIVER);
    spawnSoldier(sim, IN_THE_GAP, Team.OUR, GAP, Direction.NORTH);
    addExitGridToWorld(t, { mapIndex: EXIT_AT, gridNo: EXIT_AT, sector: BASEMENT });
    expect(findGridNoFromSweetSpotCloseToExitGrid(t, hummer, EXIT_AT, SEARCH_RADIUS)).toBe(EXIT_AT);
    expect(soldierOKForSectorExit(t, hummer, ExitDirection.EXIT_GRID, EXIT_AT)).toBe(true);
  });

  const HOUSE_WALL_Y = 79;
  const DOOR_X = 80;
  const DOOR_AT = gridNo(DOOR_X, HOUSE_WALL_Y);
  const BEHIND_THE_DOOR = gridNo(80, 77);
  const BEFORE_THE_DOOR = gridNo(80, 80);
  const HOUSE_WEST = 70;
  const HOUSE_EAST = 90;
  const KEYS = 1;
  const MERC = 0;

  function houseWallWithADoor(world: SyntheticWorld): void {
    for (let x = HOUSE_WEST; x <= HOUSE_EAST; x++) {
      const flags = x === DOOR_X ? StructureFlags.DOOR | StructureFlags.OPENABLE : StructureFlags.WALL;
      world.structures.add(gridNo(x, HOUSE_WALL_Y), 0, syntheticStructure(flags, Orientation.INSIDE_LEFT));
    }
    for (let x = HOUSE_WEST; x <= HOUSE_EAST; x++) recompileLocalMovementCosts(world.costs, world, gridNo(x, HOUSE_WALL_Y));
  }

  function doorRecord(locked: boolean): MapDoor {
    return { gridNo: DOOR_AT, locked, trapLevel: 0, trapId: 0, lockId: 0, perceivedLocked: 0, perceivedTrapped: 0, lockDamage: 0 };
  }

  it('floods past a closed door as the zeroed dummy soldier, who has no keys: a locked one stops the search even for a merc carrying keys (quirk)', () => {
    for (const locked of [false, true]) {
      const sim = newCombatSim(kit.content, [], 3, new Set(), houseWallWithADoor, { exitGrids: [], doors: [doorRecord(locked)] });
      const t = sim.state;
      const merc = spawnSoldier(sim, MERC, Team.OUR, BEFORE_THE_DOOR, Direction.NORTH);
      merc.hasKeys = KEYS;
      addExitGridToWorld(t, { mapIndex: BEHIND_THE_DOOR, gridNo: BEHIND_THE_DOOR, sector: BASEMENT });
      expect(findGridNoFromSweetSpotCloseToExitGrid(t, merc, BEHIND_THE_DOOR, SEARCH_RADIUS)).toBe(locked ? NOWHERE : BEHIND_THE_DOOR);
    }
  });
});
