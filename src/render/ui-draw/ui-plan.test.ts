import { describe, expect, it } from 'vitest';
import { DrawList, rgb } from '../../ui/draw-list.ts';
import { lineRuns, rectangleRuns } from './line-runs.ts';
import { FLOATS_PER_INSTANCE, shadowModulation, UiDrawPlanner, type UiDrawSources } from './ui-plan.ts';
import { UiMode } from './ui-shader.ts';
import type { IndexedUiImage, RgbUiImage, UiFont } from './ui-textures.ts';

const PALETTE = new Uint8Array(768);
PALETTE.set([255, 255, 255], 208 * 3);
PALETTE.set([200, 0, 0], 7 * 3);

const card: IndexedUiImage = {
  kind: 'indexed',
  palette: PALETTE,
  frames: [
    { region: { page: 0, x: 10, y: 20, width: 4, height: 3 }, offsetX: 2, offsetY: 1 },
    { region: { page: 1, x: 0, y: 0, width: 5, height: 5 }, offsetX: 0, offsetY: 0 },
  ],
  rows: new Map(),
};
const picture: RgbUiImage = { kind: 'rgb', texture: {} as WebGLTexture, width: 64, height: 32 };
const font: UiFont = { palette: PALETTE, glyphs: [{ region: { page: 0, x: 30, y: 0, width: 6, height: 9 }, offsetX: 1, offsetY: 0 }] };

const sources: UiDrawSources = {
  image: (key) => (key === 'card' ? card : key === 'picture' ? picture : undefined),
  font: (id) => (id === 'font10arial' ? font : undefined),
  paletteRow: (_image, shade) => (shade ? 5 : 3),
};

function instance(data: Float32Array, i: number): number[] {
  return [...data.subarray(i * FLOATS_PER_INSTANCE, (i + 1) * FLOATS_PER_INSTANCE)].map((v) => Math.round(v * 1000) / 1000);
}

describe('the UI draw plan', () => {
  it('turns fills, shadows and hatches into instances with multiply batches and the pattern at the clipped corner', () => {
    const list = new DrawList();
    list.fill(0, 0, 10, 10, rgb(255, 0, 0));
    list.shadow(0, 0, 9, 9);
    list.pushClip(4, 6, 100, 100);
    list.hatch(2, 3, 20, 20);
    list.popClip();
    const plan = new UiDrawPlanner().plan(list.items, 640, 480, sources);
    expect(plan.instances).toBe(3);
    expect(plan.batches.map((b) => [b.first, b.count, b.multiply, b.clip])).toEqual([
      [0, 1, false, null],
      [1, 1, true, null],
      [2, 1, false, { x: 4, y: 6, width: 96, height: 94 }],
    ]);
    expect(instance(plan.data, 0).slice(0, 16)).toEqual([0, 0, 10, 10, 0, 0, 0, 0, UiMode.FILL, 0, 0, 0, 1, 0, 0, 1]);
    expect(instance(plan.data, 1)[10]).toBe(Math.round(shadowModulation(0.48) * 1000) / 1000);
    expect(instance(plan.data, 2).slice(0, 9)).toEqual([2, 3, 19, 18, 4, 6, 0, 0, UiMode.HATCH]);
  });

  it('places image frames at their offsets, picks palette rows and splits batches by atlas page', () => {
    const list = new DrawList();
    list.image('card', 0, 100, 50);
    list.image('card', 0, 0, 0, { shade: { red: 128, green: 128, blue: 128, mono: false } });
    list.image('card', 1, 0, 0, { effect: { kind: 'outline', color: null } });
    list.image('picture', 0, 5, 5);
    list.image('missing', 0, 0, 0);
    list.image('card', 9, 0, 0);
    const plan = new UiDrawPlanner().plan(list.items, 640, 480, sources);
    expect(plan.instances).toBe(4);
    expect(instance(plan.data, 0).slice(0, 10)).toEqual([102, 51, 4, 3, 10, 20, 4, 3, UiMode.INDEXED, 3]);
    expect(instance(plan.data, 1)[9]).toBe(5);
    expect(instance(plan.data, 2)[8]).toBe(UiMode.OUTLINE);
    expect(instance(plan.data, 2).slice(12, 16)).toEqual([0, 0, 0, 0]);
    expect(instance(plan.data, 3).slice(0, 9)).toEqual([5, 5, 64, 32, 0, 0, 64, 32, UiMode.RGB]);
    expect(plan.batches.map((b) => [b.count, b.indexPage, b.rgb === picture])).toEqual([
      [2, 0, false],
      [2, 1, true],
    ]);
    expect([...plan.missingImages]).toEqual(['missing']);
  });

  it('resolves glyph colours through the font palette with the black rules and skips glyphs the font lacks', () => {
    const list = new DrawList();
    list.glyphs(
      'font10arial',
      [
        { index: 0, x: 10, y: 20 },
        { index: 99, x: 16, y: 20 },
      ],
      { foreground: 208, shadow: 2, background: 7 },
    );
    list.glyphs('font99', [{ index: 0, x: 0, y: 0 }], { foreground: 208, shadow: 0, background: 0 });
    const plan = new UiDrawPlanner().plan(list.items, 640, 480, sources);
    expect(plan.instances).toBe(1);
    const glyph = instance(plan.data, 0);
    expect(glyph.slice(0, 9)).toEqual([11, 20, 6, 9, 30, 0, 6, 9, UiMode.GLYPH]);
    expect(glyph.slice(12, 16)).toEqual([1, 1, 1, 1]);
    expect(glyph.slice(16, 20)).toEqual([0, 0, 0.031, 1]);
    expect(glyph.slice(20, 24)).toEqual([0.784, 0, 0, 1]);
    expect([...plan.missingFonts]).toEqual(['font99']);
  });

  it('drops everything outside an empty clip', () => {
    const list = new DrawList();
    list.pushClip(10, 10, 10, 20);
    list.fill(0, 0, 50, 50, 0);
    list.popClip();
    expect(new UiDrawPlanner().plan(list.items, 640, 480, sources).instances).toBe(0);
  });
});

describe('line runs', () => {
  it('draws axis-aligned lines and rectangles inclusively', () => {
    expect(lineRuns(5, 6, 1, 6)).toEqual([{ x: 1, y: 6, width: 5, height: 1 }]);
    expect(lineRuns(3, 1, 3, 4)).toEqual([{ x: 3, y: 1, width: 1, height: 4 }]);
    expect(rectangleRuns(0, 0, 3, 2)).toEqual([
      { x: 0, y: 0, width: 4, height: 1 },
      { x: 0, y: 2, width: 4, height: 1 },
      { x: 0, y: 0, width: 1, height: 3 },
      { x: 3, y: 0, width: 1, height: 3 },
    ]);
  });

  it('walks diagonal lines into runs that cover both end points', () => {
    const runs = lineRuns(0, 0, 5, 2);
    expect(runs.reduce((n, r) => n + r.width * r.height, 0)).toBe(6);
    expect(runs[0]).toMatchObject({ x: 0, y: 0 });
    expect(runs.at(-1)).toMatchObject({ y: 2 });
    expect(runs.at(-1)?.x).toBeLessThanOrEqual(5);
  });
});
