import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from './content.ts';
import { Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('the turn-based UI lock of queued orders', () => {
  it('refuses another attack and endTurn until the queued attack has begun, as the original UI locks after the click', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 1, Team.OUR, gridNo(81, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.NORTH);
    sim.lookAround();
    expect(sim.state.inCombat).toBe(true);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    expect(sim.state.gameEvents).not.toHaveLength(0);
    const queued = 'the last order has not started yet: advance first';
    const refused = { ok: false, reason: queued, data: { refusal: 'orderQueued' } };
    expect(sim.dispatch({ type: 'attack', soldier: 1, target: enemy.gridNo })).toEqual(refused);
    expect(sim.dispatch({ type: 'endTurn' })).toEqual(refused);
    runUntilIdle(sim);
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
  });
});
