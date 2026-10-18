import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import type { BenchLine } from './measure.ts';
import { round } from './stats.ts';

export const BASELINE_FILE = join(REPO_ROOT, '.cache', 'bench', 'baseline.json');

const COMPARED = ['p50', 'p95', 'max', 'mean'] as const;
const PERCENT = 100;

export function lineKey(line: Pick<BenchLine, 'scenario' | 'variant' | 'source'>): string {
  return `${line.scenario}/${line.variant}/${line.source}`;
}

function change(before: number, after: number): string {
  if (before === 0) return after === 0 ? '±0 %' : 'new';
  const pct = round(((after - before) * PERCENT) / before, 1);
  return `${pct > 0 ? '+' : ''}${pct} %`;
}

export function describeChanges(baseline: Readonly<Record<string, BenchLine>>, lines: readonly BenchLine[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.pending) continue;
    const before = baseline[lineKey(line)];
    if (!before) continue;
    const metrics = COMPARED.map((m) => `${m} ${before[m]} → ${line[m]} (${change(before[m], line[m])})`);
    const counters = Object.entries(line.calls ?? {})
      .filter(([k]) => before.calls?.[k] !== undefined)
      .map(([k, v]) => `${k} ${change(before.calls?.[k] ?? 0, v)}`);
    out.push(`vs baseline ${lineKey(line)} ${line.unit}: ${[...metrics, ...counters].join(', ')}`);
  }
  return out;
}

export async function loadBaseline(): Promise<Record<string, BenchLine>> {
  if (!existsSync(BASELINE_FILE)) return {};
  return JSON.parse(await readFile(BASELINE_FILE, 'utf8')) as Record<string, BenchLine>;
}

export async function compareWithBaseline(lines: readonly BenchLine[]): Promise<string[]> {
  return describeChanges(await loadBaseline(), lines);
}

export async function saveBaseline(lines: readonly BenchLine[]): Promise<string> {
  const merged = await loadBaseline();
  for (const line of lines) if (!line.pending) merged[lineKey(line)] = line;
  await mkdir(dirname(BASELINE_FILE), { recursive: true });
  await writeFile(BASELINE_FILE, `${JSON.stringify(merged, null, 2)}\n`);
  return relative(REPO_ROOT, BASELINE_FILE);
}
