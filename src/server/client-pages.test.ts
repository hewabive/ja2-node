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
});
