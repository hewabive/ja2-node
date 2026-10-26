import type { WorldCapture, WorldFramebuffer } from './world-framebuffer.ts';

const RGBA_CHANNELS = 4;

export interface PixelMismatch {
  readonly pixels: number;
  readonly x: number;
  readonly y: number;
}

export interface PartialRedrawChecks {
  readonly frames: number;
  readonly mismatchedFrames: number;
  readonly lastMismatch: PixelMismatch | null;
}

export function pixelMismatch(drawn: WorldCapture, expected: WorldCapture): PixelMismatch | null {
  if (drawn.width !== expected.width || drawn.height !== expected.height) return { pixels: drawn.width * drawn.height, x: 0, y: 0 };
  let pixels = 0;
  let first = -1;
  for (let p = 0; p < drawn.width * drawn.height; p++) {
    const o = p * RGBA_CHANNELS;
    let same = true;
    for (let c = 0; c < RGBA_CHANNELS; c++) if (drawn.rgba[o + c] !== expected.rgba[o + c]) same = false;
    if (same) continue;
    pixels++;
    if (first < 0) first = p;
  }
  return pixels === 0 ? null : { pixels, x: first % drawn.width, y: Math.floor(first / drawn.width) };
}

export class PartialRedrawCheck {
  readonly framebuffer: WorldFramebuffer;
  #results: PartialRedrawChecks = { frames: 0, mismatchedFrames: 0, lastMismatch: null };

  constructor(framebuffer: WorldFramebuffer) {
    this.framebuffer = framebuffer;
  }

  get results(): PartialRedrawChecks {
    return this.#results;
  }

  compare(drawn: WorldCapture, expected: WorldCapture): void {
    const mismatch = pixelMismatch(drawn, expected);
    const r = this.#results;
    this.#results = {
      frames: r.frames + 1,
      mismatchedFrames: r.mismatchedFrames + (mismatch ? 1 : 0),
      lastMismatch: mismatch ?? r.lastMismatch,
    };
  }
}
