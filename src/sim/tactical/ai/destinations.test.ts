import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo, spacesAway } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { Orders, TEAM_FIRST_ID, Team } from '../soldier.ts';
import { AiAction } from './actions.ts';
import { goAsFarAsPossibleTowards } from './destinations.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NEXT_TO = 1;

describe('the fallback of GoAsFarAsPossibleTowards (Movement.cc InternalGoAsFarAsPossibleTowards)', () => {
  it('heads for a tile beside an illegal destination, shuffling the eight directions past Random as std::shuffle draws on the engine itself', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const civilian = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV] ?? 0, Team.CIV, gridNo(80, 90), Direction.NORTH);
    const blacklisted = gridNo(80, 84);
    civilian.ai.orders = Orders.SEEKENEMY;
    civilian.ai.blackList = blacklisted;
    Object.assign(t.rng, {
      int: () => {
        throw new Error('the fallback drew through Random');
      },
    });
    const reached = goAsFarAsPossibleTowards(t, civilian, blacklisted, AiAction.SEEK_NOISE, (s) => s.uiMovementMode);
    expect([spacesAway(reached, blacklisted), civilian.finalDestination]).toEqual([NEXT_TO, reached]);
  });
});
