import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Vfs } from '../content/vfs/vfs.ts';
import { createApp } from './app.ts';

describe('the built client pages', () => {
  it('serves the game page at /play', async () => {
    const clientDir = mkdtempSync(join(tmpdir(), 'ja2-client-'));
    mkdirSync(join(clientDir, 'src/app/game'), { recursive: true });
    writeFileSync(join(clientDir, 'src/app/game/index.html'), '<!doctype html><title>game page</title>');
    const app = createApp({
      vfs: new Vfs([]),
      token: 'test-token-0123456789',
      info: { originalData: false, slfCount: 0, stubs: false },
      clientDir,
    });
    for (const path of ['/play', '/play/', '/play?session=abc']) {
      const page = await app.request(`http://localhost${path}`);
      expect(page.status, path).toBe(200);
      expect(await page.text(), path).toContain('game page');
    }
  });

  it('caches the hashed client files forever, revalidates the pages and gzips both', async () => {
    const clientDir = mkdtempSync(join(tmpdir(), 'ja2-client-'));
    mkdirSync(join(clientDir, 'src/app/game'), { recursive: true });
    mkdirSync(join(clientDir, 'assets'));
    writeFileSync(join(clientDir, 'src/app/game/index.html'), `<!doctype html><title>game page</title>${' '.repeat(2048)}`);
    writeFileSync(join(clientDir, 'assets/play-BODP3x05.js'), `export const play = 1;${'\n'.repeat(4096)}`);
    const app = createApp({
      vfs: new Vfs([]),
      token: 'test-token-0123456789',
      info: { originalData: false, slfCount: 0, stubs: false },
      clientDir,
    });
    const gzip = { 'accept-encoding': 'gzip' };
    const script = await app.request('http://localhost/assets/play-BODP3x05.js', { headers: gzip });
    expect(script.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(script.headers.get('content-encoding')).toBe('gzip');
    const page = await app.request('http://localhost/play', { headers: gzip });
    expect(page.headers.get('cache-control')).toBe('private, no-cache');
    expect(page.headers.get('content-encoding')).toBe('gzip');
  });
});
