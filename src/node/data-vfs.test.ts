import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { writeSlf } from '../content/formats/slf.ts';
import { decodeSti } from '../content/formats/sti.ts';
import { encodeVfsAliases, VFS_ALIASES_FILE } from '../content/vfs/aliases.ts';
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

describe('stub layer aliases', () => {
  async function stubDir(aliases: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ja2-stub-aliases-'));
    temp.push(dir);
    await mkdir(join(dir, 'synth'), { recursive: true });
    await mkdir(join(dir, 'sounds'), { recursive: true });
    await writeFile(join(dir, 'synth', 'door.wav'), enc('door'));
    await writeFile(join(dir, 'sounds', 'own.wav'), enc('own'));
    await writeFile(join(dir, VFS_ALIASES_FILE), encodeVfsAliases(new Map(Object.entries(aliases))));
    return dir;
  }

  it('lists aliases as files of the stub layer that read their target, without hiding real files', async () => {
    const dir = await stubDir({ 'sounds/door open 01.wav': 'synth/door.wav', 'sounds/own.wav': 'synth/door.wav' });
    const d = await openDataVfs({ stubsDir: dir });
    try {
      expect(d.vfs.stat('stubs/sounds/Door Open 01.wav')).toEqual({ path: 'stubs/sounds/door open 01.wav', size: 4, layer: 'stubs' });
      expect(dec(await d.vfs.read('stubs/sounds/door open 01.wav', 1))).toBe('oor');
      expect(dec(await d.vfs.read('stubs/sounds/own.wav'))).toBe('own');
    } finally {
      await d.close();
    }
  });

  it('refuses an alias to a missing file', async () => {
    const dir = await stubDir({ 'sounds/x.wav': 'synth/missing.wav' });
    await expect(openDataVfs({ stubsDir: dir })).rejects.toThrow(/missing file synth\/missing.wav/);
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('original game data', () => {
  it('contains ja2bin.dat and decodes a merc sprite', async () => {
    const d = await openDataVfs({ dataDir: ORIGINAL_DATA_DIR });
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
