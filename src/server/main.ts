import { serve } from '@hono/node-server';
import { openDataVfs } from '../node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR } from '../node/repo.ts';
import { loadOrCreateToken } from '../node/token.ts';
import { createApp } from './app.ts';

const host = process.env.JA2_HOST ?? '127.0.0.1';
const port = Number(process.env.JA2_PORT ?? 7420);
const data = await openDataVfs({
  projectDataDir: PROJECT_DATA_DIR,
  dataDir: process.env.JA2_DATA_DIR || undefined,
  stubsDir: process.env.JA2_STUBS_DIR ?? DEFAULT_STUBS_DIR,
});
const token = loadOrCreateToken();
const app = createApp({
  vfs: data.vfs,
  token,
  info: { originalData: data.dataDir !== null, slfCount: data.slfCount, stubs: data.stubsDir !== null },
});

const server = serve({ fetch: app.fetch, hostname: host, port }, (addr) => {
  console.log(`ja2-node server on http://${host}:${addr.port}`);
  console.log(`  original data: ${data.dataDir ?? 'not set (JA2_DATA_DIR)'}${data.dataDir ? `, ${data.slfCount} SLF` : ''}`);
  console.log(`  stubs: ${data.stubsDir ?? 'missing (run pnpm stubs)'}`);
  console.log(`  files in VFS: ${data.vfs.size}`);
  console.log('  token: .ja2/token (or $JA2_TOKEN)');
});

const shutdown = (): void => {
  server.close(() => {
    void data.close().then(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
