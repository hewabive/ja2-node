import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { dataDecoding } from '../content/text/data-version.ts';
import { openDataVfs } from '../node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR, REPO_ROOT } from '../node/repo.ts';
import { loadOrCreateToken } from '../node/token.ts';
import { createApp } from './app.ts';
import { chooseDisplayLanguage, detectDataVersion, LANGUAGE_ENV } from './data-version.ts';
import { createSaveEnvironment } from './save-environment.ts';
import { createSessionFactory } from './session-factory.ts';
import { inProcessHostFactory, type SessionHost } from './session-host.ts';
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
const sessions = new Map<string, SessionHost>();
const defaultSession = 'sandbox';
const { store, saves, sources } = createSaveEnvironment({
  vfs: data.vfs,
  dataDir: data.dataDir,
  dataVersion: dataVersion.version,
  decoding,
  warn: (message) => console.warn(message),
});
const createSession = inProcessHostFactory(createSessionFactory({ ...sources, text: sessionText, saves }), saves);
try {
  const seed = Number(process.env.JA2_SEED ?? 1);
  const save = process.env.JA2_SAVE;
  const campaign = process.env.JA2_CAMPAIGN ? { options: { difficulty: Number(process.env.JA2_CAMPAIGN) } } : undefined;
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

const sandbox = await sessions.get(defaultSession)?.describe();
const server = serve({ fetch: app.fetch, hostname: host, port }, (addr) => {
  console.log(`ja2-node server on http://${host}:${addr.port}`);
  console.log(`  original data: ${data.dataDir ?? 'not set (JA2_DATA_DIR)'}${data.dataDir ? `, ${data.slfCount} SLF` : ''}`);
  console.log(`  stubs: ${data.stubsDir ?? 'missing (run pnpm stubs)'}`);
  console.log(`  data version: ${dataVersion.version} (${dataVersion.source}), display language: ${defaultLanguage}`);
  if (dataVersion.warning) console.log(`  warning: ${dataVersion.warning}`);
  console.log(`  files in VFS: ${data.vfs.size}`);
  if (sandbox) console.log(`  sandbox: ${String(sandbox.map)}, ${String(sandbox.soldiers)} visible soldiers`);
  console.log(`  saves: ${store.dir}${store.nativeDir ? `, native saves: ${store.nativeDir}` : ''}`);
  console.log('  token: .ja2/token (or $JA2_TOKEN)');
  if (existsSync(clientDir)) console.log(`  built client: http://${host}:${addr.port}/login?token=${token}`);
});

attachWebSocket(server, { token, sessions, defaultSession });

const shutdown = (): void => {
  void Promise.all([...sessions.values()].map((session) => session.close()))
    .then(() => saves.flush())
    .catch((err: Error) => console.error(`saving on shutdown failed: ${err.message}`))
    .finally(() => {
      server.close(() => {
        void data.close().then(() => process.exit(0));
      });
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
