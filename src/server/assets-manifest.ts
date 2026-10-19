import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CONTENT_HASH_LENGTH, contentHashOf } from '../content/rules/pack.ts';
import type { Vfs } from '../content/vfs/vfs.ts';

export const VFS_HASHES_FILE = 'vfs-hashes.json';
export const ASSET_MANIFEST_FORMAT = 'ja2-node-assets';
export const ASSET_MANIFEST_VERSION = 1;
const HASHES_FORMAT = 'ja2-node vfs hashes';
const HASHES_VERSION = 1;
const HASHING_CONCURRENCY = 8;
const PERSIST_DELAY_MS = 2000;
const STAMP_FILE_FIELD = 0;
const STAMP_SEPARATOR = '\t';

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

export interface EncodedAssetManifest {
  readonly json: Uint8Array;
  readonly gzip: Uint8Array;
  readonly etag: string;
}

interface StoredHashes {
  readonly format: typeof HASHES_FORMAT;
  readonly version: number;
  readonly hashes: Readonly<Record<string, string>>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stampFile(stamp: string): string {
  return stamp.split(STAMP_SEPARATOR)[STAMP_FILE_FIELD] ?? '';
}

async function readStored(file: string): Promise<Map<string, string>> {
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as Partial<StoredHashes>;
    if (stored.format !== HASHES_FORMAT || stored.version !== HASHES_VERSION || !stored.hashes) return new Map();
    return new Map(Object.entries(stored.hashes).filter(([, hash]) => typeof hash === 'string'));
  } catch {
    return new Map();
  }
}

export function isContentHash(value: string): boolean {
  return value.length === CONTENT_HASH_LENGTH && /^[0-9a-f]+$/.test(value);
}

export class VfsHashes {
  readonly vfs: Vfs;
  readonly #file: string | null;
  readonly #byStamp: Map<string, string>;
  readonly #byPath = new Map<string, string>();
  readonly #pending = new Map<string, Promise<string>>();
  #persistTimer: ReturnType<typeof setTimeout> | null = null;
  #dirty = false;

  private constructor(vfs: Vfs, file: string | null, known: Map<string, string>) {
    this.vfs = vfs;
    this.#file = file;
    this.#byStamp = known;
  }

  static async open(vfs: Vfs, cacheDir: string | null): Promise<VfsHashes> {
    const file = cacheDir ? join(cacheDir, VFS_HASHES_FILE) : null;
    return new VfsHashes(vfs, file, file ? await readStored(file) : new Map());
  }

  static memory(vfs: Vfs): VfsHashes {
    return new VfsHashes(vfs, null, new Map());
  }

  #known(path: string): string | null {
    const stamp = this.vfs.stamp(path);
    return (stamp === null ? this.#byPath.get(path) : this.#byStamp.get(stamp)) ?? null;
  }

  readonly remember = (path: string, digest: string): void => {
    const info = this.vfs.stat(path);
    if (!info) return;
    const stamp = this.vfs.stamp(info.path);
    if (stamp === null) {
      this.#byPath.set(info.path, digest);
      return;
    }
    if (this.#byStamp.get(stamp) === digest) return;
    this.#byStamp.set(stamp, digest);
    this.#schedulePersist();
  };

  async sha256(path: string): Promise<string> {
    const info = this.vfs.stat(path);
    if (!info) throw new Error(`not in the VFS: ${path}`);
    const known = this.#known(info.path);
    if (known) return known;
    let pending = this.#pending.get(info.path);
    if (!pending) {
      pending = this.vfs.read(info.path).then((bytes) => {
        const digest = sha256(bytes);
        this.remember(info.path, digest);
        this.#pending.delete(info.path);
        return digest;
      });
      this.#pending.set(info.path, pending);
    }
    return pending;
  }

  async contentHash(path: string): Promise<string> {
    return contentHashOf(await this.sha256(path));
  }

  async manifest(source: AssetManifest['source'], stubText: boolean): Promise<AssetManifest> {
    const listing = this.vfs.list();
    const hashes = new Array<string>(listing.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < listing.length; i = next++) hashes[i] = await this.contentHash((listing[i] as { path: string }).path);
    };
    await Promise.all(Array.from({ length: HASHING_CONCURRENCY }, worker));
    await this.flush();
    const files = listing.map((f, i): AssetManifestEntry => {
      const layers = this.vfs.layerCount(f.path);
      const hash = hashes[i] as string;
      return layers > 1 ? [f.path, f.size, hash, layers] : [f.path, f.size, hash];
    });
    return { format: ASSET_MANIFEST_FORMAT, version: ASSET_MANIFEST_VERSION, source, stubText, files };
  }

  #schedulePersist(): void {
    this.#dirty = true;
    if (!this.#file || this.#persistTimer) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      void this.flush();
    }, PERSIST_DELAY_MS);
    this.#persistTimer.unref?.();
  }

  #ownFiles(): Set<string> {
    const files = new Set<string>();
    for (const f of this.vfs.list()) {
      const stamp = this.vfs.stamp(f.path);
      if (stamp !== null) files.add(stampFile(stamp));
    }
    return files;
  }

  async flush(): Promise<void> {
    if (!this.#file || !this.#dirty) return;
    this.#dirty = false;
    const own = this.#ownFiles();
    const current = new Set<string>();
    for (const f of this.vfs.list()) {
      const stamp = this.vfs.stamp(f.path);
      if (stamp !== null) current.add(stamp);
    }
    const merged: Record<string, string> = {};
    for (const [stamp, digest] of await readStored(this.#file)) if (!own.has(stampFile(stamp))) merged[stamp] = digest;
    for (const [stamp, digest] of this.#byStamp) if (current.has(stamp)) merged[stamp] = digest;
    const stored: StoredHashes = { format: HASHES_FORMAT, version: HASHES_VERSION, hashes: merged };
    await mkdir(join(this.#file, '..'), { recursive: true });
    const temp = `${this.#file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(stored));
    await rename(temp, this.#file);
  }
}

export function encodeAssetManifest(manifest: AssetManifest): EncodedAssetManifest {
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  return { json, gzip: gzipSync(json), etag: `"${contentHashOf(sha256(json))}"` };
}
