import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT } from '../../content/world/grid.ts';
import { compileTileMovementCosts } from '../../content/world/movement-costs.ts';
import { Terrain } from '../../content/world/terrain.ts';
import type { TacticalContent } from './content.ts';
import { freeTilesAround } from './item-placement.ts';
import { newOKDestination } from './pathfinding.ts';
import { SECOND_LEVEL_Z_OFFSET, setSoldierHeight } from './roofs.ts';
import { Body, NOWHERE, Team } from './soldier.ts';
import {
  dummySoldier,
  findGridNoFromSweetSpot,
  findGridNoFromSweetSpotExcludingSweetSpot,
  findGridNoFromSweetSpotExcludingSweetSpotInSouthEastQuadrant,
  reachableAround,
} from './sweet-spots.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const COLS = 160;
const SWEET = 12080;
const NORTH = 0;

describe('FindGridNoFromSweetSpotExcludingSweetSpot (Soldier_Add.cc)', () => {
  it('takes the first closest free tile in row-major order, never the sweet spot itself', () => {
    const sim = newCombatSim(content);
    const walker = spawnSoldier(sim, 116, Team.CIV, SWEET + 10 * COLS, NORTH);
    expect(findGridNoFromSweetSpotExcludingSweetSpot(sim.state, walker, SWEET, 5)).toBe(SWEET - COLS);
  });

  it('skips tiles taken by people', () => {
    const sim = newCombatSim(content);
    const walker = spawnSoldier(sim, 116, Team.CIV, SWEET + 10 * COLS, NORTH);
    spawnSoldier(sim, 117, Team.CIV, SWEET - COLS, NORTH);
    expect(findGridNoFromSweetSpotExcludingSweetSpot(sim.state, walker, SWEET, 5)).toBe(SWEET - 1);
  });
});

describe('FindGridNoFromSweetSpotExcludingSweetSpotInQuardent with SOUTHEAST (Soldier_Add.cc)', () => {
  const inQuadrant = (sim: ReturnType<typeof newCombatSim>, walker: ReturnType<typeof spawnSoldier>) =>
    findGridNoFromSweetSpotExcludingSweetSpotInSouthEastQuadrant(sim.state, walker, SWEET, 3);

  it('takes the tile to the east first, then the one to the south at the same range, then the diagonal', () => {
    const sim = newCombatSim(content);
    const walker = spawnSoldier(sim, 116, Team.CIV, SWEET, NORTH);
    expect(inQuadrant(sim, walker)).toBe(SWEET + 1);
    spawnSoldier(sim, 117, Team.CIV, SWEET + 1, NORTH);
    expect(inQuadrant(sim, walker)).toBe(SWEET + COLS);
    spawnSoldier(sim, 118, Team.CIV, SWEET + COLS, NORTH);
    expect(inQuadrant(sim, walker)).toBe(SWEET + COLS + 1);
  });

  it('never looks north or west of the sweet spot', () => {
    const sim = newCombatSim(content);
    const walker = spawnSoldier(sim, 116, Team.CIV, SWEET, NORTH);
    for (let dy = 0; dy <= 3; dy++)
      for (let dx = 0; dx <= 3; dx++) if (dx + dy > 0) spawnSoldier(sim, 120 + dy * 4 + dx, Team.CIV, SWEET + dy * COLS + dx, NORTH);
    expect(inQuadrant(sim, walker)).toBe(NOWHERE);
  });
});

describe('the dummy soldier of the item and corpse placement (Handle_Items.cc FindNearestAvailableGridNoForItem)', () => {
  it('is nobody: our first merc, soldier 0, blocks the flood and the destination test as any other soldier does', () => {
    const sim = newCombatSim(content);
    const first = spawnSoldier(sim, 0, Team.OUR, SWEET + 1, NORTH);
    const second = spawnSoldier(sim, 1, Team.OUR, SWEET - 1, NORTH);
    const dummy = dummySoldier(SWEET, Team.ENEMY, 0);
    const PATH_AROUND_PEOPLE = 0;
    const reachable = reachableAround(sim.state, dummy, 1, { flags: PATH_AROUND_PEOPLE });
    for (const s of [first, second]) {
      expect(reachable).not.toContain(s.gridNo);
      expect(newOKDestination(sim.state.pathEnv, dummy, s.gridNo, true, 0)).toBe(false);
      expect(freeTilesAround(sim.state, SWEET, 1)).not.toContain(s.gridNo);
    }
  });
});

describe('FindGridNoFromSweetSpot (Soldier_Add.cc)', () => {
  it('floods from the sweet spot as a merc-bodied enemy, so a crow may get a spot in the water', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    for (const step of DIRECTION_INCREMENT) {
      t.world.terrain[SWEET + step] = Terrain.DEEP_WATER;
      compileTileMovementCosts(t.world.costs, t.world, SWEET + step);
    }
    spawnSoldier(sim, 117, Team.CIV, SWEET, NORTH);
    const crow = spawnSoldier(sim, 116, Team.CREATURE, SWEET + 10 * COLS, NORTH);
    crow.bodyType = Body.CROW;
    expect(findGridNoFromSweetSpot(t, crow, SWEET, 4)).toBe(SWEET - COLS);
  });

  it('floods on the ground even for a soldier on a roof, so it hands him the nearest free tile, roof or none (Soldier_Add.cc:57, :88)', () => {
    const sim = newCombatSim(content, [], 3, new Set([SWEET]));
    const t = sim.state;
    const sitter = spawnSoldier(sim, 117, Team.CIV, SWEET, NORTH);
    setSoldierHeight(t, sitter, SECOND_LEVEL_Z_OFFSET);
    const climber = spawnSoldier(sim, 116, Team.CIV, SWEET + 10 * COLS, NORTH);
    setSoldierHeight(t, climber, SECOND_LEVEL_Z_OFFSET);
    expect(findGridNoFromSweetSpot(t, climber, SWEET, 4)).toBe(SWEET - COLS);
  });
});
