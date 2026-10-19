export const ASSET_MANIFEST_FORMAT = 'ja2-node-assets';
export const ASSET_MANIFEST_VERSION = 1;
export const ASSET_MANIFEST_ROUTE = '/api/assets/manifest';
export const VFS_ROUTE = '/vfs/';
export const PINNED_PREFIX = '@';
export const ASSET_HASH_LENGTH = 16;

export type AssetManifestEntry =
  | readonly [path: string, size: number, hash: string]
  | readonly [path: string, size: number, hash: string, layers: number];

export interface AssetManifest {
  readonly format: typeof ASSET_MANIFEST_FORMAT;
  readonly version: number;
  readonly source: 'original' | 'stubs';
  readonly stubText: boolean;
  readonly files: readonly AssetManifestEntry[];
}

const HASH_PATTERN = /^[0-9a-f]+$/;

export function isAssetHash(value: string): boolean {
  return value.length === ASSET_HASH_LENGTH && HASH_PATTERN.test(value);
}

function isEntry(value: unknown): value is AssetManifestEntry {
  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4)) return false;
  const [path, size, hash, layers] = value as unknown[];
  return (
    typeof path === 'string' &&
    typeof size === 'number' &&
    typeof hash === 'string' &&
    isAssetHash(hash) &&
    (layers === undefined || typeof layers === 'number')
  );
}

export function parseAssetManifest(value: unknown): AssetManifest {
  const m = value as Partial<AssetManifest> | null;
  if (typeof m !== 'object' || m === null || m.format !== ASSET_MANIFEST_FORMAT) throw new Error('not a ja2-node asset manifest');
  if (m.version !== ASSET_MANIFEST_VERSION) throw new Error(`asset manifest version ${String(m.version)} is not ${ASSET_MANIFEST_VERSION}`);
  if (m.source !== 'original' && m.source !== 'stubs') throw new Error('asset manifest source must be original or stubs');
  if (typeof m.stubText !== 'boolean' || !Array.isArray(m.files) || !m.files.every(isEntry)) throw new Error('bad asset manifest');
  return m as AssetManifest;
}

export function entryLayers(entry: AssetManifestEntry): number {
  return entry[3] ?? 1;
}

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function pinnedAssetUrl(path: string, hash: string): string {
  return `${VFS_ROUTE}${PINNED_PREFIX}${hash}/${encodedPath(path)}`;
}

export function plainAssetUrl(path: string): string {
  return `${VFS_ROUTE}${encodedPath(path)}`;
}
