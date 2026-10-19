import { WORLD_MAX } from '../../content/world/grid.ts';

export const FLOATS_PER_INSTANCE = 12;

export const InstanceFlags = {
  NONE: 0,
  DITHER: 1,
  ONLY_SHADOW_INDEX: 2,
  EXCEPT_SHADOW_INDEX: 4,
  OUTLINE_SHADOW_INDEX: 8,
} as const;

export const ShadeKey = {
  FIXED: -1,
  ROOF_BASE: WORLD_MAX,
  NATURAL: WORLD_MAX * 2,
} as const;

export const DrawState = {
  LAND: 0,
  NEARER_OR_EQUAL_WRITE: 1,
  NEARER_WRITE: 2,
  SHADOW_WRITE: 3,
  SHADOW_FLAT: 4,
  NEARER_OR_EQUAL: 5,
  NEARER_SHADOW: 6,
  FARTHER: 7,
  FARTHER_OR_EQUAL: 8,
  ALWAYS_WRITE: 9,
  TRANSLUCENT: 10,
} as const;
export type DrawState = (typeof DrawState)[keyof typeof DrawState];

export interface SpriteSource {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const INITIAL_INSTANCES = 1024;

export class InstanceBuffer {
  data = new Float32Array(INITIAL_INSTANCES * FLOATS_PER_INSTANCE);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  reserve(instances: number): void {
    const needed = instances * FLOATS_PER_INSTANCE;
    if (needed <= this.data.length) return;
    const grown = new Float32Array(Math.max(needed, this.data.length * 2));
    grown.set(this.data.subarray(0, this.count * FLOATS_PER_INSTANCE));
    this.data = grown;
  }

  push(
    x: number,
    y: number,
    src: SpriteSource,
    srcX: number,
    srcWidth: number,
    paletteRow: number,
    z: number,
    shadeKey: number,
    flags: number,
    outline: number,
  ): void {
    if (srcWidth <= 0 || src.height <= 0) return;
    this.reserve(this.count + 1);
    const d = this.data;
    const o = this.count * FLOATS_PER_INSTANCE;
    d[o] = x + srcX;
    d[o + 1] = y;
    d[o + 2] = srcWidth;
    d[o + 3] = src.height;
    d[o + 4] = src.x + srcX;
    d[o + 5] = src.y;
    d[o + 6] = src.layer;
    d[o + 7] = paletteRow;
    d[o + 8] = z;
    d[o + 9] = shadeKey;
    d[o + 10] = flags;
    d[o + 11] = outline;
    this.count++;
  }
}

export function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}
