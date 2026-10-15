import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeSlf } from '../content/formats/slf.ts';
import { decodeSti } from '../content/formats/sti.ts';
import { openDataVfs, resolveDataDir } from './data-vfs.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);
const temp: string[] = [];
afterAll(async () => {
  await Promise.all(temp.map((d) => rm(d, { recursive: true, force: true })));
});

async function fakeGame(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ja2-game-'));
  temp.push(root);
  const data = join(root, 'Data');
  await mkdir(join(data, 'BinaryData'), { recursive: true });
  await writeFile(
    join(data, 'BinaryData.slf'),
    writeSlf({
      libraryName: 'binary',
      libraryPath: 'BINARYDATA\\',
      files: [
        { name: 'JA2BIN.DAT', data: enc('from slf') },
        { name: 'PROF.DAT', data: enc('profiles') },
      ],
    }),
  );
  await writeFile(
    join(data, 'Anims.SLF'),
    writeSlf({ libraryName: 'anims', libraryPath: 'ANIMS\\', files: [{ name: 'X.STI', data: enc('x') }] }),
  );
  await writeFile(join(data, 'BinaryData', 'Ja2bin.dat'), enc('loose wins'));
  return root;
}

describe('standard VFS stack', () => {
  it('finds Data under the game root and prefers loose files over archives', async () => {
    const root = await fakeGame();
    expect(await resolveDataDir(root)).toBe(join(root, 'Data'));
    const d = await openDataVfs({ dataDir: root });
    try {
      expect(d.slfCount).toBe(2);
      expect(d.vfs.stat('binarydata/ja2bin.dat')?.layer).toBe('data-dir');
      expect(dec(await d.vfs.read('BINARYDATA/JA2BIN.DAT'))).toBe('loose wins');
      expect(dec(await d.vfs.read('binarydata/prof.dat', 3))).toBe('files');
      expect(d.vfs.stat('anims/x.sti')?.layer).toBe('anims.slf');
      expect(d.vfs.list().some((f) => f.path.endsWith('.slf'))).toBe(false);
    } finally {
      await d.close();
    }
  });

  it('is empty without data and stubs, and explains a directory without *.slf', async () => {
    const d = await openDataVfs({});
    expect(d.vfs.size).toBe(0);
    await d.close();
    const empty = await mkdtemp(join(tmpdir(), 'ja2-empty-'));
    temp.push(empty);
    await expect(resolveDataDir(empty)).rejects.toThrow(/no \*\.slf/);
  });
});

describe.skipIf(!process.env.JA2_DATA_DIR)('original game data', () => {
  it('contains ja2bin.dat and decodes a merc sprite', async () => {
    const d = await openDataVfs({ dataDir: process.env.JA2_DATA_DIR });
    try {
      expect(d.slfCount).toBeGreaterThanOrEqual(20);
      expect(d.vfs.stat('binarydata/ja2bin.dat')?.size).toBe(320 * 100 * 2);
      const sti = decodeSti(await d.vfs.read('anims/s_merc/s_r_walk.sti'));
      expect(sti.kind === 'indexed' && sti.subImages.length).toBe(96);
      expect(sti.kind === 'indexed' && sti.anomalies).toBe(0);
    } finally {
      await d.close();
    }
  });
});
