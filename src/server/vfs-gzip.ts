import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

const ALREADY_COMPRESSED: ReadonlySet<string> = new Set(['ogg', 'mp3', 'smk', 'bik', 'png', 'jpg', 'jpeg', 'gz', 'zip']);
const MIN_BYTES = 1024;
const MAX_KEPT_RATIO = 0.9;
export const DEFAULT_GZIP_CACHE_BYTES = 64 << 20;

interface Entry {
  readonly body: Promise<Uint8Array | null>;
  bytes: number;
}

export function worthCompressing(extension: string, size: number): boolean {
  return size >= MIN_BYTES && !ALREADY_COMPRESSED.has(extension);
}

export class VfsGzipCache {
  readonly #limit: number;
  readonly #entries = new Map<string, Entry>();
  #bytes = 0;

  constructor(limit = DEFAULT_GZIP_CACHE_BYTES) {
    this.#limit = limit;
  }

  get bytes(): number {
    return this.#bytes;
  }

  compressed(hash: string, read: () => Promise<Uint8Array>): Promise<Uint8Array | null> {
    const known = this.#entries.get(hash);
    if (known) {
      this.#entries.delete(hash);
      this.#entries.set(hash, known);
      return known.body;
    }
    const entry: Entry = { body: this.#compress(read), bytes: 0 };
    this.#entries.set(hash, entry);
    entry.body.then(
      (body) => this.#settle(hash, entry, body?.length ?? 0),
      () => this.#entries.delete(hash),
    );
    return entry.body;
  }

  async #compress(read: () => Promise<Uint8Array>): Promise<Uint8Array | null> {
    const raw = await read();
    const packed = new Uint8Array(await gzipAsync(raw));
    return packed.length <= raw.length * MAX_KEPT_RATIO ? packed : null;
  }

  #settle(hash: string, entry: Entry, bytes: number): void {
    if (this.#entries.get(hash) !== entry) return;
    entry.bytes = bytes;
    this.#bytes += bytes;
    for (const [oldest, old] of this.#entries) {
      if (this.#bytes <= this.#limit || old === entry) break;
      this.#entries.delete(oldest);
      this.#bytes -= old.bytes;
    }
  }
}
