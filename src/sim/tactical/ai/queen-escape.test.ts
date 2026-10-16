import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { AiAction } from './actions.ts';
import { queenEscape, traverseDown } from './queen-escape.ts';

const PALACE = 'stubs/world/maps/p3.dat';
const QUEEN = 75;
const JOE = 79;
const STAIRCASE = 12067;
const NEXT_TO_STAIRCASE = STAIRCASE + 1;
const FAR_FROM_STAIRCASE = 11752;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function palace(port: Partial<typeof NO_NARRATIVE_PORT> = {}): TacticalSim {
  const sim = new TacticalSim(kit.world(PALACE), kit.content, 3);
  sim.state.sector = { x: 3, y: 16, z: 0 };
  sim.state.narrative = { ...NO_NARRATIVE_PORT, ...port };
  return sim;
}

describe('the Queen heads for the basement (docs/26 §5.2)', () => {
  it('walks to the staircase, traverses down next to it, and Joe follows only from red alert', () => {
    const sim = palace();
    const queen = spawnSoldier(sim, 140, Team.CIV, FAR_FROM_STAIRCASE, 0, { profile: QUEEN });
    expect(queenEscape(sim.state, queen, true, false)).toBe(AiAction.GET_CLOSER);
    expect(queen.ai.actionData).toBe(STAIRCASE);
    expect(queenEscape(sim.state, queen, false, false)).toBe(AiAction.NONE);
    const joe = spawnSoldier(sim, 141, Team.CIV, NEXT_TO_STAIRCASE, 0, { profile: JOE });
    expect(queenEscape(sim.state, joe, true, false)).toBe(AiAction.NONE);
    expect(queenEscape(sim.state, joe, true, true)).toBe(AiAction.TRAVERSE_DOWN);
  });

  it('stays upstairs at the alternate position or when the basement was taken, and outside P3', () => {
    const queen = (sim: TacticalSim) => spawnSoldier(sim, 140, Team.CIV, NEXT_TO_STAIRCASE, 0, { profile: QUEEN });
    const alternate = palace({ queenCanFlee: () => false });
    expect(queenEscape(alternate.state, queen(alternate), true, false)).toBe(AiAction.NONE);
    const secured = palace({ palaceBasementSecured: () => true });
    expect(queenEscape(secured.state, queen(secured), true, false)).toBe(AiAction.NONE);
    const elsewhere = palace();
    elsewhere.state.sector = { x: 3, y: 16, z: 1 };
    expect(queenEscape(elsewhere.state, queen(elsewhere), true, false)).toBe(AiAction.NONE);
  });

  it('moves her profile one level down and removes her from the sector', () => {
    const sim = palace();
    sim.state.profiles.set(QUEEN, testProfile(QUEEN, { sectorX: 3, sectorY: 16, sectorZ: 0, useProfileInsertion: true }));
    const queen = spawnSoldier(sim, 140, Team.CIV, NEXT_TO_STAIRCASE, 0, { profile: QUEEN });
    traverseDown(sim.state, queen);
    expect(sim.state.profiles.get(QUEEN)).toMatchObject({ sectorZ: 1, useProfileInsertion: false });
    expect(queen.placed).toBe(false);
  });
});
