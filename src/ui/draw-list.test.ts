import { describe, expect, it } from 'vitest';
import { DrawList, LOW_PERCENT_SHADOW_FACTOR, rgb, SHADOW_FACTOR, sameDrawItems } from './draw-list.ts';

describe('the draw list', () => {
  it('keeps the original fill as right/bottom exclusive and shadows, hatches as inclusive rectangles', () => {
    const list = new DrawList();
    list.fill(10, 20, 30, 25, rgb(1, 2, 3));
    list.shadow(10, 20, 30, 25);
    list.shadow(0, 0, 0, 0, LOW_PERCENT_SHADOW_FACTOR);
    list.hatch(5, 6, 7, 8);
    list.looseHatch(5, 6, 5, 6, rgb(255, 0, 0));
    expect(list.items).toEqual([
      { kind: 'fill', x: 10, y: 20, width: 20, height: 5, color: 0x010203 },
      { kind: 'shadow', x: 10, y: 20, width: 21, height: 6, factor: SHADOW_FACTOR },
      { kind: 'shadow', x: 0, y: 0, width: 1, height: 1, factor: LOW_PERCENT_SHADOW_FACTOR },
      { kind: 'hatch', x: 5, y: 6, width: 3, height: 3, pattern: 'checker', color: 0 },
      { kind: 'hatch', x: 5, y: 6, width: 1, height: 1, pattern: 'loose', color: 0xff0000 },
    ]);
  });

  it('drops empty fills to zero size instead of negative sizes', () => {
    const list = new DrawList();
    list.fill(30, 30, 10, 10, 0);
    expect(list.items[0]).toMatchObject({ width: 0, height: 0 });
  });

  it('records images with their palette shade and effect, glyph runs with font colour indices', () => {
    const list = new DrawList();
    list.image('interface/a.sti', 3, 1, 2);
    list.image('interface/a.sti', 0, 1, 2, {
      shade: { red: 255, green: 255, blue: 255, mono: true },
      effect: { kind: 'outline', color: null },
    });
    list.glyphs('font10arial', [{ index: 33, x: 4, y: 5 }], { foreground: 208, shadow: 2, background: 0 });
    list.glyphs('font10arial', [], { foreground: 208, shadow: 2, background: 0 });
    expect(list.items).toEqual([
      { kind: 'image', asset: 'interface/a.sti', frame: 3, x: 1, y: 2, shade: null, effect: { kind: 'normal' } },
      {
        kind: 'image',
        asset: 'interface/a.sti',
        frame: 0,
        x: 1,
        y: 2,
        shade: { red: 255, green: 255, blue: 255, mono: true },
        effect: { kind: 'outline', color: null },
      },
      { kind: 'glyphs', font: 'font10arial', glyphs: [{ index: 33, x: 4, y: 5 }], foreground: 208, shadow: 2, background: 0 },
    ]);
  });

  it('pairs clip pushes and pops and refuses a pop without a push', () => {
    const list = new DrawList();
    list.pushClip(0, 0, 640, 480);
    expect(list.clipDepth).toBe(1);
    list.popClip();
    expect(list.items).toEqual([{ kind: 'clipPush', x: 0, y: 0, width: 640, height: 480 }, { kind: 'clipPop' }]);
    expect(() => list.popClip()).toThrow();
    list.clear();
    expect(list.items).toEqual([]);
  });

  it('keeps line and rectangle end points as given (inclusive)', () => {
    const list = new DrawList();
    list.rectangle(1, 2, 3, 4, 7);
    list.line(5, 6, 9, 6, 8);
    expect(list.items).toEqual([
      { kind: 'rectangle', x1: 1, y1: 2, x2: 3, y2: 4, color: 7 },
      { kind: 'line', x1: 5, y1: 6, x2: 9, y2: 6, color: 8 },
    ]);
  });
});

describe('comparing two frames of draw items', () => {
  const frame = (shift = 0, foreground = 208): DrawList => {
    const list = new DrawList();
    list.fill(0, 0, 640, 480, rgb(16, 18, 24));
    list.image('interface/a.sti', 3, 10 + shift, 20, { shade: { red: 1, green: 1, blue: 1, mono: false } });
    list.glyphs('font10arial', [{ index: 33, x: 4, y: 5 }], { foreground, shadow: 2, background: 0 });
    return list;
  };

  it('finds two frames built the same way equal, though every item is a new object', () => {
    expect(sameDrawItems(frame().items, frame().items)).toBe(true);
  });

  it('tells frames apart by a moved image, a glyph colour, an added item or a different order', () => {
    expect(sameDrawItems(frame().items, frame(1).items)).toBe(false);
    expect(sameDrawItems(frame().items, frame(0, 209).items)).toBe(false);
    const longer = frame();
    longer.fill(1, 1, 2, 2, 0);
    expect(sameDrawItems(frame().items, longer.items)).toBe(false);
    expect(sameDrawItems(frame().items, [...frame().items].reverse())).toBe(false);
  });
});
