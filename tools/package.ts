import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { DEFAULT_STUBS_DIR, REPO_ROOT } from '../src/node/repo.ts';
import { TOKEN_ENV } from '../src/node/token.ts';
import { DATA_VERSION_ENV } from '../src/server/data-version.ts';
import {
  bundleFile,
  ENGINE_FILE,
  PACKAGE_CLIENT_DIR,
  PACKAGE_DATA_DIR,
  PACKAGE_SERVER_DIR,
  PACKAGE_STUBS_DIR,
  PLAYER_BUNDLE,
  SESSION_WORKER_BUNDLE,
} from '../src/server/package-layout.ts';
import { PLAYER_HOME_ENV } from '../src/server/player/dirs.ts';
import { SESSION_HOST_ENV } from '../src/server/session-host.ts';
import { DATA_DIR_ENV, HOST_ENV, PORT_ENV } from '../src/server/start.ts';
import { STUB_LICENSE_FILE, STUB_NOTICE_FILE } from '../stubs/build.ts';
import { ensureStubPack } from '../stubs/ensure.ts';
import { freePort } from './campaign-bot/stub-server.ts';

export const PACKAGE_OUT_DIR = join(REPO_ROOT, 'dist', 'package');
const TARBALL_PREFIX = 'package/';
const TARBALL_EXTENSION = '.tgz';
const BIN_FILE = 'bin/ja2-node.js';
const ROOT_FILES: ReadonlySet<string> = new Set(['package.json', 'README.md', 'LICENSE']);
const PACKED_DIRS = ['bin/', `${PACKAGE_DATA_DIR}/`, `${PACKAGE_CLIENT_DIR}/`, `${PACKAGE_SERVER_DIR}/`, `${PACKAGE_STUBS_DIR}/`];
const REQUIRED_FILES = [
  BIN_FILE,
  `${PACKAGE_SERVER_DIR}/${bundleFile(PLAYER_BUNDLE)}`,
  `${PACKAGE_SERVER_DIR}/${bundleFile(SESSION_WORKER_BUNDLE)}`,
  `${PACKAGE_SERVER_DIR}/${ENGINE_FILE}`,
  `${PACKAGE_CLIENT_DIR}/index.html`,
  `${PACKAGE_STUBS_DIR}/${STUB_LICENSE_FILE}`,
  `${PACKAGE_STUBS_DIR}/${STUB_NOTICE_FILE}`,
  'LICENSE',
];
const LOCATION_DEPENDENT = /\bimport\.meta\b/;
const BUNDLE_EXTENSION = /\.js$/;
const HEALTH_POLL_MS = 200;
const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 20_000;
const SANDBOX_SESSION = 'sandbox';
const SMOKE_HOST_KINDS = ['inprocess', 'worker'] as const;
const CLEARED_ENV = [DATA_VERSION_ENV, HOST_ENV, PORT_ENV, 'JA2_SAVE_DIR', 'JA2_CACHE_DIR', 'JA2_SAVES_DIR', 'JA2_SAVE', 'JA2_CAMPAIGN'];

export function packageProblems(entries: readonly string[], trackedData: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const present = new Set(entries);
  for (const entry of entries) {
    if (!ROOT_FILES.has(entry) && !PACKED_DIRS.some((dir) => entry.startsWith(dir)))
      problems.push(`${entry}: not a file the package ships`);
    if (entry.startsWith(`${PACKAGE_DATA_DIR}/`) && !trackedData.has(entry)) problems.push(`${entry}: not tracked by git`);
  }
  for (const file of REQUIRED_FILES) if (!present.has(file)) problems.push(`${file}: missing`);
  return problems;
}

export function relocationProblems(bundles: readonly { readonly path: string; readonly text: string }[]): string[] {
  return bundles
    .filter((bundle) => LOCATION_DEPENDENT.test(bundle.text))
    .map((bundle) => `${bundle.path}: uses import.meta, so the server would depend on where its files lie`);
}

function run(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync(command, [...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function runVisibly(command: string, args: readonly string[]): void {
  execFileSync(command, [...args], { cwd: REPO_ROOT, stdio: 'inherit' });
}

export async function buildPackageFiles(): Promise<void> {
  const rebuilt = await ensureStubPack(DEFAULT_STUBS_DIR, () => console.log('[package] building the stub pack…'));
  if (!rebuilt) console.log('[package] the stub pack is up to date');
  runVisibly('pnpm', ['build']);
  runVisibly('pnpm', ['build:server']);
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

async function packTarball(): Promise<string> {
  await rm(PACKAGE_OUT_DIR, { recursive: true, force: true });
  await mkdir(PACKAGE_OUT_DIR, { recursive: true });
  run('pnpm', ['pack', '--pack-destination', PACKAGE_OUT_DIR]);
  const tarballs = (await readdir(PACKAGE_OUT_DIR)).filter((name) => name.endsWith(TARBALL_EXTENSION));
  if (tarballs.length !== 1) throw new Error(`expected one tarball in ${PACKAGE_OUT_DIR}, found ${tarballs.length}`);
  return join(PACKAGE_OUT_DIR, tarballs[0] as string);
}

function tarballEntries(tarball: string): string[] {
  return run('tar', ['-tzf', tarball])
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('/'))
    .map((line) => (line.startsWith(TARBALL_PREFIX) ? line.slice(TARBALL_PREFIX.length) : line));
}

function trackedDataFiles(): Set<string> {
  return new Set(run('git', ['ls-files', '-z', '--', PACKAGE_DATA_DIR]).split('\0').filter(Boolean));
}

async function bundleTexts(): Promise<{ path: string; text: string }[]> {
  const dir = join(REPO_ROOT, PACKAGE_SERVER_DIR);
  const files = (await filesUnder(dir)).filter((file) => BUNDLE_EXTENSION.test(file));
  return Promise.all(
    files.map(async (file) => ({ path: relative(REPO_ROOT, file).split(sep).join('/'), text: await readFile(file, 'utf8') })),
  );
}

async function verify(tarball: string): Promise<string[]> {
  return [...packageProblems(tarballEntries(tarball), trackedDataFiles()), ...relocationProblems(await bundleTexts())];
}

function smokeEnv(home: string, token: string, hostKind: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [PLAYER_HOME_ENV]: home,
    [DATA_DIR_ENV]: '',
    [TOKEN_ENV]: token,
    [SESSION_HOST_ENV]: hostKind,
  };
  for (const name of CLEARED_ENV) delete env[name];
  return env;
}

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(child.exitCode);
    else child.once('exit', (code) => resolve(code));
  });
}

async function answering(url: string, token: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the installed ja2-node exited with ${child.exitCode} before it answered`);
    try {
      const response = await fetch(`${url}/api/health`, { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) return;
    } catch {}
    await sleep(HEALTH_POLL_MS);
  }
  throw new Error(`the installed ja2-node did not answer at ${url} within ${START_TIMEOUT_MS} ms`);
}

async function expectOk(url: string, token: string): Promise<Response> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

async function smokeStart(bin: string, home: string, hostKind: string): Promise<void> {
  const token = randomBytes(16).toString('hex');
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const log: string[] = [];
  const child = spawn(bin, ['--port', String(port), '--no-open'], {
    env: smokeEnv(home, token, hostKind),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => log.push(chunk.toString()));
  try {
    await answering(url, token, child);
    const health = (await (await expectOk(`${url}/api/health`, token)).json()) as { name?: string; data?: { stubs?: boolean } };
    if (health.name !== 'ja2-node' || health.data?.stubs !== true) throw new Error(`unexpected health: ${JSON.stringify(health)}`);
    const page = await (await expectOk(`${url}/`, token)).text();
    if (!page.includes('<html')) throw new Error('the launcher page is not HTML');
    const sessions = (await (await expectOk(`${url}/api/sessions`, token)).json()) as { session?: string; error?: string }[];
    const sandbox = sessions.find((s) => s.session === SANDBOX_SESSION);
    if (!sandbox || sandbox.error) throw new Error(`the sandbox session is not running (${hostKind}): ${JSON.stringify(sessions)}`);
    child.kill('SIGTERM');
    const code = await Promise.race([exited(child), sleep(STOP_TIMEOUT_MS).then(() => 'timeout' as const)]);
    if (code !== 0) throw new Error(`the installed ja2-node stopped with ${String(code)}`);
    console.log(`[package] the installed ja2-node runs and stops (${hostKind} sessions)`);
  } catch (err) {
    child.kill('SIGKILL');
    console.error(log.join(''));
    throw err;
  }
}

async function smoke(tarball: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'ja2-package-'));
  try {
    const prefix = join(dir, 'prefix');
    runVisibly('npm', ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarball]);
    const bin = join(prefix, 'bin', 'ja2-node');
    const home = join(dir, 'home');
    const version = run(bin, ['--version'], { env: smokeEnv(home, 'x'.repeat(32), 'inprocess') }).trim();
    console.log(`[package] installed: ${version}`);
    run(bin, ['config'], { env: smokeEnv(home, 'x'.repeat(32), 'inprocess') });
    for (const kind of SMOKE_HOST_KINDS) await smokeStart(bin, home, kind);
    if (!(await stat(join(home, 'cache'))).isDirectory()) throw new Error(`the installed ja2-node kept no cache in ${home}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { smoke: { type: 'boolean' } } });
  if (positionals[0] === 'build') {
    await buildPackageFiles();
    return 0;
  }
  const tarball = await packTarball();
  const problems = await verify(tarball);
  for (const problem of problems) console.error(`[package] ${problem}`);
  if (problems.length > 0) return 1;
  const { size } = await stat(tarball);
  console.log(`[package] ${relative(REPO_ROOT, tarball)}: ${(size / 1024 / 1024).toFixed(1)} MB, contents checked`);
  if (values.smoke) await smoke(tarball);
  return 0;
}

if (import.meta.main) process.exitCode = await main();
