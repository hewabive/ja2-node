import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { join, relative } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';

export interface CounterSpec {
  readonly name: string;
  readonly file: string;
  readonly fn: string;
}

export const TACTICAL_COUNTERS: readonly CounterSpec[] = [
  { name: 'aiDecisions', file: 'src/sim/tactical/ai/control.ts', fn: 'decideNpcAction' },
  { name: 'pathSearches', file: 'src/sim/tactical/pathfinding.ts', fn: 'findBestPath' },
  { name: 'losTests', file: 'src/sim/tactical/perception/los.ts', fn: 'lineOfSightTest' },
  { name: 'sightChecks', file: 'src/sim/tactical/perception/sight.ts', fn: 'manLooksForMan' },
  { name: 'ctgtTraces', file: 'src/sim/tactical/combat/bullets.ts', fn: 'calcChanceToGetThrough' },
  { name: 'coverSearches', file: 'src/sim/tactical/ai/cover.ts', fn: 'findBestNearbyCover' },
  { name: 'coverTiles', file: 'src/sim/tactical/ai/cover.ts', fn: 'coverAt' },
];

export const STRATEGIC_COUNTERS: readonly CounterSpec[] = [
  { name: 'strategicEvents', file: 'src/sim/strategic/time/dispatch.ts', fn: 'execute' },
  { name: 'groupArrivals', file: 'src/sim/strategic/forces/movement.ts', fn: 'groupArrivedAtSector' },
  { name: 'queenDecisions', file: 'src/sim/strategic/ai/evaluate.ts', fn: 'evaluateQueenSituation' },
  { name: 'autoresolveBattles', file: 'src/sim/strategic/forces/autoresolve/setup.ts', fn: 'enterAutoresolve' },
];

export const AUTORESOLVE_COUNTERS: readonly CounterSpec[] = [
  { name: 'cellTurns', file: 'src/sim/strategic/forces/autoresolve/loop.ts', fn: 'processCell' },
  { name: 'attacks', file: 'src/sim/strategic/forces/autoresolve/attack.ts', fn: 'attackTarget' },
];

interface CoverageRange {
  readonly count: number;
}

interface CoverageFunction {
  readonly functionName: string;
  readonly ranges: readonly CoverageRange[];
}

interface CoverageScript {
  readonly url: string;
  readonly functions: readonly CoverageFunction[];
}

interface CallFrame {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: CallFrame;
  readonly hitCount?: number;
}

export interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly startTime: number;
  readonly endTime: number;
  readonly samples?: readonly number[];
}

export interface HotFrame {
  readonly frame: string;
  readonly selfPercent: number;
}

const PROFILE_DIR = join(REPO_ROOT, '.cache', 'bench');
const SAMPLING_INTERVAL_US = 200;
const HOT_FRAMES = 12;
const PERCENT = 100;

function scriptPath(url: string): string {
  const path = url.startsWith('file://') ? decodeURIComponent(new URL(url).pathname) : url;
  return relative(REPO_ROOT, path).split('\\').join('/');
}

let shared: Session | null = null;

function inspector(): Session {
  if (!shared) {
    shared = new Session();
    shared.connect();
  }
  return shared;
}

export async function countCalls<T>(
  specs: readonly CounterSpec[],
  work: () => Promise<T>,
): Promise<{ result: T; counts: Record<string, number> }> {
  const s = inspector();
  await s.post('Profiler.enable');
  await s.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
  await s.post('Profiler.takePreciseCoverage');
  try {
    const result = await work();
    const taken = (await s.post('Profiler.takePreciseCoverage')) as { result: CoverageScript[] };
    return { result, counts: tally(specs, taken.result) };
  } finally {
    await s.post('Profiler.stopPreciseCoverage');
  }
}

export const ALL_COUNTERS: readonly CounterSpec[] = [...TACTICAL_COUNTERS, ...STRATEGIC_COUNTERS, ...AUTORESOLVE_COUNTERS];

export function declared(spec: CounterSpec): boolean {
  const file = join(REPO_ROOT, spec.file);
  return existsSync(file) && new RegExp(`\\b${spec.fn}\\s*\\(`).test(readFileSync(file, 'utf8'));
}

function tally(specs: readonly CounterSpec[], scripts: readonly CoverageScript[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const missing: string[] = [];
  for (const spec of specs) {
    const script = scripts.find((sc) => scriptPath(sc.url) === spec.file);
    const fns = script?.functions.filter((f) => f.functionName === spec.fn) ?? [];
    if (fns.length === 0 && !declared(spec)) {
      missing.push(`${spec.file} ${spec.fn}`);
      continue;
    }
    counts[spec.name] = fns.reduce((a, f) => a + (f.ranges[0]?.count ?? 0), 0);
  }
  if (missing.length > 0) throw new Error(`bench counters: functions not found (renamed or not loaded): ${missing.join(', ')}`);
  return counts;
}

export async function profileCpu<T>(work: () => Promise<T>): Promise<{ result: T; profile: CpuProfile }> {
  const s = inspector();
  await s.post('Profiler.enable');
  await s.post('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US });
  await s.post('Profiler.start');
  let stopped = false;
  try {
    const result = await work();
    const { profile } = (await s.post('Profiler.stop')) as { profile: CpuProfile };
    stopped = true;
    return { result, profile };
  } finally {
    if (!stopped) await s.post('Profiler.stop');
  }
}

export async function writeProfile(name: string, profile: CpuProfile): Promise<string> {
  await mkdir(PROFILE_DIR, { recursive: true });
  const file = join(PROFILE_DIR, `${name}.cpuprofile`);
  await writeFile(file, JSON.stringify(profile));
  return relative(REPO_ROOT, file);
}

function frameName(f: CallFrame): string {
  const where = f.url ? `${scriptPath(f.url)}:${f.lineNumber + 1}` : '(native)';
  return `${f.functionName || '(anonymous)'} ${where}`;
}

export function hotFrames(profile: CpuProfile, limit = HOT_FRAMES): HotFrame[] {
  const self = new Map<string, number>();
  let total = 0;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const hits = new Map<number, number>();
  if (profile.samples) for (const id of profile.samples) hits.set(id, (hits.get(id) ?? 0) + 1);
  else for (const n of profile.nodes) hits.set(n.id, n.hitCount ?? 0);
  for (const [id, count] of hits) {
    const node = byId.get(id);
    if (!node || node.callFrame.functionName === '(idle)') continue;
    const key = frameName(node.callFrame);
    self.set(key, (self.get(key) ?? 0) + count);
    total += count;
  }
  return [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([frame, count]) => ({ frame, selfPercent: total > 0 ? Math.round((count * PERCENT * 10) / total) / 10 : 0 }));
}
