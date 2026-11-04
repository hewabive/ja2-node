import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../protocol/view.ts';
import type { SheetRequest } from './soldier-assets.ts';
import { type BoundingFrameSources, SoldierBoundingBoxes } from './soldier-bounding-boxes.ts';

const STANDING = 1;
const FALLING = 2;
const SOLDIER = 7;
const OTHER = 8;
const NORTH = 0;
const NORTHEAST = 1;
const EAST = 2;
const FIRST_STANDING_FRAME = 0;
const FIRST_FALLING_FRAME = 4;
const NO_SURFACE = 99;

function soldier(over: Partial<SoldierView> = {}): SoldierView {
  return {
    id: SOLDIER,
    team: 0,
    name: '',
    bodyType: 0,
    gridNo: 0,
    x: 0,
    y: 0,
    level: 0,
    direction: NORTH,
    animation: STANDING,
    frame: FIRST_STANDING_FRAME,
    palettes: ['', '', '', ''],
    hand: '',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    ...over,
  };
}

const sheetOf = (animation: number): SheetRequest => ({ id: `sheet${animation}`, surface: animation });

const sources: BoundingFrameSources = {
  sheetFor: (s) => (s.animation === NO_SURFACE ? null : sheetOf(s.animation)),
  firstFrameOf: (s) => (s.animation === FALLING ? FIRST_FALLING_FRAME : FIRST_STANDING_FRAME),
  frameOf: (s) => s.frame,
};

function following(...views: SoldierView[][]): SoldierBoundingBoxes {
  const boxes = new SoldierBoundingBoxes();
  for (const soldiers of views) boxes.update(soldiers, sources);
  return boxes;
}

describe('the bounding box of a soldier (SetSoldierLocatorOffsets)', () => {
  it('takes the first frame of his animation as it starts and keeps it while later frames show', () => {
    const start = soldier({ animation: FALLING, frame: FIRST_FALLING_FRAME + 2, stateTick: 40 });
    const boxes = following([soldier()], [start], [{ ...start, frame: FIRST_FALLING_FRAME + 5 }]);
    expect(boxes.frameOf(SOLDIER)).toEqual({ sheet: sheetOf(FALLING), scriptFrame: FIRST_FALLING_FRAME, direction: NORTH });
  });

  it('starts again from the first frame when the same animation restarts', () => {
    const boxes = following([soldier({ frame: 3 })], [soldier({ frame: 5, stateTick: 90, direction: EAST })]);
    expect(boxes.frameOf(SOLDIER)).toEqual({ sheet: sheetOf(STANDING), scriptFrame: FIRST_STANDING_FRAME, direction: EAST });
  });

  it('keeps the frame shown at a turn in the facing before it, as EVENT_SetSoldierDirection converts no frame', () => {
    const boxes = following([soldier({ frame: 3 })], [soldier({ frame: 5, direction: NORTHEAST })]);
    expect(boxes.frameOf(SOLDIER)).toEqual({ sheet: sheetOf(STANDING), scriptFrame: 5, direction: NORTH });
    boxes.update([soldier({ frame: 6, direction: EAST })], sources);
    expect(boxes.frameOf(SOLDIER)).toEqual({ sheet: sheetOf(STANDING), scriptFrame: 6, direction: NORTHEAST });
  });

  it('takes the first frame in the new facing when an animation starts with a turn between two views', () => {
    const boxes = following([soldier({ frame: 3 })], [soldier({ animation: FALLING, stateTick: 40, direction: EAST })]);
    expect(boxes.frameOf(SOLDIER)).toEqual({ sheet: sheetOf(FALLING), scriptFrame: FIRST_FALLING_FRAME, direction: EAST });
  });

  it('starts a soldier new to the view at the first frame of his animation', () => {
    const boxes = following([soldier({ id: OTHER })], [soldier({ id: OTHER }), soldier({ frame: 5, direction: EAST })]);
    expect(boxes.frameOf(SOLDIER)).toEqual({ sheet: sheetOf(STANDING), scriptFrame: FIRST_STANDING_FRAME, direction: EAST });
  });

  it('forgets a soldier who leaves the view, so his return counts as a start', () => {
    const boxes = following([soldier({ frame: 3 })], [soldier({ frame: 5, direction: EAST })], []);
    expect(boxes.frameOf(SOLDIER)).toBeNull();
    boxes.update([soldier({ frame: 5, direction: NORTHEAST })], sources);
    expect(boxes.frameOf(SOLDIER)?.direction).toBe(NORTHEAST);
    expect(boxes.frameOf(SOLDIER)?.scriptFrame).toBe(FIRST_STANDING_FRAME);
  });

  it('has no box for an animation without a sheet', () => {
    expect(following([soldier()], [soldier({ animation: NO_SURFACE, stateTick: 10 })]).frameOf(SOLDIER)).toBeNull();
  });
});
