import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { REPO_ROOT } from '../../src/node/repo.ts';

export interface StubServer {
  readonly url: string;
  readonly token: string;
  readonly saveDir: string;
  stop(): Promise<void>;
}

const HEALTH_POLL_MS = 100;
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;
const LOG_TAIL_LINES = 40;

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function answers(url: string, token: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/api/health`, { headers: { authorization: `Bearer ${token}` } })).ok;
  } catch {
    return false;
  }
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
}

export async function startStubServer(port?: number): Promise<StubServer> {
  const chosen = port ?? (await freePort());
  const url = `http://127.0.0.1:${chosen}`;
  const token = randomBytes(16).toString('hex');
  const saveDir = await mkdtemp(join(tmpdir(), 'ja2-campaign-bot-'));
  const log: string[] = [];
  const child = spawn(process.execPath, [join(REPO_ROOT, 'src/server/main.ts')], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JA2_DATA_DIR: '', JA2_HOST: '127.0.0.1', JA2_PORT: String(chosen), JA2_TOKEN: token, JA2_SAVE_DIR: saveDir },
  });
  const keep = (chunk: Buffer) => {
    log.push(...chunk.toString().split('\n').filter(Boolean));
    log.splice(0, Math.max(0, log.length - LOG_TAIL_LINES));
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const forced = sleep(STOP_TIMEOUT_MS).then(() => child.kill('SIGKILL'));
      await Promise.race([exited(child), forced]);
    }
    await rm(saveDir, { recursive: true, force: true });
  };
  const deadline = performance.now() + START_TIMEOUT_MS;
  while (!(await answers(url, token))) {
    if (child.exitCode !== null || performance.now() > deadline) {
      await stop();
      throw new Error(`the stub server did not start on ${url}:\n${log.join('\n')}`);
    }
    await sleep(HEALTH_POLL_MS);
  }
  return { url, token, saveDir, stop };
}
