import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { openDataVfs } from '../node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR, REPO_ROOT } from '../node/repo.ts';
import { loadOrCreateToken } from '../node/token.ts';
import { createApp } from './app.ts';
import type { Session } from './session.ts';
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
const app = createApp({
  vfs: data.vfs,
  token,
  vfsGeneration: Date.now().toString(36),
  sessions,
  defaultSession,
  ...(existsSync(clientDir) ? { clientDir } : {}),
  info: { originalData: data.dataDir !== null, slfCount: data.slfCount, stubs: data.stubsDir !== null },
});

const server = serve({ fetch: app.fetch, hostname: host, port }, (addr) => {
  console.log(`ja2-node server on http://${host}:${addr.port}`);
  console.log(`  original data: ${data.dataDir ?? 'not set (JA2_DATA_DIR)'}${data.dataDir ? `, ${data.slfCount} SLF` : ''}`);
  console.log(`  stubs: ${data.stubsDir ?? 'missing (run pnpm stubs)'}`);
  console.log(`  files in VFS: ${data.vfs.size}`);
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
