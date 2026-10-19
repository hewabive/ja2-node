import type { AssetSource } from './asset-source.ts';

export const DEFAULT_ASSET_CACHE_BYTES = 256 * 1024 * 1024;

export interface AssetDecoder<T> {
  readonly name: string;
  decode(bytes: Uint8Array<ArrayBuffer>, path: string): T | Promise<T>;
  size(value: T): number;
}

export const RAW_BYTES: AssetDecoder<Uint8Array<ArrayBuffer>> = {
  name: 'bytes',
  decode: (bytes) => bytes,
  size: (bytes) => bytes.byteLength,
};

interface CachedAsset {
  readonly value: unknown;
  readonly bytes: number;
}

export interface AssetCacheOptions {
  readonly maxBytes?: number;
}

function keyOf(hash: string, decoder: AssetDecoder<unknown>): string {
  return `${hash}\u0000${decoder.name}`;
}

export class AssetCache {
  readonly maxBytes: number;
  readonly #entries = new Map<string, CachedAsset>();
  readonly #pending = new Map<string, Promise<unknown>>();
  #bytes = 0;

  constructor(options: AssetCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_ASSET_CACHE_BYTES;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  get<T>(hash: string, decoder: AssetDecoder<T>): T | undefined {
    const key = keyOf(hash, decoder as AssetDecoder<unknown>);
    const hit = this.#entries.get(key);
    if (!hit) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, hit);
    return hit.value as T;
  }

  has<T>(hash: string, decoder: AssetDecoder<T>): boolean {
    return this.#entries.has(keyOf(hash, decoder as AssetDecoder<unknown>));
  }

  put<T>(hash: string, decoder: AssetDecoder<T>, value: T): void {
    const key = keyOf(hash, decoder as AssetDecoder<unknown>);
    this.#remove(key);
    const bytes = decoder.size(value);
    if (bytes > this.maxBytes) return;
    this.#entries.set(key, { value, bytes });
    this.#bytes += bytes;
    this.#evict();
  }

  load<T>(hash: string, decoder: AssetDecoder<T>, bytes: () => Promise<Uint8Array<ArrayBuffer>>, path = hash): Promise<T> {
    const known = this.get(hash, decoder);
    if (known !== undefined) return Promise.resolve(known);
    const key = keyOf(hash, decoder as AssetDecoder<unknown>);
    const pending = this.#pending.get(key);
    if (pending) return pending as Promise<T>;
    const loading = (async () => {
      const raw = decoder === (RAW_BYTES as AssetDecoder<unknown>) ? undefined : this.get(hash, RAW_BYTES);
      const value = await decoder.decode(raw ?? (await bytes()), path);
      this.put(hash, decoder, value);
      return value;
    })().finally(() => this.#pending.delete(key));
    this.#pending.set(key, loading);
    return loading;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }

  #remove(key: string): void {
    const old = this.#entries.get(key);
    if (!old) return;
    this.#entries.delete(key);
    this.#bytes -= old.bytes;
  }

  #evict(): void {
    for (const [key, entry] of this.#entries) {
      if (this.#bytes <= this.maxBytes) return;
      this.#entries.delete(key);
      this.#bytes -= entry.bytes;
    }
  }
}

export function loadDecodedAsset<T>(
  source: AssetSource,
  cache: AssetCache,
  path: string,
  decoder: AssetDecoder<T>,
  signal?: AbortSignal,
): Promise<T> {
  const hash = source.hashOf(path);
  if (hash === null) return Promise.reject(new Error(`no asset ${path} in the manifest`));
  return cache.load(hash, decoder, () => source.read(path, signal), path);
}
