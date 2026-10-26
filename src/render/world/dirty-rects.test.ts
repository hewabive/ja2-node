import { describe, expect, it } from 'vitest';
import { boundingRect, clipRect, exposedStrips, MAX_DIRTY_RECTS, mergeRects, type ScreenRect } from './dirty-rects.ts';
import { pixelMismatch } from './partial-redraw-check.ts';

const VIEWPORT = { width: 640, height: 360 };
const rect = (x0: number, y0: number, x1: number, y1: number): ScreenRect => ({ x0, y0, x1, y1 });

describe('dirty rectangles of the world picture', () => {
  it('names the strips a shifted picture uncovers', () => {
    expect(exposedStrips(VIEWPORT, { x: 40, y: 0 })).toEqual([rect(0, 0, 40, 360)]);
    expect(exposedStrips(VIEWPORT, { x: -40, y: 0 })).toEqual([rect(600, 0, 640, 360)]);
    expect(exposedStrips(VIEWPORT, { x: 0, y: 20 })).toEqual([rect(0, 0, 640, 20)]);
    expect(exposedStrips(VIEWPORT, { x: -40, y: -20 })).toEqual([rect(600, 0, 640, 360), rect(0, 340, 640, 360)]);
    expect(exposedStrips(VIEWPORT, { x: 0, y: 0 })).toEqual([]);
  });

  it('clips a sprite to the viewport and drops one outside it', () => {
    expect(clipRect(-10, 350, 30, 30, VIEWPORT)).toEqual(rect(0, 350, 20, 360));
    expect(clipRect(640, 10, 30, 30, VIEWPORT)).toBeNull();
  });

  it('merges overlapping rectangles, keeps apart distant ones, and never returns more than the limit', () => {
    expect(mergeRects([rect(0, 0, 20, 20), rect(10, 10, 30, 30)])).toEqual([rect(0, 0, 30, 30)]);
    expect(mergeRects([rect(0, 0, 10, 10), rect(100, 100, 110, 110)])).toEqual([rect(0, 0, 10, 10), rect(100, 100, 110, 110)]);
    const scattered = Array.from({ length: 40 }, (_, i) => rect(i * 15, (i % 4) * 80, i * 15 + 10, (i % 4) * 80 + 10));
    const merged = mergeRects(scattered);
    expect(merged.length).toBeLessThanOrEqual(MAX_DIRTY_RECTS);
    for (const r of scattered) expect(merged.some((m) => m.x0 <= r.x0 && m.y0 <= r.y0 && m.x1 >= r.x1 && m.y1 >= r.y1)).toBe(true);
    expect(boundingRect(merged)).toEqual(boundingRect(scattered));
  });

  it('counts the pixels where a partial redraw differs from the whole one', () => {
    const picture = (changed: number | null) => {
      const rgba = new Uint8Array(4 * 3 * 2).fill(7);
      if (changed !== null) rgba[changed * 4 + 1] = 9;
      return { width: 3, height: 2, rgba };
    };
    expect(pixelMismatch(picture(null), picture(null))).toBeNull();
    expect(pixelMismatch(picture(4), picture(null))).toEqual({ pixels: 1, x: 1, y: 1 });
  });
});
