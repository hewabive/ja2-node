import { describe, expect, it } from 'vitest';
import { DrawList, type GlyphRunItem, type ImageItem, LOW_PERCENT_SHADOW_FACTOR, SHADOW_FACTOR } from '../draw-list.ts';
import { resolveResolution } from '../resolution.ts';
import type { BitmapFont } from '../text/bitmap-font.ts';
import { LARGE_FONT, SMALL_FONT, TestImage, TestPatternScreen } from './test-pattern.ts';

const QUESTION = 0x3f;

function font(id: string): BitmapFont {
  const table = new Map<number, number>([[QUESTION, 0]]);
  for (let cp = 0x20; cp < 0x7f; cp++) table.set(cp, cp - 0x20);
  for (let cp = 0x400; cp < 0x460; cp++) table.set(cp, cp - 0x400 + 95);
  table.set(0x2014, 300);
  const glyphs = Array.from({ length: 200 }, () => ({ width: 5, height: 9, offsetX: 1, offsetY: 0 }));
  return { id, table, glyphs };
}

function render(screen: TestPatternScreen): DrawList {
  const list = new DrawList();
  screen.render(list);
  return list;
}

describe('the test screen', () => {
  const resolution = resolveResolution(1920, 1080);
  const fonts = new Map([
    [SMALL_FONT, font(SMALL_FONT)],
    [LARGE_FONT, font(LARGE_FONT)],
  ]);

  it('draws every primitive in the std640 frame, glyph runs and the stub images it has', () => {
    const screen = new TestPatternScreen(() => resolution, fonts, new Set([TestImage.CARD, TestImage.PICTURE]));
    const list = render(screen);
    const kinds = new Set(list.items.map((i) => (i.kind === 'hatch' ? `hatch:${i.pattern}` : i.kind)));
    expect([...kinds].sort()).toEqual(
      ['clipPop', 'clipPush', 'fill', 'glyphs', 'hatch:checker', 'hatch:loose', 'image', 'line', 'rectangle', 'shadow'].sort(),
    );
    expect(list.items.filter((i) => i.kind === 'shadow').map((i) => i.factor)).toContain(LOW_PERCENT_SHADOW_FACTOR);
    expect(list.items.filter((i) => i.kind === 'shadow').map((i) => i.factor)).toContain(SHADOW_FACTOR);
    expect(list.items[1]).toEqual({ kind: 'fill', x: 160, y: 30, width: 640, height: 480, color: expect.any(Number) });
    const runs = list.items.filter((i): i is GlyphRunItem => i.kind === 'glyphs');
    expect(runs.map((r) => r.font)).toEqual([SMALL_FONT, SMALL_FONT, LARGE_FONT]);
    expect(runs[1]?.glyphs[0]).toEqual({ index: 0x421 - 0x400 + 95, x: 168, y: 112 });
    expect(runs[1]?.glyphs[1]?.x).toBe(174);
    expect(runs[2]?.glyphs.every((g) => g.index < 200)).toBe(true);
    const images = list.items.filter((i): i is ImageItem => i.kind === 'image');
    expect(new Set(images.map((i) => i.asset))).toEqual(new Set([TestImage.CARD, TestImage.PICTURE]));
    expect(images.map((i) => i.effect.kind)).toEqual([
      'normal',
      'normal',
      'normal',
      'normal',
      'outline',
      'outline',
      'outlineShadow',
      'outline',
      'normal',
    ]);
    expect(list.clipDepth).toBe(0);
  });

  it('blinks on the injected clock and marks the last pointer position', () => {
    const screen = new TestPatternScreen(() => resolution, fonts, new Set());
    screen.update(0);
    const on = render(screen).items.length;
    screen.update(600);
    expect(render(screen).items.length).toBe(on - 1);
    expect(screen.input({ kind: 'pointerDown', x: 10, y: 20, button: 0, buttons: 1, wheel: 0, modifiers: 0 })).toBe(true);
    expect(screen.input({ kind: 'text', text: 'a' })).toBe(false);
    expect(screen.pointer).toEqual({ x: 10, y: 20 });
    expect(screen.presses).toBe(1);
    expect(render(screen).items.slice(-2)).toEqual([
      { kind: 'line', x1: 7, y1: 20, x2: 13, y2: 20, color: 0xffffff },
      { kind: 'line', x1: 10, y1: 17, x2: 10, y2: 23, color: 0xffffff },
    ]);
  });
});
