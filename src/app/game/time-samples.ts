export interface TimeSummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

const KEPT_SAMPLES = 2048;

export class TimeSamples {
  readonly #samples: number[] = [];

  add(ms: number): void {
    this.#samples.push(ms);
    if (this.#samples.length > KEPT_SAMPLES) this.#samples.shift();
  }

  reset(): void {
    this.#samples.length = 0;
  }

  summary(): TimeSummary {
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
    return { count: sorted.length, p50: at(50), p95: at(95), max: sorted[sorted.length - 1] ?? 0 };
  }
}
