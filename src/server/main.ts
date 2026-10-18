import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { dataDecoding } from '../content/text/data-version.ts';
import { openDataVfs } from '../node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR, REPO_ROOT } from '../node/repo.ts';
import { loadOrCreateToken } from '../node/token.ts';
import { createApp } from './app.ts';
import { ContentLedger, engineIdentity } from './content-identity.ts';
import { chooseDisplayLanguage, detectDataVersion, LANGUAGE_ENV } from './data-version.ts';
import { SaveService } from './save-service.ts';
import { SaveStore, saveDirFromEnv } from './save-store.ts';
import type { Session } from './session.ts';
import { createSessionFactory } from './session-factory.ts';
import { restoreSession } from './session-snapshot.ts';
import { TextService } from './text-service.ts';
import { attachWebSocket } from './ws.ts';

const host = process.env.JA2_HOST ?? '127.0.0.1';
const port = Number(process.env.JA2_PORT ?? 7420);
const data = await openDataVfs({
  projectDataDir: PROJECT_DATA_DIR,
  dataDir: process.env.JA2_DATA_DIR || undefined,
  stubsDir: process.env.JA2_STUBS_DIR ?? DEFAULT_STUBS_DIR,
});
const dataVersion = detectDataVersion(data.vfs, data.dataDir !== null, process.env);
const defaultLanguage = chooseDisplayLanguage(process.env[LANGUAGE_ENV], dataVersion.version);
const decoding = dataDecoding(dataVersion.version);
const texts = new TextService({ vfs: data.vfs, dataVersion: dataVersion.version });
const sessionText = { language: defaultLanguage, dataVersion: dataVersion.version };
const token = loadOrCreateToken();
const clientDir = join(REPO_ROOT, 'dist/client');
const sessions = new Map<string, Session>();
const defaultSession = 'sandbox';
const readVfs = async (path: string): Promise<Uint8Array | null> => (data.vfs.stat(path) ? data.vfs.read(path) : null);
const nativeSavesDir = process.env.JA2_SAVES_DIR || (data.dataDir ? join(dirname(data.dataDir), 'SavedGames') : null);
const exists = (path: string) => data.vfs.stat(path) !== undefined;
const layers = (path: string) => data.vfs.layerCount(path);
const originalData = data.dataDir !== null;
const ledger = new ContentLedger(originalData ? 'original' : 'stubs', readVfs, exists);
const store = new SaveStore(saveDirFromEnv(), nativeSavesDir);
const saves = new SaveService({
  store,
  ledger,
  dataVersion: dataVersion.version,
  engine: engineIdentity(),
  restore: (snapshot) => restoreSession(snapshot, ledger.read, ledger.exists, { layers, decoding }),
  warn: (message) => console.warn(message),
});
const createSession = createSessionFactory({
  read: ledger.read,
  exists: ledger.exists,
  layers,
  decoding,
  originalData,
  store,
  text: sessionText,
  saves,
});
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
  texts,
  defaultLanguage,
  saves,
  ...(existsSync(clientDir) ? { clientDir } : {}),
  info: { originalData: data.dataDir !== null, slfCount: data.slfCount, stubs: data.stubsDir !== null },
});

const server = serve({ fetch: app.fetch, hostname: host, port }, (addr) => {
  console.log(`ja2-node server on http://${host}:${addr.port}`);
  console.log(`  original data: ${data.dataDir ?? 'not set (JA2_DATA_DIR)'}${data.dataDir ? `, ${data.slfCount} SLF` : ''}`);
  console.log(`  stubs: ${data.stubsDir ?? 'missing (run pnpm stubs)'}`);
  console.log(`  data version: ${dataVersion.version} (${dataVersion.source}), display language: ${defaultLanguage}`);
  if (dataVersion.warning) console.log(`  warning: ${dataVersion.warning}`);
  console.log(`  files in VFS: ${data.vfs.size}`);
  const sandbox = sessions.get(defaultSession);
  if (sandbox) console.log(`  sandbox: ${sandbox.sim.view().mapPath}, ${sandbox.sim.view().soldiers.length} visible soldiers`);
  console.log(`  saves: ${store.dir}${nativeSavesDir ? `, native saves: ${nativeSavesDir}` : ''}`);
  console.log('  token: .ja2/token (or $JA2_TOKEN)');
  if (existsSync(clientDir)) console.log(`  built client: http://${host}:${addr.port}/login?token=${token}`);
});

attachWebSocket(server, { token, sessions, defaultSession, saves });

const shutdown = (): void => {
  void saves
    .shutdown()
    .catch((err: Error) => console.error(`saving on shutdown failed: ${err.message}`))
    .finally(() => {
      for (const session of sessions.values()) session.close();
      server.close(() => {
        void data.close().then(() => process.exit(0));
      });
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
