import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSET_MANIFEST_FORMAT, ASSET_MANIFEST_ROUTE, ASSET_MANIFEST_VERSION, pinnedAssetUrl } from '../../protocol/assets.ts';

const MAP = 'maps/a9.dat';
const STALE = 'tilesets/0/door1.jsd';
const MAP_HASH = '0123456789abcdef';
const STALE_HASH = 'fedcba9876543210';
const NOT_FOUND = 404;

const manifest = {
  format: ASSET_MANIFEST_FORMAT,
  version: ASSET_MANIFEST_VERSION,
  source: 'original',
  stubText: false,
  layers: ['data'],
  files: [
    [MAP, 3, MAP_HASH, 0],
    [STALE, 2, STALE_HASH, 0],
  ],
};

let requests: string[] = [];

function respond(url: string): Response {
  if (url === ASSET_MANIFEST_ROUTE) return Response.json(manifest);
  if (url === pinnedAssetUrl(MAP, MAP_HASH)) return new Response(new Uint8Array([1, 2, 3]));
  if (url === `/vfs/${STALE}`) return new Response(new Uint8Array([9, 9]));
  return new Response(null, { status: NOT_FOUND });
}

beforeEach(() => {
  requests = [];
  vi.resetModules();
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url);
    return respond(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('page file reads', () => {
  it('read a listed file through its pinned, immutably cached URL', async () => {
    const { fetchVfsFile } = await import('./vfs.ts');
    expect([...(await fetchVfsFile(MAP))]).toEqual([1, 2, 3]);
    expect(requests).toEqual([ASSET_MANIFEST_ROUTE, pinnedAssetUrl(MAP, MAP_HASH)]);
  });

  it('answer a file missing from the manifest without asking the server', async () => {
    const { readVfsFileOrNull, fetchOptionalVfsFile } = await import('./vfs.ts');
    expect(await fetchOptionalVfsFile('sounds/none.wav')).toBeNull();
    expect(await readVfsFileOrNull('sounds/none.wav')).toBeNull();
    expect(requests).toEqual([ASSET_MANIFEST_ROUTE]);
  });

  it('fall back to the plain URL when the server holds a newer file than the manifest', async () => {
    const { fetchVfsFile } = await import('./vfs.ts');
    expect([...(await fetchVfsFile(STALE))]).toEqual([9, 9]);
    expect(requests).toEqual([ASSET_MANIFEST_ROUTE, pinnedAssetUrl(STALE, STALE_HASH), `/vfs/${STALE}`]);
  });

  it('list the files from the manifest instead of /api/vfs', async () => {
    const { fetchVfsList } = await import('./vfs.ts');
    expect(await fetchVfsList()).toEqual([
      { path: MAP, size: 3, layer: 'data' },
      { path: STALE, size: 2, layer: 'data' },
    ]);
    expect(requests).toEqual([ASSET_MANIFEST_ROUTE]);
  });
});
