import { describe, expect, it } from 'vitest';
import { MemoryLayer, Vfs, VfsNotFoundError } from '../../content/vfs/vfs.ts';
import { ASSET_MANIFEST_VERSION } from '../../protocol/assets.ts';
import { createApp } from '../../server/app.ts';
import { HttpAssetSource } from './asset-source.ts';
import { type Fetcher, fetchAssetManifest, HttpVfsLayer, MAX_CONCURRENCY, MIN_CONCURRENCY, StaleAssetError } from './http-vfs-layer.ts';

const TOKEN = 'client-test-token-0123456789';
const BASE = 'http://localhost';
const text = (s: string) => new TextEncoder().encode(s);
const decoded = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function files(count: number): [string, Uint8Array][] {
  return Array.from({ length: count }, (_, i): [string, Uint8Array] => [`interface/f${i}.sti`, text(`file ${i}`)]);
}

function serverOver(vfs: Vfs, stubs = true) {
  const app = createApp({ vfs, token: TOKEN, info: { originalData: !stubs, slfCount: 0, stubs } });
  const urls: string[] = [];
  const fetcher: Fetcher = (url, init) => {
    urls.push(url);
    return Promise.resolve(app.fetch(new Request(url, init)));
  };
  return { fetcher, urls, options: { fetch: fetcher, baseUrl: BASE, headers: { authorization: `Bearer ${TOKEN}` } } };
}

interface Deferred {
  readonly url: string;
  readonly signal: AbortSignal | null;
  release(body: string): void;
}

function blockingFetcher(): { fetcher: Fetcher; started: Deferred[] } {
  const started: Deferred[] = [];
  const fetcher: Fetcher = (url, init) =>
    new Promise((resolve, reject) => {
      const signal = init?.signal ?? null;
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      started.push({ url, signal, release: (body) => resolve(new Response(body)) });
    });
  return { fetcher, started };
}

const MANIFEST_HASH = '0123456789abcdef';

function manifestOf(paths: readonly string[]) {
  return {
    format: 'ja2-node-assets' as const,
    version: ASSET_MANIFEST_VERSION,
    source: 'stubs' as const,
    stubText: true,
    layers: ['stubs'],
    files: paths.map((p) => [p, 4, MANIFEST_HASH, 0] as const),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('the HTTP asset source', () => {
  it('builds the same VFS as the server from the manifest and reads through immutable URLs', async () => {
    const server = serverOver(
      new Vfs([
        new MemoryLayer('ja2-node-data', [['tables/a.json', text('{"a":1}')]]),
        new MemoryLayer('stubs', [
          ['stubs/sounds/door.wav', text('wave')],
          ['Interface/Panel.STI', text('0123456789')],
        ]),
      ]),
    );
    const source = await HttpAssetSource.open(server.options);
    expect(source.vfs.stat('INTERFACE\\panel.sti')).toMatchObject({ path: 'interface/panel.sti', size: 10, layer: 'http' });
    expect(decoded(await source.read('Interface/Panel.sti'))).toBe('0123456789');
    expect(decoded(await source.layer.read('interface/panel.sti', 2, 5))).toBe('234');
    expect(decoded(await source.read('sounds/door.wav'))).toBe('wave');
    expect(source.resolve('sounds/door.wav')?.path).toBe('stubs/sounds/door.wav');
    expect(await source.readOptional('sounds/none.wav')).toBeNull();
    await expect(source.read('sounds/none.wav')).rejects.toBeInstanceOf(VfsNotFoundError);
    expect(server.urls.filter((u) => u.includes('/vfs/')).every((u) => /\/vfs\/@[0-9a-f]{16}\//.test(u))).toBe(true);
  });

  it('reports a file that changed after the manifest as stale', async () => {
    const before = serverOver(new Vfs([new MemoryLayer('mem', [['maps/a9.dat', text('old map')]])]));
    const manifest = await fetchAssetManifest(before.options);
    const after = serverOver(new Vfs([new MemoryLayer('mem', [['maps/a9.dat', text('new map')]])]));
    const layer = new HttpVfsLayer(manifest, after.options);
    await expect(layer.read('maps/a9.dat', 0, 7)).rejects.toBeInstanceOf(StaleAssetError);
  });

  it('fetches a file once while it is in flight, counts the reads not finished and limits the parallel requests', async () => {
    const { fetcher, started } = blockingFetcher();
    const paths = files(30).map(([p]) => p);
    const layer = new HttpVfsLayer(manifestOf(paths), { fetch: fetcher });
    const first = layer.read(paths[0] as string, 0, 4);
    const again = layer.read(paths[0] as string, 0, 4);
    const rest = paths.slice(1).map((p) => layer.read(p, 0, 4));
    await flush();
    expect(started).toHaveLength(12);
    expect(layer.activeRequests).toBe(12);
    expect(layer.pendingReads).toBe(30);
    for (let i = 0; i < 40 && started.some((d) => !d.signal?.aborted); i++) {
      for (const d of started.splice(0)) d.release('data');
      await flush();
    }
    expect(decoded(await first)).toBe('data');
    expect(await again).toBe(await first);
    expect((await Promise.all(rest)).length).toBe(29);
    expect(layer.pendingReads).toBe(0);
  });

  it('names the oldest read not finished and its age, counting the queued ones', async () => {
    const { fetcher, started } = blockingFetcher();
    let now = 1000;
    const paths = files(20).map(([p]) => p);
    const layer = new HttpVfsLayer(manifestOf(paths), { fetch: fetcher, now: () => now });
    expect(layer.oldestRead()).toBeNull();
    const first = layer.read(paths[0] as string, 0, 4);
    now += 300;
    const rest = paths.slice(1).map((p) => layer.read(p, 0, 4));
    now += 200;
    await flush();
    expect(layer.oldestRead()).toEqual({ path: paths[0], ageMs: 500 });
    started[0]?.release('data');
    await first;
    expect(layer.oldestRead()).toEqual({ path: paths[1], ageMs: 200 });
    layer.abortAll();
    await Promise.allSettled(rest);
    expect(layer.oldestRead()).toBeNull();
  });

  it('keeps the parallel requests between 8 and 16', async () => {
    const paths = files(30).map(([p]) => p);
    for (const [asked, allowed] of [
      [2, MIN_CONCURRENCY],
      [99, MAX_CONCURRENCY],
    ] as const) {
      const { fetcher, started } = blockingFetcher();
      const layer = new HttpVfsLayer(manifestOf(paths), { fetch: fetcher, concurrency: asked });
      for (const p of paths) void layer.read(p, 0, 4).catch(() => {});
      await flush();
      expect(started).toHaveLength(allowed);
      layer.abortAll();
    }
  });

  it('aborts a read when its only reader gives up, and every read on abortAll', async () => {
    const { fetcher, started } = blockingFetcher();
    const layer = new HttpVfsLayer(manifestOf(['a.sti', 'b.sti', 'c.sti']), { fetch: fetcher });
    const controller = new AbortController();
    const shared = layer.read('a.sti', 0, 4);
    const abandoned = layer.read('a.sti', 0, 4, controller.signal);
    const alone = new AbortController();
    const lonely = layer.read('b.sti', 0, 4, alone.signal);
    await flush();
    controller.abort();
    alone.abort();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
    await expect(lonely).rejects.toMatchObject({ name: 'AbortError' });
    expect(started.find((d) => d.url.includes('a.sti'))?.signal?.aborted).toBe(false);
    expect(started.find((d) => d.url.includes('b.sti'))?.signal?.aborted).toBe(true);
    started.find((d) => d.url.includes('a.sti'))?.release('aaaa');
    expect(decoded(await shared)).toBe('aaaa');
    const last = layer.read('c.sti', 0, 4);
    await flush();
    layer.abortAll();
    await expect(last).rejects.toMatchObject({ name: 'AbortError' });
  });
});
