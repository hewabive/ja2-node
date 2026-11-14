import { joinVfsPath } from '../../content/vfs/path.ts';
import { Vfs, type VfsFileInfo, VfsNotFoundError } from '../../content/vfs/vfs.ts';
import type { AssetManifest } from '../../protocol/assets.ts';
import { fetchAssetManifest, type HttpAssetOptions, HttpVfsLayer, StaleAssetError } from './http-vfs-layer.ts';

export const STUB_TEXT_PREFIX = 'stubs';

export interface AssetSource {
  readonly vfs: Vfs;
  readonly manifest: AssetManifest;
  resolve(path: string): VfsFileInfo | undefined;
  hashOf(path: string): string | null;
  read(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
  readOptional(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null>;
  abortAll(): void;
}

export class HttpAssetSource implements AssetSource {
  readonly layer: HttpVfsLayer;
  readonly #options: HttpAssetOptions;
  #vfs: Vfs;
  #refetching: Promise<void> | null = null;

  constructor(manifest: AssetManifest, options: HttpAssetOptions = {}) {
    this.layer = new HttpVfsLayer(manifest, options);
    this.#options = options;
    this.#vfs = new Vfs([this.layer]);
  }

  static async open(options: HttpAssetOptions = {}): Promise<HttpAssetSource> {
    return new HttpAssetSource(await fetchAssetManifest(options), options);
  }

  get vfs(): Vfs {
    return this.#vfs;
  }

  get manifest(): AssetManifest {
    return this.layer.manifest;
  }

  resolve(path: string): VfsFileInfo | undefined {
    return this.vfs.stat(path) ?? (this.manifest.stubText ? this.vfs.stat(joinVfsPath(STUB_TEXT_PREFIX, path)) : undefined);
  }

  hashOf(path: string): string | null {
    const info = this.resolve(path);
    return info ? this.layer.hashOf(info.path) : null;
  }

  async read(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const hash = this.hashOf(path);
    try {
      return await this.#readListed(path, signal);
    } catch (err) {
      if (!(err instanceof StaleAssetError)) throw err;
      if (this.hashOf(path) === hash) await this.#refetchManifest();
      return this.#readListed(path, signal);
    }
  }

  async readOptional(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
    return this.resolve(path) ? this.read(path, signal) : null;
  }

  abortAll(): void {
    this.layer.abortAll();
  }

  #readListed(path: string, signal: AbortSignal | undefined): Promise<Uint8Array<ArrayBuffer>> {
    const info = this.resolve(path);
    if (!info) return Promise.reject(new VfsNotFoundError(path));
    return this.layer.read(info.path, 0, info.size, signal);
  }

  #refetchManifest(): Promise<void> {
    this.#refetching ??= fetchAssetManifest(this.#options)
      .then((manifest) => {
        this.layer.useManifest(manifest);
        this.#vfs = new Vfs([this.layer]);
      })
      .finally(() => {
        this.#refetching = null;
      });
    return this.#refetching;
  }
}
