import { describe, expect, it } from 'vitest';
import { advance, type Steppable } from './advance.ts';
import type { SimEvent } from './events.ts';

function fake(idleAt: number, eventAt = -1, decisionAt = -1): Steppable {
  let tick = 0;
  let pending: SimEvent[] = [];
  return {
    get tick() {
      return tick;
    },
    isIdle: () => tick >= idleAt,
    hasPendingDecision: () => decisionAt >= 0 && tick >= decisionAt,
    step: () => {
      tick++;
      if (tick === eventAt) pending.push({ type: 'budgetExhausted', tick });
    },
    drainEvents: () => {
      const out = pending;
      pending = [];
      return out;
    },
  };
}

describe('advance', () => {
  it('stops when idle, on a watched event, on a decision or at the tick limit', () => {
    expect(advance(fake(10), { idle: true })).toMatchObject({ tick: 10, reason: 'idle' });
    expect(advance(fake(100, 7), { idle: true, events: ['budgetExhausted'] })).toMatchObject({ tick: 7, reason: 'event' });
    expect(advance(fake(100, -1, 3), { idle: true })).toMatchObject({ tick: 3, reason: 'decision' });
    expect(advance(fake(100), { ticks: 25 })).toMatchObject({ tick: 25, reason: 'ticks' });
    expect(advance(fake(1000), { idle: true }, 50)).toMatchObject({ tick: 50, reason: 'budget' });
  });

  it('collects every event on the way', () => {
    expect(advance(fake(20, 5), { idle: true }).events).toEqual([{ type: 'budgetExhausted', tick: 5 }]);
  });
});
