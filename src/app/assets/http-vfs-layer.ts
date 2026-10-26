import { normalizeVfsPath } from '../../content/vfs/path.ts';
import { type VfsLayer, type VfsLayerEntry, VfsNotFoundError } from '../../content/vfs/vfs.ts';
import {
  ASSET_MANIFEST_ROUTE,
  type AssetManifest,
  type AssetManifestEntry,
  entryLayers,
  parseAssetManifest,
  pinnedAssetUrl,
} from '../../protocol/assets.ts';

export const HTTP_LAYER_NAME = 'http';
export const DEFAULT_CONCURRENCY = 12;
export const MIN_CONCURRENCY = 8;
export const MAX_CONCURRENCY = 16;
const NOT_FOUND = 404;
const PARTIAL_CONTENT = 206;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpAssetOptions {
  readonly fetch?: Fetcher;
  readonly baseUrl?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly concurrency?: number;
}

export class StaleAssetError extends Error {
  override readonly name = 'StaleAssetError';
  readonly path: string;

  constructor(path: string) {
    super(`${path} changed on the server: fetch the asset manifest again`);
    this.path = path;
  }
}

export class AssetFetchError extends Error {
  override readonly name = 'AssetFetchError';
  readonly status: number;

  constructor(url: string, status: number) {
    super(`GET ${url} answered ${status}`);
    this.status = status;
  }
}

function abortError(): DOMException {
  return new DOMException('the asset read was aborted', 'AbortError');
}

function clampConcurrency(value: number | undefined): number {
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, value ?? DEFAULT_CONCURRENCY));
}

class Slots {
  readonly #limit: number;
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  get running(): number {
    return this.#running;
  }

  async run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    await this.#acquire(signal);
    try {
      return await work();
    } finally {
      this.#release();
    }
  }

  #acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.#running < this.#limit) {
      this.#running++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', cancel);
        this.#running++;
        resolve();
      };
      const cancel = () => {
        const at = this.#waiting.indexOf(start);
        if (at >= 0) this.#waiting.splice(at, 1);
        reject(abortError());
      };
      signal.addEventListener('abort', cancel, { once: true });
      this.#waiting.push(start);
    });
  }

  #release(): void {
    this.#running--;
    this.#waiting.shift()?.();
  }
}

interface SharedRead {
  readonly controller: AbortController;
  readonly result: Promise<Uint8Array<ArrayBuffer>>;
  waiters: number;
}

export class HttpVfsLayer implements VfsLayer {
  readonly name = HTTP_LAYER_NAME;
  readonly manifest: AssetManifest;
  readonly #entries: ReadonlyMap<string, AssetManifestEntry>;
  readonly #fetch: Fetcher;
  readonly #baseUrl: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #slots: Slots;
  readonly #inFlight = new Map<string, SharedRead>();
  #lifetime = new AbortController();

  constructor(manifest: AssetManifest, options: HttpAssetOptions = {}) {
    this.manifest = manifest;
    this.#entries = new Map(manifest.files.map((e) => [normalizeVfsPath(e[0]), e]));
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#baseUrl = options.baseUrl ?? '';
    this.#headers = options.headers ?? {};
    this.#slots = new Slots(clampConcurrency(options.concurrency));
  }

  get activeRequests(): number {
    return this.#slots.running;
  }

  get pendingReads(): number {
    return this.#inFlight.size;
  }

  *entries(): Iterable<VfsLayerEntry> {
    for (const [path, e] of this.#entries) yield { path, size: e[1] };
  }

  hashOf(path: string): string | null {
    return this.#entries.get(normalizeVfsPath(path))?.[2] ?? null;
  }

  layerCount(path: string): number {
    const entry = this.#entries.get(normalizeVfsPath(path));
    return entry ? entryLayers(entry) : 0;
  }

  stamp(path: string): string | null {
    return this.hashOf(path);
  }

  abortAll(): void {
    this.#lifetime.abort();
    this.#lifetime = new AbortController();
  }

  read(path: string, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const entry = this.#entries.get(path);
    if (!entry) return Promise.reject(new VfsNotFoundError(path));
    const whole = start === 0 && end === entry[1];
    const key = whole ? path : `${path}#${start}-${end}`;
    let shared = this.#inFlight.get(key);
    if (!shared) {
      shared = this.#start(entry, whole ? null : { start, end });
      const started = shared;
      this.#inFlight.set(key, started);
      started.result.then(
        () => this.#inFlight.delete(key),
        () => this.#inFlight.delete(key),
      );
    }
    return this.#wait(shared, signal);
  }

  #start(entry: AssetManifestEntry, range: { start: number; end: number } | null): SharedRead {
    const controller = new AbortController();
    const lifetime = this.#lifetime.signal;
    const abortOnLifetime = () => controller.abort();
    lifetime.addEventListener('abort', abortOnLifetime, { once: true });
    const result = this.#slots
      .run(() => this.#download(entry, range, controller.signal), controller.signal)
      .finally(() => lifetime.removeEventListener('abort', abortOnLifetime));
    return { controller, result, waiters: 0 };
  }

  async #download(
    entry: AssetManifestEntry,
    range: { start: number; end: number } | null,
    signal: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const [path, , hash] = entry;
    const url = `${this.#baseUrl}${pinnedAssetUrl(path, hash)}`;
    const headers: Record<string, string> = { ...this.#headers, ...(range ? { range: `bytes=${range.start}-${range.end - 1}` } : {}) };
    const response = await this.#fetch(url, { headers, signal });
    if (response.status === NOT_FOUND) throw new StaleAssetError(path);
    if (!response.ok) throw new AssetFetchError(url, response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (range && response.status !== PARTIAL_CONTENT) return bytes.slice(range.start, range.end);
    return bytes;
  }

  #wait(shared: SharedRead, signal: AbortSignal | undefined): Promise<Uint8Array<ArrayBuffer>> {
    shared.waiters++;
    if (!signal) return shared.result;
    if (signal.aborted) return this.#leave(shared, Promise.reject(abortError()));
    return new Promise((resolve, reject) => {
      const abandon = () => {
        reject(abortError());
        this.#leave(shared, null);
      };
      signal.addEventListener('abort', abandon, { once: true });
      shared.result.then(
        (bytes) => {
          signal.removeEventListener('abort', abandon);
          resolve(bytes);
        },
        (err: unknown) => {
          signal.removeEventListener('abort', abandon);
          reject(err);
        },
      );
    });
  }

  #leave<T>(shared: SharedRead, outcome: T): T {
    shared.waiters--;
    if (shared.waiters <= 0) shared.controller.abort();
    return outcome;
  }
}

export async function fetchAssetManifest(options: HttpAssetOptions = {}): Promise<AssetManifest> {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const url = `${options.baseUrl ?? ''}${ASSET_MANIFEST_ROUTE}`;
  const response = await doFetch(url, { headers: { ...(options.headers ?? {}) } });
  if (!response.ok) throw new AssetFetchError(url, response.status);
  return parseAssetManifest(await response.json());
}
