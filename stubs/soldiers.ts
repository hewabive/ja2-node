import { SOLDIER_SHADOW_INDEX } from '../src/content/anim/soldier-sprite.ts';
import { writeSoldierPalettes } from '../src/content/formats/ja2pal.ts';
import { color } from './palette.ts';
import { IndexedRaster } from './raster.ts';
import type { StubFrame, StubSprite } from './sprites.ts';

export const STUB_SOLDIER_FRAMES_PER_DIRECTION = 18;
export const STUB_SOLDIER_KINDS = ['stand', 'walk', 'run', 'crouch', 'prone'] as const;
export type StubSoldierKind = (typeof STUB_SOLDIER_KINDS)[number];

const RANGES = {
  pants: { start: 205, end: 219 },
  vest: { start: 220, end: 234 },
  skin: { start: 235, end: 244 },
  hair: { start: 245, end: 250 },
} as const;

const WIDTH = 28;
const HEIGHT = 50;
const FEET_X = 14;
const FEET_Y = 45;
const SCREEN_VECTOR_BY_BLOCK: readonly (readonly [number, number])[] = [
  [0, -1],
  [0.7, -0.35],
  [1, 0],
  [0.7, 0.35],
  [0, 1],
  [-0.7, 0.35],
  [-1, 0],
  [-0.7, -0.35],
];

function shade(range: { start: number; end: number }, t: number): number {
  const span = range.end - range.start;
  return range.start + Math.max(0, Math.min(span, Math.round(t * span)));
}

interface Pose {
  readonly hip: number;
  readonly stride: number;
  readonly lean: number;
  readonly lying: boolean;
}

function pose(kind: StubSoldierKind, frame: number): Pose {
  const phase = (frame / STUB_SOLDIER_FRAMES_PER_DIRECTION) * Math.PI * 2;
  switch (kind) {
    case 'walk':
      return { hip: 30, stride: Math.sin(phase * 2) * 4, lean: 0, lying: false };
    case 'run':
      return { hip: 30, stride: Math.sin(phase * 2) * 6, lean: 2, lying: false };
    case 'crouch':
      return { hip: 36, stride: Math.sin(phase * 2) * 2, lean: 1, lying: false };
    case 'prone':
      return { hip: 40, stride: Math.sin(phase * 2), lean: 0, lying: true };
    default:
      return { hip: 30 + Math.round(Math.sin(phase) * 0.6), stride: 0, lean: 0, lying: false };
  }
}

function drawStanding(r: IndexedRaster, p: Pose, vx: number, vy: number): void {
  const top = p.hip - 18;
  const leanX = vx * p.lean;
  r.line(FEET_X - 2, p.hip, FEET_X - 2 - p.stride * 0.6, FEET_Y - 1, shade(RANGES.pants, 0.4));
  r.line(FEET_X - 1, p.hip, FEET_X - 1 - p.stride * 0.6, FEET_Y - 1, shade(RANGES.pants, 0.5));
  r.line(FEET_X + 1, p.hip, FEET_X + 1 + p.stride * 0.6, FEET_Y - 1, shade(RANGES.pants, 0.7));
  r.line(FEET_X + 2, p.hip, FEET_X + 2 + p.stride * 0.6, FEET_Y - 1, shade(RANGES.pants, 0.6));
  r.ellipse(FEET_X + leanX, top + 9, 5.5, 9, (nx, ny) => shade(RANGES.vest, 0.6 - nx * 0.3 - ny * 0.2));
  r.line(FEET_X + leanX + vx * 3, top + 6 + vy * 2, FEET_X + leanX + vx * 9, top + 12 + vy * 4, shade(RANGES.skin, 0.4));
  r.ellipse(FEET_X + leanX, top - 4, 3.8, 4.2, (nx, ny) => shade(RANGES.skin, 0.7 - nx * 0.3 - ny * 0.2));
  r.ellipse(FEET_X + leanX - vx, top - 6.5 - Math.max(0, -vy), 3.8, 2.2, (nx) => shade(RANGES.hair, 0.6 - nx * 0.3));
  r.set(FEET_X + leanX + vx * 3, top - 4 + vy, color('gray', 1));
}

function drawLying(r: IndexedRaster, p: Pose, vx: number, vy: number): void {
  const cx = FEET_X;
  const cy = p.hip;
  r.ellipse(cx, cy, 9, 3.5, (nx, ny) => shade(RANGES.vest, 0.6 - ny * 0.3 + nx * 0.1));
  r.line(cx - vx * 9, cy - vy * 3 + p.stride, cx - vx * 14, cy - vy * 4, shade(RANGES.pants, 0.6));
  r.ellipse(cx + vx * 10, cy + vy * 3, 3, 3, (nx, ny) => shade(RANGES.skin, 0.7 - nx * 0.2 - ny * 0.2));
  r.ellipse(cx + vx * 11, cy + vy * 3 - 2, 3, 1.5, () => shade(RANGES.hair, 0.5));
}

function shadowUnder(r: IndexedRaster, lying: boolean): void {
  const rx = lying ? 12 : 8;
  const ry = lying ? 4 : 3;
  for (let y = FEET_Y - ry; y <= FEET_Y + ry; y++) {
    for (let x = FEET_X - rx; x <= FEET_X + rx; x++) {
      const nx = (x - FEET_X) / rx;
      const ny = (y - FEET_Y) / ry;
      if (nx * nx + ny * ny <= 1 && r.get(x, y) === 0) r.set(x, y, SOLDIER_SHADOW_INDEX);
    }
  }
}

function soldierFrame(kind: StubSoldierKind, block: number, frame: number): StubFrame {
  const r = new IndexedRaster(WIDTH, HEIGHT);
  const [vx, vy] = SCREEN_VECTOR_BY_BLOCK[block] ?? [0, 1];
  const p = pose(kind, frame);
  if (p.lying) drawLying(r, p, vx, vy);
  else drawStanding(r, p, vx, vy);
  r.outline(color('gray', 1));
  shadowUnder(r, p.lying);
  return { raster: r, ox: -FEET_X, oy: -FEET_Y };
}

export function stubSoldierSheets(): StubSprite[] {
  return STUB_SOLDIER_KINDS.map((kind) => {
    const frames: StubFrame[] = [];
    for (let block = 0; block < 8; block++) {
      for (let f = 0; f < STUB_SOLDIER_FRAMES_PER_DIRECTION; f++) frames.push(soldierFrame(kind, block, f));
    }
    return { path: `anims/stub/${kind}`, frames, meta: { directions: 8, framesPerDirection: STUB_SOLDIER_FRAMES_PER_DIRECTION } };
  });
}

type Rgb = readonly [number, number, number];

const HAIR: Readonly<Record<string, Rgb>> = {
  BLONDHEAD: [220, 190, 110],
  BROWNHEAD: [110, 70, 40],
  BLACKHEAD: [40, 35, 35],
  WHITEHEAD: [215, 215, 210],
  REDHEAD: [170, 70, 35],
  redbrown: [130, 60, 40],
  dirtblnde: [170, 140, 90],
};
const PANTS: Readonly<Record<string, Rgb>> = {
  GREENPANTS: [70, 100, 55],
  JEANPANTS: [60, 80, 130],
  TANPANTS: [170, 140, 95],
  BLACKPANTS: [45, 45, 50],
  BLUEPANTS: [50, 70, 160],
  BEIGEPANTS: [190, 170, 130],
};
const SKIN: Readonly<Record<string, Rgb>> = {
  PINKSKIN: [235, 180, 150],
  TANSKIN: [205, 150, 105],
  DARKSKIN: [140, 95, 65],
  BLACKSKIN: [90, 60, 45],
};
const VEST: Readonly<Record<string, Rgb>> = {
  BROWNVEST: [120, 85, 55],
  greyVEST: [130, 130, 130],
  GREENVEST: [80, 130, 70],
  JEANVEST: [70, 95, 150],
  REDVEST: [175, 50, 45],
  BLUEVEST: [60, 90, 190],
  YELLOWVEST: [210, 185, 70],
  WHITEVEST: [220, 220, 215],
  BLACKSHIRT: [50, 50, 55],
  GYELLOWSHIRT: [180, 190, 80],
  PURPLESHIRT: [120, 70, 150],
};

function ramp([r, g, b]: Rgb, count: number): Uint8Array {
  const out = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 1 : i / (count - 1);
    const k = 0.45 + t * 0.75;
    out.set([Math.min(255, Math.round(r * k)), Math.min(255, Math.round(g * k)), Math.min(255, Math.round(b * k))], i * 3);
  }
  return out;
}

export function stubSoldierPalettes(): Uint8Array {
  const groups = [
    { range: RANGES.hair, colors: HAIR },
    { range: RANGES.pants, colors: PANTS },
    { range: RANGES.skin, colors: SKIN },
    { range: RANGES.vest, colors: VEST },
  ];
  return writeSoldierPalettes({
    subRanges: groups.map((g) => ({ start: g.range.start, end: g.range.end, replacementCount: Object.keys(g.colors).length })),
    replacements: groups.flatMap((g, subRange) =>
      Object.entries(g.colors).map(([id, rgb]) => ({ subRange, id, rgb: ramp(rgb, g.range.end - g.range.start + 1) })),
    ),
  });
}
