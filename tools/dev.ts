import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { DEFAULT_STUBS_DIR, REPO_ROOT } from '../src/node/repo.ts';
import { loadOrCreateToken } from '../src/node/token.ts';
import { ensureStubPack } from '../stubs/ensure.ts';

const rebuilt = await ensureStubPack(DEFAULT_STUBS_DIR, () => console.log('[dev] building stub pack…'));
if (!rebuilt) console.log('[dev] stub pack is up to date');

function createSharedTokenBeforeSpawningChildren(): void {
  loadOrCreateToken();
}

createSharedTokenBeforeSpawningChildren();

const children: ChildProcess[] = [];

function run(name: string, command: string, args: string[]): void {
  const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => `[${name}] ${l}`)
      .join('\n');
  child.stdout?.on('data', (c: Buffer) => console.log(prefix(c)));
  child.stderr?.on('data', (c: Buffer) => console.error(prefix(c)));
  child.on('exit', (code) => {
    console.log(`[${name}] exited with ${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!process.env.JA2_DATA_DIR) console.log('[dev] JA2_DATA_DIR is not set: only the stub pack is available');
const SERVER_URL = `http://127.0.0.1:${Number(process.env.JA2_PORT ?? 7420)}/api/health`;
const SERVER_POLL_MS = 100;

async function serverAnswers(): Promise<boolean> {
  try {
    await fetch(SERVER_URL);
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(): Promise<void> {
  while (!stopping && !(await serverAnswers())) await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_MS));
}

run('server', process.execPath, [join(REPO_ROOT, 'src/server/main.ts')]);
await waitForServer();
if (!stopping) run('web', process.execPath, [join(REPO_ROOT, 'node_modules/vite/bin/vite.js')]);
