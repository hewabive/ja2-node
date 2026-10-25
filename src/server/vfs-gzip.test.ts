import { describe, expect, it } from 'vitest';
import { VfsGzipCache, worthCompressing } from './vfs-gzip.ts';

function incompressible(length: number): Uint8Array {
  let x = 2463534242;
  return Uint8Array.from({ length }, () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x & 0xff;
  });
}

const KB = 1024;

function repeated(byte: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

describe('the gzip cache of VFS files', () => {
  it('compresses a file once per content hash', async () => {
    const cache = new VfsGzipCache();
    let reads = 0;
    const read = async () => {
      reads++;
      return repeated(7, 64 * KB);
    };
    const first = await cache.compressed('aaaa', read);
    expect(await cache.compressed('aaaa', read)).toBe(first);
    expect(reads).toBe(1);
    expect(cache.bytes).toBe(first?.length);
  });

  it('drops the least recently used files past its byte limit', async () => {
    const one = await new VfsGzipCache().compressed('size', async () => repeated(1, 64 * KB));
    const cache = new VfsGzipCache((one?.length ?? 0) * 2);
    const reads: string[] = [];
    const file = (name: string) => async () => {
      reads.push(name);
      return repeated(1, 64 * KB);
    };
    await cache.compressed('a', file('a'));
    await cache.compressed('b', file('b'));
    await cache.compressed('a', file('a'));
    await cache.compressed('c', file('c'));
    await cache.compressed('a', file('a'));
    await cache.compressed('b', file('b'));
    expect(reads).toEqual(['a', 'b', 'c', 'b']);
  });

  it('skips small files, compressed formats and files gzip barely shrinks', async () => {
    expect(worthCompressing('json', KB - 1)).toBe(false);
    expect(worthCompressing('ogg', 64 * KB)).toBe(false);
    expect(worthCompressing('sti', 64 * KB)).toBe(true);
    const noise = incompressible(4 * KB);
    expect(await new VfsGzipCache().compressed('noise', async () => noise)).toBeNull();
  });
});
