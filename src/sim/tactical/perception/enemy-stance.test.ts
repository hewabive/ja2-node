import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { WORLD_COLS } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { directionToward } from '../movement.ts';
import { Team } from '../soldier.ts';
import { reevaluateEnemyStance } from './enemy-stance.ts';
import { Caller } from './opp.ts';
import { manSeesMan } from './sight.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NORTH = 0;
const AT = 80 * WORLD_COLS + 80;
const EAST_OF_IT = AT + 4;

function scene() {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, EAST_OF_IT, NORTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, AT, NORTH);
  return { sim, merc, enemy };
}

describe('ReevaluateEnemyStance', () => {
  it('turns an idle enemy who newly sees one of ours towards him, charging the turn in combat', () => {
    const { sim, merc, enemy } = scene();
    sim.state.inCombat = true;
    enemy.actionPoints = 10;
    manSeesMan(sim.state, enemy, merc, Caller.VERIFYANDDECAYOPPLIST);
    expect(enemy.desiredDirection).toBe(directionToward(AT, EAST_OF_IT));
    expect(enemy.actionPoints).toBe(9);
  });

  it('leaves neutrals, our team and soldiers under AI control alone', () => {
    const { sim, merc, enemy } = scene();
    enemy.neutral = true;
    expect(reevaluateEnemyStance(sim.state, enemy, enemy.state)).toBe(false);
    enemy.neutral = false;
    enemy.aiTurnControl = true;
    enemy.ai.oppCount = 1;
    expect(reevaluateEnemyStance(sim.state, enemy, enemy.state)).toBe(false);
    expect(reevaluateEnemyStance(sim.state, merc, merc.state)).toBe(false);
  });
});
