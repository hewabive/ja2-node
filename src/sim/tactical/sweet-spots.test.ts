import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import type { TacticalContent } from './content.ts';
import { Team } from './soldier.ts';
import { findGridNoFromSweetSpotExcludingSweetSpot } from './sweet-spots.ts';

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
