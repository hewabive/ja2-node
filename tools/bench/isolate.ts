import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import type { BenchLine } from './measure.ts';

export const ISOLATED_ENV = 'JA2_BENCH_ISOLATED';

const CLI = join(REPO_ROOT, 'tools', 'cli.ts');
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const STDERR_TAIL_LINES = 12;

export interface IsolatedRequest {
  readonly scenario: string;
  readonly variant: string;
  readonly seed: number;
  readonly runs: number;
  readonly dataDir: string | null;
  readonly profile: boolean;
  readonly calls: boolean;
}

export function isolatedChild(): boolean {
  return process.env[ISOLATED_ENV] === '1';
}

function argsOf(r: IsolatedRequest): string[] {
  return [
    CLI,
    'bench',
    r.scenario,
    '--variant',
    r.variant,
    '--seed',
    String(r.seed),
    '--runs',
    String(r.runs),
    '--data',
    r.dataDir ?? '',
    ...(r.profile ? ['--profile'] : []),
    ...(r.calls ? ['--calls'] : []),
  ];
}

function lineFrom(stdout: string, r: IsolatedRequest): BenchLine | null {
  for (const text of stdout.split('\n')) {
    if (!text.startsWith('{')) continue;
    const line = JSON.parse(text) as BenchLine;
    if (line.scenario === r.scenario && line.variant === r.variant) return line;
  }
  return null;
}

export function runIsolated(r: IsolatedRequest): Promise<BenchLine> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, [ISOLATED_ENV]: '1' };
    execFile(process.execPath, argsOf(r), { env, maxBuffer: MAX_OUTPUT_BYTES }, (_error, stdout, stderr) => {
      const line = lineFrom(String(stdout), r);
      if (line) return resolve(line);
      const tail = String(stderr).trim().split('\n').slice(-STDERR_TAIL_LINES).join('\n');
      reject(new Error(`bench: ${r.scenario} ${r.variant} failed in its child process:\n${tail}`));
    });
  });
}
