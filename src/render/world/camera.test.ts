import { describe, expect, it } from 'vitest';
import { applyScrolling, cameraOnGridNo, scrollBy, scrollLimits, setRenderCenter, snapCamera, snapToTileCentre } from './camera.ts';
import type { Viewport } from './geometry.ts';

const VIEW: Viewport = { width: 640, height: 360 };
const LIMITS = scrollLimits(0);

describe('camera', () => {
  it('snaps to tile centres like the original integer division', () => {
    expect(snapToTileCentre(803)).toBe(805);
    expect(snapToTileCentre(809)).toBe(805);
    expect(snapToTileCentre(810)).toBe(815);
    expect(snapCamera({ centerX: 0, centerY: 9 })).toEqual({ centerX: 5, centerY: 5 });
    expect(cameraOnGridNo(80 * 160 + 81)).toEqual({ centerX: 815, centerY: 805 });
  });

  it('derives the scroll rectangle of restriction 0 and 1', () => {
    expect(LIMITS).toEqual({ leftX: -1580, rightX: 1600, topY: 860, bottomY: 2400 });
    const small = scrollLimits(1);
    expect(small.leftX).toBe(-640);
    expect(small.rightX).toBe(640);
  });

  it('keeps a centred camera and forces a camera beyond the edge to the edge', () => {
    expect(setRenderCenter({ centerX: 805, centerY: 805 }, VIEW, LIMITS)).toEqual({ centerX: 805, centerY: 805 });
    expect(applyScrolling({ centerX: 805, centerY: 805 }, { centerX: 805, centerY: 805 }, VIEW, LIMITS, 'any', false)).toEqual({
      centerX: 805,
      centerY: 805,
    });
    expect(applyScrolling({ centerX: 5, centerY: 5 }, { centerX: 805, centerY: 805 }, VIEW, LIMITS, 'any', false)).toBeNull();
    expect(setRenderCenter({ centerX: 5, centerY: 5 }, VIEW, LIMITS)).toEqual({ centerX: 495, centerY: 495 });
  });

  it('refuses a scroll step that would show the outside of the map', () => {
    const top = setRenderCenter({ centerX: 5, centerY: 5 }, VIEW, LIMITS);
    expect(scrollBy(top, 0, -40, VIEW, LIMITS)).toEqual(top);
    const moved = scrollBy(top, 0, 40, VIEW, LIMITS);
    expect(moved).not.toEqual(top);
  });
});
