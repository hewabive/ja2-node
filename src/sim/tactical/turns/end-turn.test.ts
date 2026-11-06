import { beforeAll, describe, expect, it } from 'vitest';
import { runUntilIdle } from '../../../../tests/support/combat.ts';
import { stabberHaltedOnHisWalkUp } from '../../../../tests/support/halted-strike.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('End Turn and a merc halted on a walk-up strike (TeamTurns.cc EndTurn)', () => {
  it('lets him finish his step and strike on the enemy turn, since End Turn cancels the move but keeps the pending action', () => {
    const { sim, stabber, dying } = stabberHaltedOnHisWalkUp(content);
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
    expect([stabber.finalDestination, stabber.noAPToFinishMove, stabber.pendingMelee === null]).toEqual([stabber.gridNo, false, false]);
    const events = runUntilIdle(sim);
    const strike = events.find((e) => e.type === 'meleeStrike' && e.soldier === stabber.id);
    const ourTurn = events.find((e) => e.type === 'turnStarted' && e.team === Team.OUR);
    expect(strike?.tick).toBeLessThan(ourTurn?.tick ?? 0);
    expect([dying.life, stabber.pendingMelee]).toEqual([0, null]);
  });
});
