import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { openDataVfs } from '../node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR, REPO_ROOT } from '../node/repo.ts';
import { loadOrCreateToken } from '../node/token.ts';
import { createApp } from './app.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSandboxSession } from './sandbox.ts';
import { createSaveSession } from './save-session.ts';
import { Session } from './session.ts';
import { SAVE_NAME, type SessionRequest } from './session-registry.ts';
import { attachWebSocket } from './ws.ts';

const host = process.env.JA2_HOST ?? '127.0.0.1';
const port = Number(process.env.JA2_PORT ?? 7420);
const data = await openDataVfs({
  projectDataDir: PROJECT_DATA_DIR,
  dataDir: process.env.JA2_DATA_DIR || undefined,
  stubsDir: process.env.JA2_STUBS_DIR ?? DEFAULT_STUBS_DIR,
});
const token = loadOrCreateToken();
const clientDir = join(REPO_ROOT, 'dist/client');
const sessions = new Map<string, Session>();
const defaultSession = 'sandbox';
const readVfs = async (path: string): Promise<Uint8Array | null> => (data.vfs.stat(path) ? data.vfs.read(path) : null);
const savesDir = process.env.JA2_SAVES_DIR || (data.dataDir ? join(dirname(data.dataDir), 'SavedGames') : null);
const exists = (path: string) => data.vfs.stat(path) !== undefined;
const createSession = async (id: string, request: SessionRequest): Promise<Session> => {
  if (request.campaign) return new Session(id, await createCampaignSession(readVfs, exists, request.seed, request.campaign));
  if (!request.save) return new Session(id, await createSandboxSession(readVfs, data.dataDir !== null, request.seed));
  if (!savesDir || data.dataDir === null) throw new Error('savegames need the original data (JA2_DATA_DIR)');
  if (!SAVE_NAME.test(request.save)) throw new Error(`invalid save name ${request.save}`);
  const bytes = new Uint8Array(await readFile(join(savesDir, `${request.save}.sav`)));
  return new Session(id, (await createSaveSession(readVfs, bytes, request.seed, exists)).session);
};
try {
  const seed = Number(process.env.JA2_SEED ?? 1);
  const save = process.env.JA2_SAVE;
  const campaign = process.env.JA2_CAMPAIGN ? { difficulty: Number(process.env.JA2_CAMPAIGN) } : undefined;
  sessions.set(defaultSession, await createSession(defaultSession, { seed, ...(save ? { save } : {}), ...(campaign ? { campaign } : {}) }));
} catch (err) {
  console.error(`sandbox session unavailable: ${(err as Error).message}`);
}
const app = createApp({
  vfs: data.vfs,
  token,
  vfsGeneration: Date.now().toString(36),
  sessions,
  defaultSession,
  createSession,
  ...(existsSync(clientDir) ? { clientDir } : {}),
  info: { originalData: data.dataDir !== null, slfCount: data.slfCount, stubs: data.stubsDir !== null },
});

const server = serve({ fetch: app.fetch, hostname: host, port }, (addr) => {
  console.log(`ja2-node server on http://${host}:${addr.port}`);
  console.log(`  original data: ${data.dataDir ?? 'not set (JA2_DATA_DIR)'}${data.dataDir ? `, ${data.slfCount} SLF` : ''}`);
  console.log(`  stubs: ${data.stubsDir ?? 'missing (run pnpm stubs)'}`);
  console.log(`  files in VFS: ${data.vfs.size}`);
  const sandbox = sessions.get(defaultSession);
  if (sandbox) console.log(`  sandbox: ${sandbox.sim.view().mapPath}, ${sandbox.sim.view().soldiers.length} visible soldiers`);
  console.log('  token: .ja2/token (or $JA2_TOKEN)');
  if (existsSync(clientDir)) console.log(`  built client: http://${host}:${addr.port}/login?token=${token}`);
});

attachWebSocket(server, { token, sessions, defaultSession });

const shutdown = (): void => {
  for (const session of sessions.values()) session.close();
  server.close(() => {
    void data.close().then(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
