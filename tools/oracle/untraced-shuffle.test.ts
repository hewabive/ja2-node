import { beforeAll, describe, expect, it } from 'vitest';
import { Direction, gridNo, spacesAway } from '../../src/content/world/grid.ts';
import { Rng } from '../../src/core/rng.ts';
import { AiAction } from '../../src/sim/tactical/ai/actions.ts';
import { goAsFarAsPossibleTowards } from '../../src/sim/tactical/ai/destinations.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { Orders, TEAM_FIRST_ID, Team } from '../../src/sim/tactical/soldier.ts';
import { newCombatSim, spawnSoldier } from '../../tests/support/combat.ts';
import { loadTestContent } from '../../tests/support/tactical.ts';
import { withUntracedShuffle } from './untraced-shuffle.ts';

const SEED = 9;
const NEXT_TO = 1;
const EIGHT = [0, 1, 2, 3, 4, 5, 6, 7];

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

class EmptyTrace {
  readonly asked: number[] = [];

  int(n: number): number {
    this.asked.push(n);
    throw new Error(`Random(${n}): the native trace has no draw left`);
  }
}

describe('the shuffle of a replay standing in for a stream (std::shuffle on gRandomEngine, past Random and its trace)', () => {
  it('takes no traced draw and orders as the engine it stands in for', () => {
    const trace = new EmptyTrace();
    const stream = withUntracedShuffle(trace, Rng.fromSeed(SEED));
    expect([stream.shuffled(EIGHT), trace.asked]).toEqual([Rng.fromSeed(SEED).shuffled(EIGHT), []]);
  });

  it("lets a replay reach GoAsFarAsPossibleTowards' fallback around an illegal destination", () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const civilian = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV] ?? 0, Team.CIV, gridNo(80, 90), Direction.NORTH);
    const blacklisted = gridNo(80, 84);
    civilian.ai.orders = Orders.SEEKENEMY;
    civilian.ai.blackList = blacklisted;
    const trace = new EmptyTrace();
    Object.assign(t, { rng: withUntracedShuffle(trace, t.rng) });
    const reached = goAsFarAsPossibleTowards(t, civilian, blacklisted, AiAction.SEEK_NOISE, (s) => s.uiMovementMode);
    expect([spacesAway(reached, blacklisted), trace.asked]).toEqual([NEXT_TO, []]);
  });
});
