import { describe, expect, it } from 'vitest';
import { describeChanges } from './baseline.ts';
import { ALL_COUNTERS, declared } from './inspector.ts';
import type { BenchLine } from './measure.ts';
import { distribution, percentile } from './stats.ts';

function line(p50: number, p95: number): BenchLine {
  return {
    scenario: 'enemy-turn',
    variant: 'arena-e16',
    source: 'stubs',
    seed: 2,
    runs: 1,
    metric: 'enemyTurn',
    unit: 'ms',
    n: 3,
    mean: p50,
    p50,
    p95,
    p99: p95,
    max: p95,
    series: {},
    counters: {},
  };
}

describe('bench statistics', () => {
  it('takes nearest-rank percentiles', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
  });

  it('summarises samples', () => {
    expect(distribution([3, 1, 2])).toEqual({ n: 3, mean: 2, p50: 2, p95: 3, p99: 3, max: 3 });
    expect(distribution([]).n).toBe(0);
  });

  it('describes the change against a baseline per metric', () => {
    const [message] = describeChanges({ 'enemy-turn/arena-e16/stubs': line(100, 200) }, [line(110, 150)]);
    expect(message).toContain('p50 100 → 110 (+10 %)');
    expect(message).toContain('p95 200 → 150 (-25 %)');
    expect(describeChanges({}, [line(1, 2)])).toEqual([]);
  });

  it('counts calls of functions that still exist under their names', () => {
    expect(ALL_COUNTERS.filter((spec) => !declared(spec)).map((spec) => `${spec.file} ${spec.fn}`)).toEqual([]);
  });
});
