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

export async function fetchVfsList(): Promise<VfsFile[]> {
  const body = (await (await ok(await fetch('/api/vfs'))).json()) as { layers: string[]; files: [string, number, number][] };
  return body.files.map(([path, size, layer]) => ({ path, size, layer: body.layers[layer] ?? '?' }));
}

export async function fetchVfsFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await ok(await fetch(vfsUrl(path)))).arrayBuffer());
}

export async function fetchOptionalVfsFile(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const res = await fetch(vfsUrl(path));
  if (res.status === NOT_FOUND) return null;
  return new Uint8Array(await (await ok(res)).arrayBuffer());
}

export async function readVfsFileOrNull(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await fetchVfsFile(path);
  } catch {
    return null;
  }
}
