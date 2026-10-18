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

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.url}: HTTP ${res.status}`);
  return res;
}

export async function fetchHealth(): Promise<Health> {
  return (await ok(await fetch('/api/health'))).json() as Promise<Health>;
}

export async function fetchVfsList(): Promise<VfsFile[]> {
  const body = (await (await ok(await fetch('/api/vfs'))).json()) as { layers: string[]; files: [string, number, number][] };
  return body.files.map(([path, size, layer]) => ({ path, size, layer: body.layers[layer] ?? '?' }));
}

export async function fetchFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const url = `/vfs/${path.split('/').map(encodeURIComponent).join('/')}`;
  return new Uint8Array(await (await ok(await fetch(url))).arrayBuffer());
}
