import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { AlertStatus, Team } from '../soldier.ts';
import { startNPCAI } from './turn-based.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('the start of an AI turn (AIMain.cc RefreshAI)', () => {
  function startTurnAt(alertStatus: number) {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.SOUTH);
    t.inCombat = true;
    enemy.lastAttackHit = true;
    enemy.ai.alertStatus = alertStatus;
    enemy.ai.actionInProgress = true;
    t.turn.skipCoverCheck = true;
    startNPCAI(t, enemy, sim.ai);
    expect(enemy.ai.alertStatus).toBe(alertStatus);
    return { lastAttackHit: enemy.lastAttackHit, skipCoverCheck: t.turn.skipCoverCheck };
  }

  it('forgets whether the last attack hit, and only a yellow soldier clears the cover skip a turn or stance change set', () => {
    expect(startTurnAt(AlertStatus.YELLOW)).toEqual({ lastAttackHit: false, skipCoverCheck: false });
    expect(startTurnAt(AlertStatus.RED)).toEqual({ lastAttackHit: false, skipCoverCheck: true });
  });
});
