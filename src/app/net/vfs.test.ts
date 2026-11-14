import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSET_MANIFEST_FORMAT, ASSET_MANIFEST_ROUTE, ASSET_MANIFEST_VERSION, pinnedAssetUrl } from '../../protocol/assets.ts';

const MAP = 'maps/a9.dat';
const STALE = 'tilesets/0/door1.jsd';
const MAP_HASH = '0123456789abcdef';
const STALE_HASH = 'fedcba9876543210';
const CHANGED_HASH = '00112233aabbccdd';
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

const changedManifest = { ...manifest, files: [manifest.files[0], [STALE, 3, CHANGED_HASH, 0]] };

let requests: string[] = [];
let manifests = 0;

function respond(url: string): Response {
  if (url === ASSET_MANIFEST_ROUTE) return Response.json(manifests++ === 0 ? manifest : changedManifest);
  if (url === pinnedAssetUrl(MAP, MAP_HASH)) return new Response(new Uint8Array([1, 2, 3]));
  if (url === pinnedAssetUrl(STALE, CHANGED_HASH)) return new Response(new Uint8Array([9, 9, 9]));
  return new Response(null, { status: NOT_FOUND });
}

beforeEach(() => {
  requests = [];
  manifests = 0;
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

  it('read a file the server holds newer than the manifest under its hash in the manifest fetched again', async () => {
    const { fetchVfsFile } = await import('./vfs.ts');
    expect([...(await fetchVfsFile(STALE))]).toEqual([9, 9, 9]);
    expect(requests).toEqual([
      ASSET_MANIFEST_ROUTE,
      pinnedAssetUrl(STALE, STALE_HASH),
      ASSET_MANIFEST_ROUTE,
      pinnedAssetUrl(STALE, CHANGED_HASH),
    ]);
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
