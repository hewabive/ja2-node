import { describe, expect, it } from 'vitest';
import { CHANGING_FILE, ChangingFile, sha256Hex } from '../../tests/support/changing-layer.ts';
import { Vfs } from '../content/vfs/vfs.ts';
import { VfsHashes } from './assets-manifest.ts';

describe('the content hashes of files that change', () => {
  it('hashes a file again after a read that failed', async () => {
    const file = new ChangingFile(['{"a":1}']);
    const hashes = VfsHashes.memory(new Vfs([file]));
    file.onRead = () => {
      file.onRead = null;
      throw new Error('disk error');
    };
    await expect(hashes.sha256(CHANGING_FILE)).rejects.toThrow('disk error');
    expect(await hashes.sha256(CHANGING_FILE)).toBe(sha256Hex('{"a":1}'));
  });

  it('reads the file again when it changes while an earlier hash is still reading', async () => {
    const file = new ChangingFile(['{"a":1}', '{"a":2}']);
    const hashes = VfsHashes.memory(new Vfs([file]));
    let release = (): void => {};
    file.gate = new Promise((resolve) => {
      release = resolve;
    });
    const before = hashes.sha256(CHANGING_FILE);
    file.change();
    const after = hashes.sha256(CHANGING_FILE);
    release();
    expect([await before, await after]).toEqual([sha256Hex('{"a":1}'), sha256Hex('{"a":2}')]);
    expect(await hashes.sha256(CHANGING_FILE)).toBe(sha256Hex('{"a":2}'));
    expect(file.reads).toBe(2);
  });
});
