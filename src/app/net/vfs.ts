import { entryLayer } from '../../protocol/assets.ts';
import type { HttpAssetSource } from '../assets/asset-source.ts';
import { StaleAssetError } from '../assets/http-vfs-layer.ts';
import { pageAssetSource } from '../assets/page-assets.ts';

export interface Health {
  readonly ok: boolean;
  readonly data: { readonly original: boolean; readonly slf: number; readonly stubs: boolean };
  readonly dataVersion?: string;
  readonly files: number;
}

export interface VfsFile {
  readonly path: string;
  readonly size: number;
  readonly layer: string;
}

export type ReadVfsFile = (path: string) => Promise<Uint8Array<ArrayBuffer>>;

const NOT_FOUND = 404;

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.url}: HTTP ${res.status}`);
  return res;
}

export function vfsUrl(path: string): string {
  return `/vfs/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export async function fetchHealth(): Promise<Health> {
  return (await ok(await fetch('/api/health'))).json() as Promise<Health>;
}

async function viaManifest<T>(pinned: (source: HttpAssetSource) => Promise<T>, plain: () => Promise<T>): Promise<T> {
  const source = await pageAssetSource().catch(() => null);
  if (!source) return plain();
  try {
    return await pinned(source);
  } catch (err) {
    if (err instanceof StaleAssetError) return plain();
    throw err;
  }
}

function manifestListing(source: HttpAssetSource): VfsFile[] {
  const manifest = source.manifest;
  return manifest.files.map((e) => ({ path: e[0], size: e[1], layer: entryLayer(manifest, e) }));
}

async function fetchPlainVfsList(): Promise<VfsFile[]> {
  const body = (await (await ok(await fetch('/api/vfs'))).json()) as { layers: string[]; files: [string, number, number][] };
  return body.files.map(([path, size, layer]) => ({ path, size, layer: body.layers[layer] ?? '?' }));
}

async function fetchPlainVfsFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await ok(await fetch(vfsUrl(path)))).arrayBuffer());
}

async function fetchPlainOptionalVfsFile(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const res = await fetch(vfsUrl(path));
  if (res.status === NOT_FOUND) return null;
  return new Uint8Array(await (await ok(res)).arrayBuffer());
}

export function fetchVfsList(): Promise<VfsFile[]> {
  return viaManifest(async (source) => manifestListing(source), fetchPlainVfsList);
}

export function fetchVfsFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  return viaManifest(
    (source) => source.read(path),
    () => fetchPlainVfsFile(path),
  );
}

export function fetchOptionalVfsFile(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  return viaManifest(
    (source) => source.readOptional(path),
    () => fetchPlainOptionalVfsFile(path),
  );
}

export async function readVfsFileOrNull(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await fetchOptionalVfsFile(path);
  } catch {
    return null;
  }
}
