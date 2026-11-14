import type { Stats } from 'node:fs';
import { type FileHandle, open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVfsAliases } from '../content/vfs/aliases.ts';
import { joinVfsPath, vfsExtension } from '../content/vfs/path.ts';
import { VfsChangedError, type VfsChangeListener, type VfsLayer, type VfsLayerEntry, VfsNotFoundError } from '../content/vfs/vfs.ts';
import { readExactly } from './file-range.ts';

export interface DirLayerOptions {
  readonly prefix?: string;
  readonly skipExtensions?: readonly string[];
  readonly aliasFile?: string;
}

interface FileStamp {
  readonly size: number;
  readonly mtimeMs: number;
}

interface DirFile {
  readonly abs: string;
  stamp: FileStamp;
  refreshes: number;
}

type DirFiles = Map<string, DirFile>;

function stampOf(info: Stats): FileStamp {
  return { size: info.size, mtimeMs: info.mtimeMs };
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function addAliases(files: DirFiles, prefix: string, aliasFile: string): Promise<void> {
  const manifest = files.get(joinVfsPath(prefix, aliasFile));
  if (!manifest) return;
  for (const [alias, target] of parseVfsAliases(JSON.parse(await readFile(manifest.abs, 'utf8')))) {
    const path = joinVfsPath(prefix, alias);
    const file = files.get(joinVfsPath(prefix, target));
    if (!file) throw new Error(`vfs alias ${alias} points at a missing file ${target} in ${aliasFile}`);
    if (!files.has(path)) files.set(path, file);
  }
}

export class DirLayer implements VfsLayer {
  readonly name: string;
  readonly root: string;
  readonly #files: DirFiles;
  readonly #listeners: VfsChangeListener[] = [];

  private constructor(name: string, root: string, files: DirFiles) {
    this.name = name;
    this.root = root;
    this.#files = files;
  }

  static async open(name: string, root: string, options: DirLayerOptions = {}): Promise<DirLayer> {
    const skip = new Set(options.skipExtensions ?? []);
    const files: DirFiles = new Map();
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
          files.set(path, { abs, stamp: stampOf(await stat(abs)), refreshes: 0 });
        }
      }
    };
    await walk(root, '');
    if (options.aliasFile) await addAliases(files, options.prefix ?? '', options.aliasFile);
    return new DirLayer(name, root, files);
  }

  *entries(): Iterable<VfsLayerEntry> {
    for (const [path, f] of this.#files) yield { path, size: f.stamp.size };
  }

  stamp(path: string): string | null {
    const f = this.#files.get(path);
    return f ? [f.abs, f.stamp.size, f.stamp.mtimeMs].join('\t') : null;
  }

  onChange(listener: VfsChangeListener): void {
    this.#listeners.push(listener);
  }

  async read(path: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    const f = this.#files.get(path);
    if (!f) throw new VfsNotFoundError(path);
    const handle = await open(f.abs, 'r');
    try {
      const listed = await this.#expectStamp(path, f, handle, f.stamp);
      try {
        return await readExactly(handle, start, end - start);
      } finally {
        await this.#expectStamp(path, f, handle, listed);
      }
    } finally {
      await handle.close();
    }
  }

  async refresh(): Promise<void> {
    await Promise.all([...new Set(this.#files.values())].map((file) => this.#refresh(file)));
  }

  async #expectStamp(path: string, file: DirFile, handle: FileHandle, expected: FileStamp): Promise<FileStamp> {
    const current = stampOf(await handle.stat());
    if (sameStamp(current, expected)) return current;
    await this.#refresh(file);
    throw new VfsChangedError(path);
  }

  #restamp(file: DirFile, stamp: FileStamp): void {
    if (sameStamp(file.stamp, stamp)) return;
    file.stamp = stamp;
    for (const [path, f] of this.#files) {
      if (f === file) for (const listener of this.#listeners) listener({ path, size: stamp.size });
    }
  }

  async #refresh(file: DirFile): Promise<void> {
    const refresh = ++file.refreshes;
    const info = await stat(file.abs).catch(() => null);
    if (info && refresh === file.refreshes) this.#restamp(file, stampOf(info));
  }
}
