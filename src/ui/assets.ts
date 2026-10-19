import type { AssetKey } from './draw-list.ts';

export interface FrameMetrics {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ImageInfo {
  readonly kind: 'indexed' | 'rgb';
  readonly frames: readonly FrameMetrics[];
  readonly animatedFrames: number;
}

export interface ImageCatalog {
  info(key: AssetKey): ImageInfo | undefined;
}

export const NO_FRAME: FrameMetrics = { width: 0, height: 0, offsetX: 0, offsetY: 0 };

export function frameOf(catalog: ImageCatalog, key: AssetKey, frame: number): FrameMetrics {
  return catalog.info(key)?.frames[frame] ?? NO_FRAME;
}

export class StaticImageCatalog implements ImageCatalog {
  readonly #images = new Map<AssetKey, ImageInfo>();

  set(key: AssetKey, info: ImageInfo): void {
    this.#images.set(key, info);
  }

  info(key: AssetKey): ImageInfo | undefined {
    return this.#images.get(key);
  }

  keys(): AssetKey[] {
    return [...this.#images.keys()];
  }
}

export function uniformImage(frames: number, width: number, height: number, animatedFrames = 0): ImageInfo {
  return { kind: 'indexed', frames: Array.from({ length: frames }, () => ({ width, height, offsetX: 0, offsetY: 0 })), animatedFrames };
}
