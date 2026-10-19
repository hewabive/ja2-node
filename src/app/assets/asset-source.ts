import { joinVfsPath } from '../../content/vfs/path.ts';
import { Vfs, type VfsFileInfo, VfsNotFoundError } from '../../content/vfs/vfs.ts';
import type { AssetManifest } from '../../protocol/assets.ts';
import { fetchAssetManifest, type HttpAssetOptions, HttpVfsLayer } from './http-vfs-layer.ts';

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
  readonly vfs: Vfs;
  readonly layer: HttpVfsLayer;

  constructor(manifest: AssetManifest, options: HttpAssetOptions = {}) {
    this.layer = new HttpVfsLayer(manifest, options);
    this.vfs = new Vfs([this.layer]);
  }

  static async open(options: HttpAssetOptions = {}): Promise<HttpAssetSource> {
    return new HttpAssetSource(await fetchAssetManifest(options), options);
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

  read(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const info = this.resolve(path);
    if (!info) return Promise.reject(new VfsNotFoundError(path));
    return this.layer.read(info.path, 0, info.size, signal);
  }

  async readOptional(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
    return this.resolve(path) ? this.read(path, signal) : null;
  }

  abortAll(): void {
    this.layer.abortAll();
  }
}
