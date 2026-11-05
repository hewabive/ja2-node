import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import {
  addStubTank,
  HUMMER_ARRIVAL_GRIDNO,
  HUMMER_DIRECTION,
  HUMMER_GRIDNO,
  HUMMER_SECTOR,
  PROF_HUMMER,
  stubCampaignAtTheHummer,
} from '../../../tests/support/vehicles.ts';
import { parseSectorString } from '../../content/strategic/sector-ids.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, pythSpacesAway } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import { calculateSoldierZPos } from '../tactical/combat/positions.ts';
import { findBestPath, PathCopy, PathFlags } from '../tactical/pathfinding.ts';
import { ZPos } from '../tactical/perception/los.ts';
import { Body, type Soldier, Team } from '../tactical/soldier.ts';
import { type TacticalState, whoIsThere } from '../tactical/state.ts';
import { NO_MOVEMENT_GROUP, VehicleTypeId } from '../vehicles/vehicle-list.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 7;
const NPC164 = 164;
const FULL_FUEL = 10000;
const BEYOND_THE_HUMMER = gridNo(66 + 21, 66 + 9);
const OPEN_GROUND_FOR_A_TANK = gridNo(66 + 6, 66 + 3);
const NEAR_THE_HUMMER = 9;
const HEIGHT_UNITS_PER_CUBE = 64;

function tactical(session: CampaignSession): TacticalState {
  const t = session.campaign.tactical?.state;
  if (!t) throw new Error('no tactical sector');
  return t;
}

function hummerOf(t: TacticalState): Soldier {
  const s = t.soldiers.find((x) => x?.placed && x.profile === PROF_HUMMER);
  if (!s) throw new Error('the Hummer is not in the sector');
  return s;
}

function footprint(s: Soldier): number[] {
  const base = s.structure;
  if (!base) throw new Error(`soldier ${s.id} has no structure`);
  return base.def.tiles.map((tile) => s.gridNo + tile.posRelToBase);
}

function walked(from: number, steps: readonly number[]): number[] {
  const tiles: number[] = [];
  let at = from;
  for (const dir of steps) {
    at += DIRECTION_INCREMENT[dir] ?? 0;
    tiles.push(at);
  }
  return tiles;
}

describe(`the stub Hummer in ${HUMMER_SECTOR}`, () => {
  it('stands at its placement facing its direction, with the multi-tile vehicle structure of that facing', async () => {
    const session = await stubCampaignAtTheHummer(kit, SEED);
    const t = tactical(session);
    const hummer = hummerOf(t);
    expect([hummer.team, hummer.bodyType, hummer.gridNo, hummer.direction]).toEqual([
      Team.CIV,
      Body.HUMVEE,
      HUMMER_GRIDNO,
      HUMMER_DIRECTION,
    ]);
    expect(hummer.multiTile).toBe(true);
    const tiles = footprint(hummer);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0]).toBe(HUMMER_GRIDNO);
    expect(tiles.map((g) => whoIsThere(t, g, 0)?.id)).toEqual(tiles.map(() => hummer.id));
    expect((hummer.structure?.def.flags ?? 0) & StructureFlags.VEHICLE).toBe(StructureFlags.VEHICLE);
  });

  it('registers in the campaign vehicle list with its movement group, its type and a full tank', async () => {
    const session = await stubCampaignAtTheHummer(kit, SEED);
    const t = tactical(session);
    const hummer = hummerOf(t);
    const v = t.vehicles[hummer.vehicleId];
    expect(t.vehicles).toBe(session.campaign.state.forces.vehicles);
    expect(v).toMatchObject({ valid: true, destroyed: false, type: VehicleTypeId.HUMMER, soldierId: hummer.id });
    expect(v?.sector).toMatchObject(parseSectorString(HUMMER_SECTOR));
    expect(v?.movementGroup).not.toBe(NO_MOVEMENT_GROUP);
    expect([hummer.profile, hummer.breathRed]).toEqual([PROF_HUMMER, FULL_FUEL]);
  });

  it('lets the squad arrive from the west a few tiles from it, and makes their paths go around its tiles', async () => {
    const session = await stubCampaignAtTheHummer(kit, SEED);
    const t = tactical(session);
    const hummer = hummerOf(t);
    const tiles = new Set(footprint(hummer));
    const mercs = t.soldiers.filter((s): s is Soldier => s?.placed === true && s.team === Team.OUR);
    expect(mercs.length).toBeGreaterThan(0);
    for (const m of mercs) expect(pythSpacesAway(m.gridNo, HUMMER_ARRIVAL_GRIDNO), String(m.id)).toBeLessThan(NEAR_THE_HUMMER);
    const merc = mercs[0] as Soldier;
    const route = findBestPath(t.pathEnv, merc, BEYOND_THE_HUMMER, 0, { copy: PathCopy.ROUTE });
    expect(route.length).toBeGreaterThan(0);
    expect(walked(merc.gridNo, route.steps).filter((g) => tiles.has(g))).toEqual([]);
    expect(walked(merc.gridNo, route.steps).at(-1)).toBe(BEYOND_THE_HUMMER);
    const straight = findBestPath(t.pathEnv, merc, BEYOND_THE_HUMMER, 0, { copy: PathCopy.ROUTE, flags: PathFlags.THROUGH_PEOPLE });
    expect(walked(merc.gridNo, straight.steps).filter((g) => tiles.has(g)).length).toBeGreaterThan(0);
  });
});

describe('a stub tank', () => {
  it('is created on a stub map with the multi-tile tank structure, and registers as a tank with the NPC164 profile', async () => {
    const session = await stubCampaignAtTheHummer(kit, SEED);
    const t = tactical(session);
    const tank = addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: OPEN_GROUND_FOR_A_TANK, direction: Direction.NORTH });
    expect([tank.gridNo, tank.direction, tank.multiTile, tank.profile, tank.breathRed]).toEqual([
      OPEN_GROUND_FOR_A_TANK,
      Direction.NORTH,
      true,
      NPC164,
      FULL_FUEL,
    ]);
    const tiles = footprint(tank);
    expect(tiles.map((g) => whoIsThere(t, g, 0)?.id)).toEqual(tiles.map(() => tank.id));
    expect(t.vehicles[tank.vehicleId]).toMatchObject({ valid: true, type: VehicleTypeId.TANK_CAR, soldierId: tank.id });
  });

  it('reaches at its turret the cube a shot at a tank aims for: a third above a standing head (LOS.cc CalculateSoldierZPos)', async () => {
    const session = await stubCampaignAtTheHummer(kit, SEED);
    const t = tactical(session);
    const tank = addStubTank(t, { body: Body.TANK_NE, team: Team.ENEMY, gridNo: OPEN_GROUND_FOR_A_TANK, direction: Direction.NORTH });
    const aimedCube = Math.trunc(calculateSoldierZPos(t, tank, ZPos.TARGET) / HEIGHT_UNITS_PER_CUBE);
    const turret = tank.structure?.def.tiles[0]?.shape;
    if (!turret) throw new Error('the tank has no structure');
    expect(aimedCube).toBe(3);
    expect(Array.from(turret).every((cubes) => (cubes & (1 << aimedCube)) !== 0)).toBe(true);
  });
});
