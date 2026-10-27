import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const TIRED_BREATH = 5;

function stealthyFootsteps(team: number, stealth: boolean): number[] {
  const sim = newCombatSim(content);
  const walker = spawnSoldier(sim, 1, team, gridNo(60, 80), Direction.EAST);
  walker.stealthMode = stealth;
  walker.breath = TIRED_BREATH;
  walker.breathMax = TIRED_BREATH;
  expect(sim.dispatch({ type: 'move', soldier: walker.id, to: gridNo(100, 80), mode: 'walk' }).ok).toBe(true);
  return runUntilIdle(sim).flatMap((e) => (e.type === 'stealthyFootstep' ? [e.soldier] : []));
}

describe('HandleAtNewGridNo', () => {
  it('plays the stealthy footstep of a merc in stealth mode on the tiles where he makes movement noise', () => {
    const steps = stealthyFootsteps(Team.OUR, true);
    expect(steps.length).toBeGreaterThan(0);
    expect(new Set(steps)).toEqual(new Set([1]));
    expect(stealthyFootsteps(Team.OUR, false)).toEqual([]);
  });
});
