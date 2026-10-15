import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseStubSpriteManifest, pictureFromStubSprite, STUB_SPRITE_SUFFIX } from '../src/content/picture/stub-sprite.ts';
import { openDataVfs, STUBS_PREFIX } from '../src/node/data-vfs.ts';
import { buildStubs } from './build.ts';

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function build(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ja2-stubs-'));
  dirs.push(dir);
  await buildStubs(dir);
  return dir;
}

describe('stub pack', () => {
  it('builds deterministically', async () => {
    const [a, b] = await Promise.all([build(), build()]);
    for (const f of ['soldier/capsule.png', 'soldier/capsule.sprite.json', 'tiles/ground.png']) {
      expect(await readFile(join(a, f))).toEqual(await readFile(join(b, f)));
    }
  });

  it('loads through the VFS into pictures', async () => {
    const dir = await build();
    const data = await openDataVfs({ stubsDir: dir });
    try {
      const manifests = data.vfs.list().filter((f) => f.path.endsWith(STUB_SPRITE_SUFFIX));
      expect(manifests.map((f) => f.path)).toContain(`${STUBS_PREFIX}/soldier/capsule${STUB_SPRITE_SUFFIX}`);
      for (const f of manifests) {
        const manifest = parseStubSpriteManifest(JSON.parse(new TextDecoder().decode(await data.vfs.read(f.path))));
        const png = await data.vfs.read(f.path.replace(/[^/]+$/, manifest.image));
        const pic = pictureFromStubSprite(manifest, png);
        expect(pic.frames.length).toBe(manifest.frames.length);
        expect(pic.frames.every((fr) => fr.pixels.some((p) => p !== 0))).toBe(true);
      }
      const soldier = data.vfs.stat('stubs/soldier/capsule.sprite.json');
      expect(soldier?.layer).toBe('stubs');
    } finally {
      await data.close();
    }
  });
});
