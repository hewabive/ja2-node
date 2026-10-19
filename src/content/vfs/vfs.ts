import { normalizeVfsPath } from './path.ts';

export interface VfsLayerEntry {
  readonly path: string;
  readonly size: number;
}

export interface VfsLayer {
  readonly name: string;
  entries(): Iterable<VfsLayerEntry>;
  read(path: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>>;
}

export interface VfsFileInfo {
  readonly path: string;
  readonly size: number;
  readonly layer: string;
}

export class Vfs {
  readonly layers: readonly VfsLayer[];
  readonly #index = new Map<string, { info: VfsFileInfo; layer: VfsLayer }>();
  #layerCounts: Map<string, number> | null = null;

  constructor(layers: readonly VfsLayer[]) {
    this.layers = layers;
    for (const layer of layers) {
      for (const e of layer.entries()) {
        if (!this.#index.has(e.path)) this.#index.set(e.path, { info: { path: e.path, size: e.size, layer: layer.name }, layer });
      }
    }
  }

  get size(): number {
    return this.#index.size;
  }

  layerCount(path: string): number {
    if (!this.#layerCounts) {
      const counts = new Map<string, number>();
      for (const layer of this.layers) for (const e of layer.entries()) counts.set(e.path, (counts.get(e.path) ?? 0) + 1);
      this.#layerCounts = counts;
    }
    return this.#layerCounts.get(normalizeVfsPath(path)) ?? 0;
  }

  stat(path: string): VfsFileInfo | undefined {
    return this.#index.get(normalizeVfsPath(path))?.info;
  }

  list(): VfsFileInfo[] {
    return [...this.#index.values()].map((v) => v.info).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async read(path: string, start = 0, end?: number): Promise<Uint8Array<ArrayBuffer>> {
    const hit = this.#index.get(normalizeVfsPath(path));
    if (!hit) throw new VfsNotFoundError(path);
    const stop = Math.min(end ?? hit.info.size, hit.info.size);
    if (start < 0 || start > stop) throw new RangeError(`bad range [${start}, ${end}) for ${path}`);
    return hit.layer.read(hit.info.path, start, stop);
  }
}

export function vfsFileReader(vfs: Pick<Vfs, 'stat' | 'read'>): (path: string) => Promise<Uint8Array<ArrayBuffer> | null> {
  return async (path) => (vfs.stat(path) ? vfs.read(path) : null);
}

export class VfsNotFoundError extends Error {
  override readonly name = 'VfsNotFoundError';
  readonly path: string;
  constructor(path: string) {
    super(`file not found in VFS: ${path}`);
    this.path = path;
  }
}

export class MemoryLayer implements VfsLayer {
  readonly name: string;
  readonly #files = new Map<string, Uint8Array>();

  constructor(name: string, files: Iterable<readonly [string, Uint8Array]> = []) {
    this.name = name;
    for (const [p, data] of files) this.#files.set(normalizeVfsPath(p), data);
  }

  *entries(): Iterable<VfsLayerEntry> {
    for (const [path, data] of this.#files) yield { path, size: data.length };
  }

  async read(path: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    const data = this.#files.get(path);
    if (!data) throw new VfsNotFoundError(path);
    return data.slice(start, end);
  }
}
