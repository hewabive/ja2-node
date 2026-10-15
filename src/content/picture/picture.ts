export interface IndexedFrame {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly pixels: Uint8Array;
}

export interface IndexedPicture {
  readonly kind: 'indexed';
  readonly palette: Uint8Array;
  readonly frames: readonly IndexedFrame[];
}

export interface RgbaPicture {
  readonly kind: 'rgba';
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export type Picture = IndexedPicture | RgbaPicture;

export function framesBounds(frames: readonly IndexedFrame[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const f of frames) {
    minX = Math.min(minX, f.offsetX);
    minY = Math.min(minY, f.offsetY);
    maxX = Math.max(maxX, f.offsetX + f.width);
    maxY = Math.max(maxY, f.offsetY + f.height);
  }
  return { minX, minY, maxX, maxY };
}
