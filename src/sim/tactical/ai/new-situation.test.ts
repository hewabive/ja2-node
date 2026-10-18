import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { createPhysicalObject } from '../explosions/physics.ts';
import { ThrowAction } from '../explosions/state.ts';
import { vec3 } from '../explosions/vec3.ts';
import { Team } from '../soldier.ts';
import { AiAction, Situation } from './actions.ts';
import { handleSoldierAI } from './control.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function tosserWithNewSituation() {
  const sim = newCombatSim(content);
  const t = sim.state;
  spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
  sim.lookAround();
  expect(t.inCombat).toBe(true);
  t.turn.currentTeam = Team.ENEMY;
  enemy.aiTurnControl = true;
  enemy.ai.action = AiAction.TOSS_PROJECTILE;
  enemy.ai.actionInProgress = true;
  enemy.ai.newSituation = Situation.IS_NEW;
  t.turn.attackBusyCount = 2;
  return { sim, t, enemy };
}

describe('a new situation during an attack', () => {
  it('clears the attack busy count for a tosser once nothing is in the air', () => {
    const { sim, t, enemy } = tosserWithNewSituation();
    handleSoldierAI(t, enemy, sim.ai);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(enemy.ai.newSituation).not.toBe(Situation.IS_NEW);
  });

  it('waits for the attack while the thrown object is still flying', () => {
    const { sim, t, enemy } = tosserWithNewSituation();
    const grenade = createItem(content.items, content.items.byName.get('HAND_GRENADE')?.index ?? -1, 100);
    createPhysicalObject(t, grenade, -1, vec3(800, 800, 10), vec3(), enemy, ThrowAction.ARM_ITEM, null);
    handleSoldierAI(t, enemy, sim.ai);
    expect(t.turn.attackBusyCount).toBe(2);
    expect(enemy.ai.action).toBe(AiAction.TOSS_PROJECTILE);
    expect(enemy.ai.newSituation).toBe(Situation.IS_NEW);
  });
});
