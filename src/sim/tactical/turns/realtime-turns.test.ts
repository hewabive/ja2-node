import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import type { TacticalContent } from '../content.ts';
import { handleRealtimeTurns, type RealtimeClock } from './turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('real-time turns', () => {
  it('fall on the 20 ms overhead counter, so a turn comes every 5020 ms', () => {
    const t = newCombatSim(content).state;
    t.inCombat = false;
    const clock: RealtimeClock = { lastTurnMs: 0, lastDecayMs: 0, lastOverheadMs: 0 };
    const turns: number[] = [];
    for (t.clockMs = 5; t.clockMs <= 15_100; t.clockMs += 5) {
      const before = clock.lastTurnMs;
      handleRealtimeTurns(t, clock);
      if (clock.lastTurnMs !== before) turns.push(t.clockMs);
    }
    expect(turns).toEqual([5020, 10040, 15060]);
  });
});
