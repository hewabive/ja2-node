import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { deathOpcode } from '../combat/death.ts';
import { soldierCollapse } from '../combat/hit.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';
import { AiAction } from './actions.ts';
import { handleSoldierAI } from './control.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const FORCE_FREE_ATTACKER = 480;

function enemyOnHisTurn() {
  const sim = newCombatSim(content);
  const t = sim.state;
  spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
  sim.lookAround();
  expect(t.inCombat).toBe(true);
  t.turn.currentTeam = Team.ENEMY;
  enemy.aiTurnControl = true;
  return { sim, t, enemy };
}

describe('the AI of a soldier who is being hit', () => {
  it('waits until the hit is over before deciding', () => {
    const { sim, t, enemy } = enemyOnHisTurn();
    enemy.gettingHit = 1;
    const stateBefore = enemy.state;
    handleSoldierAI(t, enemy, sim.ai);
    expect(enemy.ai.lastAction).toBe(AiAction.NONE);
    expect(enemy.state).toBe(stateBefore);
    enemy.gettingHit = 0;
    handleSoldierAI(t, enemy, sim.ai);
    expect(enemy.ai.lastAction).not.toBe(AiAction.NONE);
  });

  it('ends being hit at the force-free code of the hit animation', () => {
    const { t, enemy } = enemyOnHisTurn();
    enemy.gettingHit = 1;
    deathOpcode(t, enemy, FORCE_FREE_ATTACKER);
    expect(enemy.gettingHit).toBe(0);
  });

  it('ends the turn of the soldier under AI control when he collapses', () => {
    const { t, enemy } = enemyOnHisTurn();
    soldierCollapse(t, enemy);
    expect(enemy.aiTurnControl).toBe(false);
    expect(enemy.moved).toBe(true);
  });
});
