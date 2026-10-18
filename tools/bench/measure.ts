import { loadavg } from 'node:os';
import type { BenchData, DataSource } from './data.ts';
import { type CounterSpec, countCalls, type HotFrame, hotFrames, profileCpu, writeProfile } from './inspector.ts';
import { runIsolated } from './isolate.ts';
import { type Distribution, distribution, round, sum } from './stats.ts';

export interface BenchContext {
  readonly data: BenchData;
  readonly seed: number;
  readonly runs: number;
  readonly profile: boolean;
  readonly calls: boolean;
  readonly variant: string | null;
  readonly isolate: boolean;
  log(message: string): void;
  emit(line: BenchLine): void;
}

export interface VariantRun {
  readonly samples: readonly number[];
  readonly series?: Readonly<Record<string, readonly number[]>>;
  readonly counters?: Readonly<Record<string, number>>;
  readonly work?: Readonly<Record<string, number>>;
  readonly info?: Readonly<Record<string, unknown>>;
}

export interface VariantSpec<S> {
  readonly variant: string;
  readonly metric: string;
  readonly unit: string;
  readonly target?: number;
  readonly targetStat?: 'p95' | 'mean' | 'p99';
  readonly calls?: readonly CounterSpec[];
  readonly perSample?: boolean;
  readonly inProcess?: boolean;
  setup(): Promise<S>;
  run(state: S): Promise<VariantRun> | VariantRun;
  dispose?(state: S): Promise<void> | void;
}

export interface BenchLine {
  readonly scenario: string;
  readonly variant: string;
  readonly source: DataSource;
  readonly seed: number;
  readonly runs: number;
  readonly warmup?: boolean;
  readonly load?: readonly [number, number];
  readonly deterministic?: boolean;
  readonly metric: string;
  readonly unit: string;
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly target?: { readonly stat: string; readonly value: number; readonly bound: number; readonly ok: boolean };
  readonly series: Readonly<Record<string, Distribution>>;
  readonly counters: Readonly<Record<string, number>>;
  readonly calls?: Readonly<Record<string, number>>;
  readonly callsPerSample?: Readonly<Record<string, number>>;
  readonly info?: Readonly<Record<string, unknown>>;
  readonly profile?: string;
  readonly hot?: readonly HotFrame[];
  readonly pending?: string;
}

export const SANITY_FACTOR = 10;

function loadAverage(): number {
  return round(loadavg()[0] ?? 0, 2);
}

export function pendingLine(ctx: BenchContext, scenario: string, message: string): BenchLine {
  return {
    scenario,
    variant: '-',
    source: ctx.data.source,
    seed: ctx.seed,
    runs: 0,
    metric: '-',
    unit: '-',
    n: 0,
    mean: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0,
    series: {},
    counters: {},
    pending: message,
  };
}

function mergeSeries(runs: readonly VariantRun[]): Record<string, Distribution> {
  const names = new Set(runs.flatMap((r) => Object.keys(r.series ?? {})));
  const out: Record<string, Distribution> = {};
  for (const name of names) out[name] = distribution(runs.flatMap((r) => [...(r.series?.[name] ?? [])]));
  return out;
}

function sameWork(runs: readonly VariantRun[]): boolean | undefined {
  const first = runs[0];
  if (!first?.work || runs.length < 2) return undefined;
  const signature = JSON.stringify(first.work);
  return runs.every((r) => JSON.stringify(r.work) === signature);
}

function firstCounters(runs: readonly VariantRun[]): Record<string, number> {
  return { ...(runs[0]?.counters ?? {}) };
}

function perSample(calls: Record<string, number>, samples: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(calls)) out[k] = samples > 0 ? round(v / samples, 1) : 0;
  return out;
}

export async function measure<S>(ctx: BenchContext, scenario: string, spec: VariantSpec<S>): Promise<void> {
  if (ctx.variant !== null && ctx.variant !== spec.variant) return;
  if (ctx.isolate) {
    const { data, seed, runs, profile, calls } = ctx;
    ctx.emit(await runIsolated({ scenario, variant: spec.variant, seed, runs, dataDir: data.dataDir, profile, calls }));
    return;
  }
  const loadBefore = loadAverage();
  const runs: VariantRun[] = [];
  const warmup = ctx.runs > 1 && (spec.inProcess ?? true);
  for (let r = warmup ? -1 : 0; r < ctx.runs; r++) {
    const state = await spec.setup();
    try {
      const result = await spec.run(state);
      if (r >= 0) runs.push(result);
    } finally {
      await spec.dispose?.(state);
    }
  }
  const primary = distribution(runs.flatMap((r) => [...r.samples]));
  const deterministic = sameWork(runs);
  const name = `${scenario}-${spec.variant}-${ctx.data.source}`;
  let profile: { path: string; hot: HotFrame[] } | null = null;
  const inProcess = spec.inProcess ?? true;
  if (ctx.profile && inProcess) {
    const state = await spec.setup();
    try {
      const profiled = await profileCpu(async () => spec.run(state));
      profile = { path: await writeProfile(name, profiled.profile), hot: hotFrames(profiled.profile) };
    } finally {
      await spec.dispose?.(state);
    }
  }
  let calls: Record<string, number> | null = null;
  let callSamples = 0;
  if (ctx.calls && spec.calls && inProcess) {
    const state = await spec.setup();
    try {
      const counted = await countCalls(spec.calls, async () => spec.run(state));
      calls = counted.counts;
      callSamples = counted.result.samples.length;
    } finally {
      await spec.dispose?.(state);
    }
  }
  const stat = spec.targetStat ?? 'p95';
  const value = primary[stat];
  const target =
    spec.target !== undefined
      ? { stat, value: spec.target, bound: spec.target * SANITY_FACTOR, ok: value <= spec.target * SANITY_FACTOR }
      : undefined;
  ctx.emit({
    scenario,
    variant: spec.variant,
    source: ctx.data.source,
    seed: ctx.seed,
    runs: ctx.runs,
    warmup,
    load: [loadBefore, loadAverage()],
    ...(deterministic !== undefined ? { deterministic } : {}),
    metric: spec.metric,
    unit: spec.unit,
    n: primary.n,
    mean: primary.mean,
    p50: primary.p50,
    p95: primary.p95,
    p99: primary.p99,
    max: primary.max,
    ...(target ? { target } : {}),
    series: mergeSeries(runs),
    counters: firstCounters(runs),
    ...(calls ? { calls, ...(spec.perSample ? { callsPerSample: perSample(calls, callSamples) } : {}) } : {}),
    ...(runs[0]?.info ? { info: runs[0].info } : {}),
    ...(profile ? { profile: profile.path, hot: profile.hot } : {}),
  });
}

export function totalOf(values: readonly number[]): number {
  return round(sum(values), 3);
}
