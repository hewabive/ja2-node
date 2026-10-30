import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT } from '../../content/world/grid.ts';
import { compileTileMovementCosts } from '../../content/world/movement-costs.ts';
import { Terrain } from '../../content/world/terrain.ts';
import type { TacticalContent } from './content.ts';
import { Body, Team } from './soldier.ts';
import { findGridNoFromSweetSpot, findGridNoFromSweetSpotExcludingSweetSpot } from './sweet-spots.ts';

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
});
