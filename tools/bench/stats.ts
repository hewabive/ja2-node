export interface Distribution {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

const EMPTY: Distribution = { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0;
}

export function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function distribution(samples: readonly number[], digits = 3): Distribution {
  if (samples.length === 0) return EMPTY;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: round(sum / sorted.length, digits),
    p50: round(percentile(sorted, 50), digits),
    p95: round(percentile(sorted, 95), digits),
    p99: round(percentile(sorted, 99), digits),
    max: round(sorted[sorted.length - 1] ?? 0, digits),
  };
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
