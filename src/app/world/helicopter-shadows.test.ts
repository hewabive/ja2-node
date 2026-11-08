import { describe, expect, it } from 'vitest';
import { HelicopterShadows } from './helicopter-shadows.ts';

const FRAMES = 4;
const DELAY = 90;
const SHADOW = { gridNo: 1680, x: 795, y: 5, z: 0 };
const LEFT_BEHIND = { gridNo: 1680, x: 795, y: 121, z: -29 };

describe('the helicopter shadow (HELI_SHOW_HELI, UpdateAniTiles)', () => {
  it('starts at the first frame where the view shows it and loops forward every 90 ms wherever the view moves it', () => {
    const shadows = new HelicopterShadows();
    expect(shadows.update([SHADOW], 1000, FRAMES)).toEqual([{ ...SHADOW, frame: 0 }]);
    expect(shadows.update([SHADOW], 1000 + DELAY - 1, FRAMES).map((s) => s.frame)).toEqual([0]);
    const moved = { ...SHADOW, y: 9, z: -1 };
    expect(shadows.update([moved], 1000 + DELAY, FRAMES)).toEqual([{ ...moved, frame: 1 }]);
    expect(shadows.update([moved], 1000 + FRAMES * DELAY, FRAMES).map((s) => s.frame)).toEqual([0]);
  });

  it('starts a shadow the view shows anew at its first frame, beside the one a skip left behind', () => {
    const shadows = new HelicopterShadows();
    shadows.update([LEFT_BEHIND], 0, FRAMES);
    expect(shadows.update([LEFT_BEHIND, SHADOW], 2 * DELAY, FRAMES).map((s) => s.frame)).toEqual([2, 0]);
    expect(shadows.update([LEFT_BEHIND], 3 * DELAY, FRAMES).map((s) => s.frame)).toEqual([3]);
    expect(shadows.update([LEFT_BEHIND, SHADOW], 3 * DELAY, FRAMES).map((s) => s.frame)).toEqual([3, 0]);
  });

  it('draws nothing until its sheet is loaded', () => {
    expect(new HelicopterShadows().update([SHADOW], 0, null)).toEqual([]);
  });
});
