import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, economyTestContext, loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { setFact } from '../narrative/facts.ts';
import { EnricoFlag, Town } from './constants.ts';
import { handleEnricoEmail, lackOfProgressTolerance } from './inactivity.ts';
import { setTownLoyalty } from './loyalty.ts';

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

function context(progress = 0, difficulty = 2) {
  const made = economyTestContext({ content, stateOptions: { options: { difficulty } } });
  (made.ctx.ai as { progressPercentage: () => number }).progressPercentage = () => progress;
  setFact(made.ctx.state.narrative, Fact.MIGUEL_READ_LETTER, true);
  setTownLoyalty(made.ctx, Town.DRASSEN, 50);
  return made.ctx;
}

describe('HandleEnricoEmail', () => {
  it('derives the tolerance from difficulty and highest progress', () => {
    expect([1, 2, 3].map((d) => lackOfProgressTolerance(d, 0))).toEqual([5, 4, 5]);
    expect(lackOfProgressTolerance(2, 84)).toBe(6);
  });

  it('counts inactive days and penalises from the tolerance on, with a day of grace before the second mail', () => {
    const ctx = context();
    ctx.state.map.activity.lastDayOfPlayerActivity = 0;
    const outcomes = [1, 2, 3, 4, 5, 6].map(() => handleEnricoEmail(ctx));
    expect(outcomes.map((o) => o.mail)).toEqual([null, null, null, 'lackOfProgress1', null, null]);
    expect(outcomes.map((o) => o.penalty)).toEqual([0, 0, 0, 0, 5000, 10000]);
    expect(ctx.state.map.activity.daysOfInactivity).toBe(6);
    ctx.state.map.activity.daysOfInactivity = 7;
    expect(handleEnricoEmail(ctx)).toEqual({ mail: 'lackOfProgress2', penalty: 5000 * (8 - 4 + 1) });
    expect(ctx.state.economy.towns[Town.DRASSEN]?.rating).toBeLessThan(50);
  });

  it('does not count a day with a progress or setback mail', () => {
    const ctx = context(20);
    ctx.state.map.activity.lastDayOfPlayerActivity = 0;
    expect(handleEnricoEmail(ctx)).toEqual({ mail: 'progress20', penalty: 0 });
    expect(ctx.state.map.activity.daysOfInactivity).toBe(0);
    ctx.state.status.highestProgress = 26;
    expect(handleEnricoEmail(ctx).mail).toBe('minorSetback');
    expect(ctx.state.map.activity.daysOfInactivity).toBe(0);
    ctx.state.status.highestProgress = 20;
    expect(handleEnricoEmail(ctx).mail).toBeNull();
    expect(ctx.state.status.enricoEmailFlags & EnricoFlag.SETBACK_OVER).toBeTruthy();
    ctx.state.status.highestProgress = 26;
    expect(handleEnricoEmail(ctx).mail).toBe('majorSetback');
  });

  it('keeps a third of up to four new sectors for the next day', () => {
    const ctx = context();
    ctx.state.map.activity.newSectorsVisitedToday = 7;
    handleEnricoEmail(ctx);
    expect(ctx.state.map.activity.newSectorsVisitedToday).toBe(1);
  });
});
