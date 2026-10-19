import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { VFS_ALIASES_FILE } from '../content/vfs/aliases.ts';
import { PROJECT_DATA_LAYER, STUBS_LAYER } from '../content/vfs/layers.ts';
import { Vfs, type VfsLayer } from '../content/vfs/vfs.ts';
import { DirLayer } from './dir-layer.ts';
import { SlfFileLayer } from './slf-layer.ts';

export const STUBS_PREFIX = 'stubs';

export interface DataVfsOptions {
  readonly projectDataDir?: string | undefined;
  readonly dataDir?: string | undefined;
  readonly stubsDir?: string | undefined;
}

export interface DataVfs {
  readonly vfs: Vfs;
  readonly dataDir: string | null;
  readonly slfCount: number;
  readonly stubsDir: string | null;
  close(): Promise<void>;
}

async function listSlf(dir: string): Promise<string[]> {
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.slf'))
    .map((d) => d.name);
  return names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));
}

export async function resolveDataDir(dir: string): Promise<string> {
  const abs = resolve(dir);
  if (!existsSync(abs)) throw new Error(`JA2 data directory does not exist: ${abs}`);
  if ((await listSlf(abs)).length > 0) return abs;
  const sub = (await readdir(abs, { withFileTypes: true })).find((d) => d.isDirectory() && d.name.toLowerCase() === 'data');
  if (sub && (await listSlf(join(abs, sub.name))).length > 0) return join(abs, sub.name);
  throw new Error(`no *.slf files in ${abs} or its Data subdirectory`);
}

export async function openDataVfs(options: DataVfsOptions): Promise<DataVfs> {
  const layers: VfsLayer[] = [];
  const slfs: SlfFileLayer[] = [];
  let dataDir: string | null = null;
  try {
    if (options.projectDataDir && existsSync(options.projectDataDir)) {
      layers.push(await DirLayer.open(PROJECT_DATA_LAYER, resolve(options.projectDataDir)));
    }
    if (options.dataDir) {
      dataDir = await resolveDataDir(options.dataDir);
      layers.push(await DirLayer.open('data-dir', dataDir, { skipExtensions: ['slf'] }));
      for (const name of await listSlf(dataDir)) {
        const slf = await SlfFileLayer.open(join(dataDir, name));
        slfs.push(slf);
        layers.push(slf);
      }
    }
    let stubsDir: string | null = null;
    if (options.stubsDir && existsSync(options.stubsDir)) {
      stubsDir = resolve(options.stubsDir);
      layers.push(await DirLayer.open(STUBS_LAYER, stubsDir, { prefix: STUBS_PREFIX, aliasFile: VFS_ALIASES_FILE }));
    }
    return {
      vfs: new Vfs(layers),
      dataDir,
      slfCount: slfs.length,
      stubsDir,
      close: async () => {
        await Promise.all(slfs.map((s) => s.close()));
      },
    };
  } catch (err) {
    await Promise.all(slfs.map((s) => s.close()));
    throw err;
  }
}
