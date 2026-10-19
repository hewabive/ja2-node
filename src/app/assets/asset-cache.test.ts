import { describe, expect, it } from 'vitest';
import { MemoryLayer, Vfs } from '../../content/vfs/vfs.ts';
import { createApp } from '../../server/app.ts';
import { AssetCache, type AssetDecoder, DEFAULT_ASSET_CACHE_BYTES, loadDecodedAsset, RAW_BYTES } from './asset-cache.ts';
import { HttpAssetSource } from './asset-source.ts';
import type { Fetcher } from './http-vfs-layer.ts';
import { type PreloadProgress, preloadAssets } from './preload.ts';

const TOKEN = 'cache-test-token-0123456789';
const text = (s: string) => new TextEncoder().encode(s);

function counted(name: string, calls: string[]): AssetDecoder<string> {
  return {
    name,
    decode: (bytes, path) => {
      calls.push(path);
      return new TextDecoder().decode(bytes).toUpperCase();
    },
    size: (value) => value.length,
  };
}

async function sourceOver(entries: readonly [string, Uint8Array][]): Promise<{ source: HttpAssetSource; fetched: string[] }> {
  const app = createApp({
    vfs: new Vfs([new MemoryLayer('mem', entries)]),
    token: TOKEN,
    info: { originalData: false, slfCount: 0, stubs: true },
  });
  const fetched: string[] = [];
  const fetcher: Fetcher = (url, init) => {
    fetched.push(url);
    return Promise.resolve(app.fetch(new Request(url, init)));
  };
  const source = await HttpAssetSource.open({ fetch: fetcher, baseUrl: 'http://localhost', headers: { authorization: `Bearer ${TOKEN}` } });
  fetched.length = 0;
  return { source, fetched };
}

describe('the decoded asset cache', () => {
  it('keys values by content hash and decoder and forgets the least recently used past its byte budget', () => {
    const cache = new AssetCache({ maxBytes: 10 });
    const calls: string[] = [];
    const upper = counted('upper', calls);
    cache.put('h1', upper, 'aaaa');
    cache.put('h2', upper, 'bbbb');
    cache.put('h1', RAW_BYTES, text('x'));
    expect(cache.get('h1', upper)).toBe('aaaa');
    expect(cache.bytes).toBe(9);
    cache.put('h3', upper, 'cccc');
    expect(cache.has('h2', upper)).toBe(false);
    expect(cache.has('h1', RAW_BYTES)).toBe(true);
    expect(cache.get('h3', upper)).toBe('cccc');
    cache.put('h4', upper, 'dd');
    expect(cache.has('h1', RAW_BYTES)).toBe(false);
    expect(cache.get('h1', upper)).toBe('aaaa');
    cache.put('huge', upper, 'x'.repeat(11));
    expect(cache.has('huge', upper)).toBe(false);
    expect(cache.bytes).toBe(10);
    expect(new AssetCache().maxBytes).toBe(DEFAULT_ASSET_CACHE_BYTES);
  });

  it('decodes a file once while loads overlap, and reuses bytes already fetched', async () => {
    const { source, fetched } = await sourceOver([['interface/a.sti', text('abc')]]);
    const cache = new AssetCache();
    const calls: string[] = [];
    const upper = counted('upper', calls);
    const [a, b] = await Promise.all([
      loadDecodedAsset(source, cache, 'interface/a.sti', upper),
      loadDecodedAsset(source, cache, 'INTERFACE/A.STI', upper),
    ]);
    expect([a, b]).toEqual(['ABC', 'ABC']);
    expect(calls).toEqual(['interface/a.sti']);
    expect(fetched).toHaveLength(1);
    const other = counted('other', calls);
    cache.put(source.hashOf('interface/a.sti') ?? '', RAW_BYTES, text('abc'));
    expect(await loadDecodedAsset(source, cache, 'interface/a.sti', other)).toBe('ABC');
    expect(fetched).toHaveLength(1);
    await expect(loadDecodedAsset(source, cache, 'interface/none.sti', upper)).rejects.toThrow(/no asset/);
  });
});

describe('preloading a screen', () => {
  it('fetches every listed file once, reports progress and the files the data lacks', async () => {
    const { source, fetched } = await sourceOver([
      ['interface/a.sti', text('aa')],
      ['interface/b.sti', text('bbbb')],
    ]);
    const cache = new AssetCache();
    const progress: PreloadProgress[] = [];
    const result = await preloadAssets(source, ['interface/a.sti', 'interface/b.sti', 'interface/a.sti', 'interface/c.sti'], {
      cache,
      onProgress: (p) => progress.push(p),
    });
    expect(result).toEqual({ loaded: ['interface/a.sti', 'interface/b.sti'], missing: ['interface/c.sti'], bytes: 6 });
    expect(progress.map((p) => [p.done, p.total, p.totalBytes])).toEqual([
      [1, 2, 6],
      [2, 2, 6],
    ]);
    expect(progress.at(-1)?.bytes).toBe(6);
    expect(fetched).toHaveLength(2);
    await preloadAssets(source, ['interface/a.sti'], { cache });
    expect(fetched).toHaveLength(2);
    const aborted = new AbortController();
    aborted.abort();
    await expect(preloadAssets(source, ['interface/b.sti'], { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
