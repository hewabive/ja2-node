import { Rng } from '../src/core/rng.ts';
import { color } from './palette.ts';
import { IndexedRaster } from './raster.ts';

export interface StubFrame {
  readonly raster: IndexedRaster;
  readonly ox: number;
  readonly oy: number;
}

export interface StubSprite {
  readonly path: string;
  readonly frames: readonly StubFrame[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

const SCREEN_VECTOR_BY_JA2_DIRECTION: readonly (readonly [number, number])[] = [
  [0.7, -0.35],
  [1, 0],
  [0.7, 0.35],
  [0, 1],
  [-0.7, 0.35],
  [-1, 0],
  [-0.7, -0.35],
  [0, -1],
];

function soldier(): StubSprite {
  const frames: StubFrame[] = [];
  for (let d = 0; d < 8; d++) {
    const [vx, vy] = SCREEN_VECTOR_BY_JA2_DIRECTION[d] ?? [0, 1];
    for (let f = 0; f < 4; f++) {
      const r = new IndexedRaster(22, 46);
      const step = [0, 2, 0, -2][f] ?? 0;
      r.line(9, 34, 9 - step * 0.5, 43, color('khaki', 4));
      r.line(13, 34, 13 + step * 0.5, 43, color('khaki', 4));
      r.ellipse(11, 25, 6, 11, (nx, ny) => color('green', 9 - nx * 3 - ny * 2));
      r.line(11 + vx * 2, 25 + vy * 2, 11 + vx * 9, 25 + vy * 5, color('steel', 3));
      r.ellipse(11, 10, 4, 4.5, (nx, ny) => color('skin', 9 - nx * 2 - ny * 2));
      r.set(11 + vx * 2.5, 10 + vy * 1.5, color('red', 10));
      r.set(11 + vx * 2.5 + 1, 10 + vy * 1.5, color('red', 10));
      r.outline(color('gray', 1));
      frames.push({ raster: r, ox: -11, oy: -42 });
    }
  }
  return { path: 'soldier/capsule', frames, meta: { directions: 8, framesPerDirection: 4, animation: 'walk' } };
}

function diamond(r: IndexedRaster, shade: (x: number, y: number) => number): void {
  for (let y = 0; y < 20; y++) {
    const dy = y < 10 ? y : 19 - y;
    const half = 2 + dy * 2;
    for (let x = 20 - half; x < 20 + half; x++) r.set(x, y, shade(x, y));
  }
}

function ground(): StubSprite {
  const rng = Rng.fromSeed(0x6a6132);
  const kinds = [
    ['green', 7],
    ['brown', 7],
    ['gray', 6],
    ['sand', 8],
    ['water', 7],
    ['khaki', 9],
  ] as const;
  const frames: StubFrame[] = [];
  for (const [ramp, base] of kinds) {
    for (let v = 0; v < 2; v++) {
      const r = new IndexedRaster(40, 20);
      diamond(r, (x, y) => color(ramp, base + rng.int(3) - 1 + ((x + y + v) % 7 === 0 ? 1 : 0)));
      frames.push({ raster: r, ox: 0, oy: 0 });
    }
  }
  return { path: 'tiles/ground', frames, meta: { kinds: kinds.map(([k]) => k), variants: 2 } };
}

function walls(): StubSprite {
  const frames: StubFrame[] = [];
  const h = 50;
  for (const side of ['left', 'right'] as const) {
    const r = new IndexedRaster(22, h + 11);
    for (let i = 0; i < 21; i++) {
      const x = side === 'left' ? i : 21 - i;
      const top = 10 - Math.floor(i / 2);
      for (let y = top; y < top + h; y++) r.set(x, y, color('brown', 6 + ((y + i) % 9 === 0 ? 3 : 0) + (side === 'left' ? 1 : 0)));
      r.set(x, top, color('brown', 12));
    }
    frames.push({ raster: r, ox: side === 'left' ? 0 : 19, oy: -h + 10 });
  }
  return { path: 'tiles/wall', frames, meta: { orientations: ['left', 'right'] } };
}

function button(): StubSprite {
  const frames: StubFrame[] = [];
  for (const [fill, edge] of [
    [7, 12],
    [9, 14],
    [5, 3],
    [4, 6],
  ] as const) {
    const r = new IndexedRaster(80, 20);
    r.rect(0, 0, 80, 20, color('ui', fill));
    r.frame(0, 0, 80, 20, color('ui', edge));
    r.frame(1, 1, 78, 18, color('ui', fill + 1));
    frames.push({ raster: r, ox: 0, oy: 0 });
  }
  return { path: 'ui/button', frames, meta: { states: ['normal', 'hover', 'pressed', 'disabled'] } };
}

export function allStubSprites(): StubSprite[] {
  return [soldier(), ground(), walls(), button()];
}
