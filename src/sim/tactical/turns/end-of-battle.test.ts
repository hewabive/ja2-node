import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { soldierTakeDamage } from '../combat/hit.ts';
import { DamageReason } from '../combat/types.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';
import { numCapableEnemyInSector } from './turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('the end of a battle in real time', () => {
  it('clears the enemy presence when the last enemy bleeds to death', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(110, 110), Direction.SOUTH, { life: 3 });
    t.turn.enemyInSector = true;
    expect(t.inCombat).toBe(false);
    expect(numCapableEnemyInSector(t)).toBe(0);
    soldierTakeDamage(t, enemy, enemy.life, 0, DamageReason.BLOODLOSS, null);
    expect(enemy.life).toBe(0);
    const events = [...sim.drainEvents(), ...runUntilIdle(sim)];
    expect(enemy.dead).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'combatEnded', reason: 'won' }));
    expect(t.turn.enemyInSector).toBe(false);
  });

  it('does not count a dying soldier whose death is already handled as capable', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(110, 110), Direction.SOUTH);
    expect(numCapableEnemyInSector(t)).toBe(1);
    enemy.life = 0;
    expect(numCapableEnemyInSector(t)).toBe(1);
    enemy.dead = true;
    expect(numCapableEnemyInSector(t)).toBe(0);
  });
});
