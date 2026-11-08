import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { stabberHaltedOnHisWalkUp } from '../../../../tests/support/halted-strike.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { AiAction } from '../ai/actions.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';
import { sendBeginFireWeaponEvent } from './attack.ts';
import { reduceAttackBusyCount } from './barrier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function enemyAttackingWhileOurAttackHoldsTheCount(action: number) {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
  sim.lookAround();
  expect(t.inCombat).toBe(true);
  t.turn.currentTeam = Team.ENEMY;
  enemy.aiTurnControl = true;
  enemy.ai.action = action;
  enemy.ai.actionInProgress = true;
  t.turn.attackBusyCount = 1;
  return { t, merc, enemy };
}

describe('the end of an attack', () => {
  it('ends the enemy turn when our stab, released by End Turn on a halted walk-up, outlasts an enemy shot', () => {
    const { sim, stabber, sighted, dying, shooter } = stabberHaltedOnHisWalkUp(content);
    const t = sim.state;
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    const tickOf = (type: string, soldier: number) => events.find((e) => e.type === type && 'soldier' in e && e.soldier === soldier)?.tick;
    expect(tickOf('shotFired', shooter.id)).toBeLessThan(tickOf('meleeStrike', stabber.id) ?? 0);
    expect(events.filter((e) => e.type === 'attackResolved').map((e) => e.soldier)).toEqual([stabber.id]);
    expect([dying.life, sighted.life > 0]).toEqual([0, true]);
    expect([t.turn.currentTeam, t.turn.attackBusyCount, shooter.ai.actionInProgress]).toEqual([Team.OUR, 0, false]);
  });

  it.each([
    ['gun', AiAction.FIRE_GUN],
    ['knife throw', AiAction.THROW_KNIFE],
    ['throw', AiAction.TOSS_PROJECTILE],
    ['stab', AiAction.KNIFE_STAB],
  ])('frees an enemy whose %s our attack outlasted when ours empties the count', (_, action) => {
    const { t, merc, enemy } = enemyAttackingWhileOurAttackHoldsTheCount(action);
    reduceAttackBusyCount(t, merc, false);
    expect([t.turn.attackBusyCount, enemy.ai.action, enemy.ai.actionInProgress]).toEqual([0, AiAction.NONE, false]);
  });

  it('keeps an enemy whose shot still waits in the event queue', () => {
    const { t, merc, enemy } = enemyAttackingWhileOurAttackHoldsTheCount(AiAction.FIRE_GUN);
    sendBeginFireWeaponEvent(t, enemy, merc.gridNo);
    reduceAttackBusyCount(t, merc, false);
    expect([enemy.ai.action, enemy.ai.actionInProgress]).toEqual([AiAction.FIRE_GUN, true]);
  });
});
