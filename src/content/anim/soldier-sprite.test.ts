import { describe, expect, it } from 'vitest';
import { facingOfDirection, HI_RES_DIRECTIONS, type SheetLayout, soldierSheetFrame } from './soldier-sprite.ts';

const DIRECTIONS = 8;
const SCRIPT_FRAME = 3;

function layout(directions: number, framesPerDirection: number, noFrames = false): SheetLayout {
  return { directions, framesPerDirection, noFrames, frameCount: directions * framesPerDirection };
}

const allDirections = Array.from({ length: DIRECTIONS }, (_, d) => d);

describe('the sheet frame of a facing (ConvertAniCodeToAniFrame)', () => {
  it('takes an eight-direction block one step clockwise of the facing', () => {
    const sheet = layout(DIRECTIONS, 6);
    expect(allDirections.map((d) => soldierSheetFrame(sheet, SCRIPT_FRAME, facingOfDirection(d)))).toEqual([9, 15, 21, 27, 33, 39, 45, 3]);
  });

  it("takes a vehicle's 32-direction block from the hi-res facing one octant clockwise (ExtOneCDirection)", () => {
    const sheet = layout(HI_RES_DIRECTIONS, 1, true);
    expect(allDirections.map((d) => soldierSheetFrame(sheet, SCRIPT_FRAME, facingOfDirection(d)))).toEqual([4, 8, 12, 16, 20, 24, 28, 0]);
    expect([0, 1, 2, 3, 27, 29, 31].map((h) => soldierSheetFrame(sheet, 0, { direction: 0, hiResDirection: h }))).toEqual([
      4, 5, 6, 7, 31, 1, 3,
    ]);
  });

  it('gives an eight-direction facing the hi-res facing four steps a direction (Dir2ExtDir)', () => {
    expect(allDirections.map((d) => facingOfDirection(d).hiResDirection)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it('reads only the eight-direction facing on a sheet of fewer directions', () => {
    const turned = { direction: 2, hiResDirection: 9 };
    expect([1, 2, 3, 4].map((n) => soldierSheetFrame(layout(n, 1, true), 0, turned))).toEqual([0, 1, 2, 1]);
  });
});
