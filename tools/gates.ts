import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from '../src/node/repo.ts';

export const GATES = ['check', 'data', 'reload', 'oracle', 'e2e', 'e2e:data', 'e2e:browsers'] as const;
export type Gate = (typeof GATES)[number];

interface Area {
  readonly paths: readonly string[];
  readonly gates: readonly Gate[];
}

const SIMULATION: readonly Gate[] = ['check', 'data', 'reload', 'oracle', 'e2e', 'e2e:data'];
const SERVER: readonly Gate[] = ['check', 'data', 'reload', 'e2e', 'e2e:data'];
const CLIENT: readonly Gate[] = ['check', 'data', 'e2e', 'e2e:data'];
const PRESENTATION: readonly Gate[] = ['check', 'e2e', 'e2e:data', 'e2e:browsers'];

const AREAS: readonly Area[] = [
  { paths: ['docs/', 'README.md', 'CLAUDE.md', 'LICENSE', '.github/', '.gitignore'], gates: [] },
  { paths: ['src/core/', 'src/content/', 'src/sim/', 'src/node/', 'src/server/', 'data/'], gates: SIMULATION },
  { paths: ['src/protocol/', 'stubs/'], gates: SERVER },
  { paths: ['src/ui/', 'src/render/', 'src/audio/', 'src/app/'], gates: CLIENT },
  {
    paths: [
      'src/app/game/game-page.ts',
      'src/app/game/dom-input.ts',
      'src/app/game/main.ts',
      'src/app/game/index.html',
      'src/app/game/style.css',
      'src/render/ui-draw/logical-framebuffer.ts',
      'src/ui/resolution.ts',
      'vite.config.ts',
      'tools/dev.ts',
    ],
    gates: PRESENTATION,
  },
  { paths: ['index.html'], gates: ['check', 'e2e'] },
  { paths: ['src/devtools/', 'tools/campaign-bot/'], gates: ['check', 'e2e'] },
  { paths: ['tests/support/'], gates: ['check', 'data', 'reload', 'e2e'] },
  { paths: ['vitest.config.ts'], gates: ['check', 'data', 'reload'] },
  { paths: ['tests/e2e/'], gates: ['check', 'e2e', 'e2e:data'] },
  { paths: ['tests/e2e/env.ts'], gates: ['e2e:browsers'] },
  { paths: ['playwright.config.ts'], gates: ['check', 'e2e'] },
  { paths: ['tests/e2e-data/', 'playwright.data.config.ts'], gates: ['check', 'e2e:data'] },
  { paths: ['tests/e2e-browsers/', 'playwright.browsers.config.ts'], gates: ['check', 'e2e:browsers'] },
  { paths: ['tools/oracle/'], gates: ['check', 'oracle'] },
  { paths: ['tools/', 'package.json', 'biome.json', 'tsconfig.json', 'tsconfig.base.json', 'tests/tsconfig.json'], gates: ['check'] },
  { paths: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'], gates: GATES },
];

const UNIT_TEST = /\.test\.ts$/;
const UNIT_GATES: readonly Gate[] = ['check', 'data', 'reload'];
const BROWSER_SPEC = /\.spec\.ts$/;
const GOLDENS = 'tests/e2e/golden/';
const SUITES: readonly (readonly [string, Gate])[] = [
  ['tests/e2e/', 'e2e'],
  ['tests/e2e-data/', 'e2e:data'],
  ['tests/e2e-browsers/', 'e2e:browsers'],
];

function inArea(path: string, area: Area): boolean {
  return area.paths.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
}

function gatesOfPath(path: string): readonly Gate[] {
  if (UNIT_TEST.test(path)) return UNIT_GATES;
  if (path.startsWith(GOLDENS)) return ['e2e'];
  const suite = SUITES.find(([dir]) => path.startsWith(dir));
  if (suite && BROWSER_SPEC.test(path)) return ['check', suite[1]];
  const areas = AREAS.filter((a) => inArea(path, a));
  return areas.length === 0 ? GATES : areas.flatMap((a) => a.gates);
}

export function gatesFor(paths: readonly string[]): Map<Gate, string> {
  const because = new Map<Gate, string>();
  for (const path of paths) for (const gate of gatesOfPath(path)) if (!because.has(gate)) because.set(gate, path);
  return new Map(GATES.filter((g) => because.has(g)).map((g) => [g, because.get(g) ?? '']));
}

interface GateRun {
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

const WITHOUT_ORIGINAL_DATA = { JA2_DATA_DIR: '' };

function onPath(program: string, env: NodeJS.ProcessEnv): boolean {
  return (env.PATH ?? '').split(delimiter).some((dir) => dir !== '' && existsSync(join(dir, program)));
}

function gateRun(gate: Gate, env: NodeJS.ProcessEnv): GateRun | string {
  const dataDir = env.JA2_DATA_DIR ?? '';
  const oracleDir = env.JA2_ORACLE_DIR ?? join(homedir(), 'ja2-oracle');
  switch (gate) {
    case 'check':
      return { command: ['pnpm', 'check'], env: WITHOUT_ORIGINAL_DATA };
    case 'data':
      return dataDir ? { command: ['pnpm', 'test:data'], env: {} } : 'needs JA2_DATA_DIR';
    case 'reload':
      return { command: ['pnpm', 'test:reload'], env: WITHOUT_ORIGINAL_DATA };
    case 'oracle':
      if (!dataDir) return 'needs JA2_DATA_DIR';
      return existsSync(oracleDir) ? { command: ['tools/oracle/compare-all.sh'], env: {} } : `needs the oracle probes in ${oracleDir}`;
    case 'e2e':
      return { command: ['pnpm', 'e2e'], env: {} };
    case 'e2e:data': {
      const e2eDataDir = env.JA2_E2E_DATA_DIR ?? dataDir;
      return e2eDataDir ? { command: ['pnpm', 'e2e:data'], env: { JA2_E2E_DATA_DIR: e2eDataDir } } : 'needs JA2_DATA_DIR';
    }
    case 'e2e:browsers':
      if (env.DISPLAY) return { command: ['pnpm', 'e2e:browsers'], env: {} };
      return onPath('xvfb-run', env)
        ? { command: ['xvfb-run', '-a', 'pnpm', 'e2e:browsers'], env: {} }
        : 'needs a display for Firefox (DISPLAY or xvfb-run)';
  }
}

function git(...args: string[]): string[] {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

function defaultBase(): string {
  try {
    return git('merge-base', 'HEAD', '@{upstream}')[0] ?? 'HEAD';
  } catch {
    return 'HEAD';
  }
}

function changedSince(base: string): string[] {
  return [...new Set([...git('diff', '--name-only', '--no-renames', base), ...git('ls-files', '--others', '--exclude-standard')])].sort();
}

const LOG_DIR = join(REPO_ROOT, '.cache', 'gates');
const FAILURE_TAIL_LINES = 40;

function runLogged(run: GateRun, log: string): Promise<number> {
  const fd = openSync(log, 'w');
  const [program = '', ...args] = run.command;
  return new Promise<number>((done) => {
    const child = spawn(program, args, { cwd: REPO_ROOT, env: { ...process.env, ...run.env }, stdio: ['ignore', fd, fd] });
    child.on('error', () => done(-1));
    child.on('exit', (code) => done(code ?? -1));
  }).finally(() => closeSync(fd));
}

function tail(log: string): string {
  return readFileSync(log, 'utf8').trimEnd().split('\n').slice(-FAILURE_TAIL_LINES).join('\n');
}

const USAGE = `usage: pnpm gates [gate ...] [--all] [--since REV] [--list | --plan] [--keep-going]

Runs the gates that the files changed since REV can affect (default: the merge base with the upstream branch,
so commits not pushed yet count, plus the working tree and untracked files). Named gates or --all run regardless.
Gates: ${GATES.join(', ')}. data, oracle and e2e:data need JA2_DATA_DIR; e2e:browsers needs DISPLAY or xvfb-run.
Each gate writes its output to ${relative(REPO_ROOT, LOG_DIR)}/<gate>.log. --list shows the plan with the file that
selected each gate, --plan prints only the gate names (for CI), and neither runs anything.`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      since: { type: 'string' },
      list: { type: 'boolean', default: false },
      plan: { type: 'boolean', default: false },
      'keep-going': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const unknown = positionals.filter((p) => !(GATES as readonly string[]).includes(p));
  if (unknown.length > 0) {
    console.error(`unknown gate ${unknown.join(', ')}\n\n${USAGE}`);
    return 2;
  }
  let plan: Map<Gate, string>;
  let origin: string;
  if (values.all || positionals.length > 0) {
    const wanted = values.all ? GATES : GATES.filter((g) => positionals.includes(g));
    plan = new Map(wanted.map((g) => [g, values.all ? '--all' : 'named']));
    origin = values.all ? 'every gate' : 'the named gates';
  } else {
    const base = values.since ?? defaultBase();
    const changed = changedSince(base);
    plan = gatesFor(changed);
    origin = `${changed.length} file(s) changed since ${base.slice(0, 12)}`;
  }
  if (values.plan) {
    for (const gate of plan.keys()) console.log(gate);
    return 0;
  }
  console.log(origin);
  if (plan.size === 0) {
    console.log('no gate to run');
    return 0;
  }
  for (const [gate, why] of plan) console.log(`  ${gate.padEnd(13)} ${why}`);
  if (values.list) return 0;
  await mkdir(LOG_DIR, { recursive: true });
  let failed = 0;
  for (const gate of plan.keys()) {
    const run = gateRun(gate, process.env);
    if (typeof run === 'string') {
      console.log(`${gate.padEnd(13)} skipped: ${run}`);
      continue;
    }
    const log = join(LOG_DIR, `${gate.replace(':', '-')}.log`);
    const started = performance.now();
    const code = await runLogged(run, log);
    const seconds = ((performance.now() - started) / 1000).toFixed(0);
    if (code === 0) {
      console.log(`${gate.padEnd(13)} ok in ${seconds} s`);
      continue;
    }
    failed++;
    console.log(`${gate.padEnd(13)} FAILED in ${seconds} s (exit ${code}), ${relative(REPO_ROOT, log)}:\n${tail(log)}`);
    if (!values['keep-going']) break;
  }
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main();
