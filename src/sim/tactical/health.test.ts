import { describe, expect, it } from 'vitest';
import { healthCategory, soldierCondition } from './health.ts';

describe('health categories', () => {
  it('use the bHealthStrRanges thresholds and show at least fair at full life', () => {
    expect(healthCategory(10, 80)).toBe('dying');
    expect(healthCategory(29, 80)).toBe('critical');
    expect(healthCategory(44, 80)).toBe('wounded');
    expect(healthCategory(59, 80)).toBe('poor');
    expect(healthCategory(60, 80)).toBe('fair');
    expect(healthCategory(89, 95)).toBe('good');
    expect(healthCategory(90, 95)).toBe('excellent');
    expect(healthCategory(40, 40)).toBe('fair');
    expect(healthCategory(80, 80)).toBe('good');
  });

  it('checks the merc condition from the worst to the best', () => {
    const merc = { life: 80, lifeMax: 80, bleeding: 0, breath: 100, collapsed: false };
    expect(soldierCondition({ ...merc, life: 0 })).toBe('dead');
    expect(soldierCondition({ ...merc, life: 10, bleeding: 3 })).toBe('dying');
    expect(soldierCondition({ ...merc, breath: 5, collapsed: true })).toBe('unconscious');
    expect(soldierCondition({ ...merc, bleeding: 13 })).toBe('bleeding');
    expect(soldierCondition({ ...merc, life: 39 })).toBe('wounded');
    expect(soldierCondition({ ...merc, breath: 49 })).toBe('fatigued');
    expect(soldierCondition({ ...merc, life: 53 })).toBe('fair');
    expect(soldierCondition({ ...merc, life: 68 })).toBe('good');
    expect(soldierCondition(merc)).toBe('excellent');
  });
});
