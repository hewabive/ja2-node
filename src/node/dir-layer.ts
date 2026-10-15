import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { joinVfsPath, vfsExtension } from '../content/vfs/path.ts';
import { type VfsLayer, type VfsLayerEntry, VfsNotFoundError } from '../content/vfs/vfs.ts';
import { readExactly } from './file-range.ts';

export interface DirLayerOptions {
  readonly prefix?: string;
  readonly skipExtensions?: readonly string[];
}

export class DirLayer implements VfsLayer {
  readonly name: string;
  readonly root: string;
  readonly #files: Map<string, { abs: string; size: number }>;

  private constructor(name: string, root: string, files: Map<string, { abs: string; size: number }>) {
    this.name = name;
    this.root = root;
    this.#files = files;
  }

  static async open(name: string, root: string, options: DirLayerOptions = {}): Promise<DirLayer> {
    const skip = new Set(options.skipExtensions ?? []);
    const files = new Map<string, { abs: string; size: number }>();
    const walk = async (dir: string, rel: string): Promise<void> => {
      const items = await readdir(dir, { withFileTypes: true });
      items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const it of items) {
        const abs = join(dir, it.name);
        const relPath = rel === '' ? it.name : `${rel}/${it.name}`;
        if (it.isDirectory()) {
          await walk(abs, relPath);
        } else if (it.isFile()) {
          const path = joinVfsPath(options.prefix ?? '', relPath);
          if (skip.has(vfsExtension(path)) || files.has(path)) continue;
          files.set(path, { abs, size: (await stat(abs)).size });
        }
      }
    };
    await walk(root, '');
    return new DirLayer(name, root, files);
  }

  *entries(): Iterable<VfsLayerEntry> {
    for (const [path, f] of this.#files) yield { path, size: f.size };
  }

  async read(path: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    const f = this.#files.get(path);
    if (!f) throw new VfsNotFoundError(path);
    const handle = await open(f.abs, 'r');
    try {
      return await readExactly(handle, start, end - start);
    } finally {
      await handle.close();
    }
  }
}
