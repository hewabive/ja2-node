import { appendFileSync } from 'node:fs';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { compareWithBaseline, saveBaseline } from './baseline.ts';
import { openBenchData } from './data.ts';
import type { BenchContext, BenchLine } from './measure.ts';
import { autoresolve } from './scenarios/autoresolve.ts';
import { CAMPAIGN_SEED, campaign } from './scenarios/campaign.ts';
import { ENEMY_TURN, ENEMY_TURN_SEED, enemyTurn } from './scenarios/enemy-turn.ts';
import { realtime } from './scenarios/realtime.ts';
import { save } from './scenarios/save.ts';
import { server } from './scenarios/server.ts';
import { strategic } from './scenarios/strategic.ts';

export interface BenchArgs {
  readonly scenario: string | undefined;
  readonly data: string | undefined;
  readonly seed: string | undefined;
  readonly runs: string | undefined;
  readonly profile: boolean | undefined;
  readonly calls: boolean | undefined;
  readonly variant: string | undefined;
  readonly out: string | undefined;
  readonly saveBaseline: boolean | undefined;
}

interface Scenario {
  readonly run: (ctx: BenchContext) => Promise<void>;
  readonly seed: number;
}

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  [ENEMY_TURN]: { run: enemyTurn, seed: ENEMY_TURN_SEED },
  realtime: { run: realtime, seed: 1 },
  strategic: { run: strategic, seed: 1 },
  autoresolve: { run: autoresolve, seed: 1 },
  server: { run: server, seed: ENEMY_TURN_SEED },
  campaign: { run: campaign, seed: CAMPAIGN_SEED },
  save: { run: save, seed: 1 },
};

export const BENCH_USAGE = `usage: pnpm cli bench <scenario|all> [--data DIR] [--seed N] [--runs N] [--variant NAME] [--profile] [--calls]
                       [--out FILE] [--save-baseline]

  scenarios: ${Object.keys(SCENARIOS).join(', ')}
  Prints one JSON line per scenario variant on stdout and a summary on stderr.
  --data DIR       original data (default $JA2_DATA_DIR; --data '' for stubs only)
  --seed N         seed for every scenario (default: each scenario's own fixed seed)
  --runs N         timed repetitions (default 3); with 2 or more an untimed warm-up run comes first
  --variant NAME   run one variant only (for example arena-e16)
  --profile        write a .cpuprofile per variant under .cache/bench/ and print the hottest frames
  --calls          one extra instrumented run per variant: exact call counts of the AI, path, sight and cover functions
  --out FILE       also append the JSON lines to FILE
  --save-baseline  store this run as .cache/bench/baseline.json; without it, lines are compared with the baseline`;

const DEFAULT_RUNS = 3;
const GIB = 1024 ** 3;

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
}

export function machineSummary(): string {
  const cpu = cpus()[0]?.model.trim() ?? 'unknown CPU';
  return `${cpu}, ${availableParallelism()} threads, ${Math.round(totalmem() / GIB)} GiB, Node ${process.version}`;
}

function summarize(line: BenchLine): string {
  if (line.pending) return `${line.scenario}: pending (${line.pending})`;
  const target = line.target
    ? ` target ${line.target.stat} ≤ ${line.target.value}${line.target.ok ? '' : ` SANITY BOUND ${line.target.bound} EXCEEDED`}`
    : '';
  const info = line.info ? ` ${JSON.stringify(line.info)}` : '';
  return `${line.scenario} ${line.variant} [${line.source}] ${line.metric}: p50 ${line.p50} p95 ${line.p95} max ${line.max} ${line.unit} (n=${line.n}, mean ${line.mean})${target}${info}`;
}

export async function runBench(args: BenchArgs): Promise<number> {
  const name = args.scenario;
  if (!name || (name !== 'all' && !SCENARIOS[name])) {
    console.error(BENCH_USAGE);
    return 1;
  }
  const dataDir = args.data ?? process.env.JA2_DATA_DIR;
  const data = await openBenchData({ dataDir: dataDir || undefined });
  const lines: BenchLine[] = [];
  const seed = args.seed === undefined ? null : positiveInt(args.seed, 0, 'seed');
  const ctx: BenchContext = {
    data,
    seed: seed ?? 0,
    runs: Math.max(1, positiveInt(args.runs, DEFAULT_RUNS, 'runs')),
    profile: args.profile ?? false,
    calls: args.calls ?? false,
    variant: args.variant ?? null,
    log: (message) => console.error(message),
    emit: (line) => {
      lines.push(line);
      console.log(JSON.stringify(line));
      if (args.out) appendFileSync(args.out, `${JSON.stringify(line)}\n`);
      console.error(summarize(line));
      for (const h of line.hot ?? []) console.error(`    ${String(h.selfPercent).padStart(5)} %  ${h.frame}`);
    },
  };
  console.error(`bench: ${data.source} data, seed ${seed ?? 'per scenario'}, ${ctx.runs} run(s); ${machineSummary()}`);
  try {
    for (const [scenario, s] of Object.entries(SCENARIOS))
      if (name === 'all' || name === scenario) await s.run({ ...ctx, seed: seed ?? s.seed });
  } finally {
    await data.close();
  }
  if (args.saveBaseline) console.error(`baseline saved: ${await saveBaseline(lines)}`);
  else for (const message of await compareWithBaseline(lines)) console.error(message);
  const failed = lines.filter((l) => l.target && !l.target.ok);
  for (const l of failed)
    console.error(`FAIL ${l.scenario} ${l.variant}: ${l.target?.stat} above the sanity bound ${l.target?.bound} ${l.unit}`);
  return failed.length > 0 ? 1 : 0;
}
