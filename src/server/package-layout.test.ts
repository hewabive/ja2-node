import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_FILE, PACKAGE_SERVER_DIR, packageLayout } from './package-layout.ts';

describe('the layout of an installed package', () => {
  it('finds every resource under the root it is given and reads the engine written at packaging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ja2-package-root-'));
    try {
      await mkdir(join(root, PACKAGE_SERVER_DIR), { recursive: true });
      await writeFile(join(root, PACKAGE_SERVER_DIR, ENGINE_FILE), JSON.stringify({ version: '1.2.3', commit: 'abc123' }));
      expect(packageLayout(root)).toEqual({
        projectDataDir: join(root, 'data'),
        stubsDir: join(root, 'dist', 'stubs'),
        clientDir: join(root, 'dist', 'client'),
        sessionWorker: pathToFileURL(join(root, 'dist', 'server', 'session-worker.js')),
        engine: { version: '1.2.3', commit: 'abc123' },
        repositoryRoot: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
