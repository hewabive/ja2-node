import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { NOWHERE, Team } from '../soldier.ts';
import { closestReachableDisturbance } from './utils.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('the closest reachable disturbance (AIUtils.cc ClosestReachableDisturbance)', () => {
  it('moves a public noise the soldier stands next to and sees two tiles west instead of fading it', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const guard = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.EAST);
    const volume = 20;
    t.perception.publicNoiseGridNo[Team.ENEMY] = gridNo(83, 80);
    t.perception.publicNoiseLevel[Team.ENEMY] = 0;
    t.perception.publicNoiseVolume[Team.ENEMY] = volume;
    expect(closestReachableDisturbance(t, guard).gridNo).toBe(NOWHERE);
    expect(t.perception.publicNoiseGridNo[Team.ENEMY]).toBe(gridNo(81, 80));
    expect(t.perception.publicNoiseVolume[Team.ENEMY]).toBe(volume);
  });
});
