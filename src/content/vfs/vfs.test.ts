import { describe, expect, it } from 'vitest';
import { joinVfsPath, normalizeVfsPath, vfsExtension } from './path.ts';
import { MemoryLayer, Vfs, VfsNotFoundError } from './vfs.ts';

const b = (s: string) => new TextEncoder().encode(s);
const s = (u: Uint8Array) => new TextDecoder().decode(u);

describe('VFS paths', () => {
  it('normalize like Stracciatella', () => {
    expect(normalizeVfsPath('\\ANIMS\\S_Merc//Walk.STI')).toBe('anims/s_merc/walk.sti');
    expect(normalizeVfsPath('./a/./b/')).toBe('a/b');
    expect(() => normalizeVfsPath('a/../b')).toThrow(RangeError);
    expect(joinVfsPath('ANIMS\\', 'x.sti')).toBe('anims/x.sti');
    expect(joinVfsPath('', 'X.sti')).toBe('x.sti');
    expect(vfsExtension('a/b.c/file.STI')).toBe('sti');
    expect(vfsExtension('a/b.c/file')).toBe('');
  });
});

describe('Vfs', () => {
  const vfs = new Vfs([
    new MemoryLayer('loose', [['BinaryData/Ja2bin.dat', b('loose')]]),
    new MemoryLayer('binarydata.slf', [
      ['binarydata/ja2bin.dat', b('archived')],
      ['binarydata/prof.dat', b('profiles')],
    ]),
  ]);

  it('gives the first layer priority', async () => {
    expect(vfs.stat('BINARYDATA\\JA2BIN.DAT')?.layer).toBe('loose');
    expect(s(await vfs.read('binarydata/ja2bin.dat'))).toBe('loose');
    expect(s(await vfs.read('binarydata/prof.dat'))).toBe('profiles');
    expect(vfs.list().map((f) => f.path)).toEqual(['binarydata/ja2bin.dat', 'binarydata/prof.dat']);
  });

  it('reads ranges and reports missing files', async () => {
    expect(s(await vfs.read('binarydata/prof.dat', 2, 5))).toBe('ofi');
    expect(s(await vfs.read('binarydata/prof.dat', 3, 1000))).toBe('files');
    await expect(vfs.read('nope.sti')).rejects.toBeInstanceOf(VfsNotFoundError);
    await expect(vfs.read('binarydata/prof.dat', 5, 2)).rejects.toBeInstanceOf(RangeError);
  });
});
