import { type AssetCache, RAW_BYTES } from './asset-cache.ts';
import type { AssetSource } from './asset-source.ts';

export interface PreloadProgress {
  readonly done: number;
  readonly total: number;
  readonly bytes: number;
  readonly totalBytes: number;
  readonly path: string;
}

export interface PreloadOptions {
  readonly cache?: AssetCache;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PreloadProgress) => void;
}

export interface PreloadResult {
  readonly loaded: readonly string[];
  readonly missing: readonly string[];
  readonly bytes: number;
}

export async function preloadAssets(source: AssetSource, paths: Iterable<string>, options: PreloadOptions = {}): Promise<PreloadResult> {
  const unique = [...new Set(paths)];
  const present = unique.filter((path) => source.resolve(path) !== undefined);
  const missing = unique.filter((path) => source.resolve(path) === undefined);
  const totalBytes = present.reduce((sum, path) => sum + (source.resolve(path)?.size ?? 0), 0);
  let done = 0;
  let bytes = 0;
  const loadOne = async (path: string): Promise<void> => {
    const hash = source.hashOf(path);
    const cached = options.cache && hash !== null ? options.cache.get(hash, RAW_BYTES) : undefined;
    const data = cached ?? (await source.read(path, options.signal));
    if (options.cache && hash !== null && !cached) options.cache.put(hash, RAW_BYTES, data);
    done++;
    bytes += data.byteLength;
    options.onProgress?.({ done, total: present.length, bytes, totalBytes, path });
  };
  await Promise.all(present.map(loadOne));
  return { loaded: present, missing, bytes };
}
