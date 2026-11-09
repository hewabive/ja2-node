import { describe, expect, it } from 'vitest';
import { facingOfDirection } from '../../content/anim/soldier-sprite.ts';
import type { SoldierView } from '../../protocol/view.ts';
import type { SheetRequest } from './soldier-assets.ts';
import { type SheetFor, SoldierBoundingBoxes } from './soldier-bounding-boxes.ts';

const STANDING = 1;
const SOLDIER = 7;
const NORTH = 0;
const NORTHEAST = 1;
const EAST = 2;
const DRAWN_FRAME = 5;
const BOUNDING_FRAME = 2;
const BETWEEN_NORTH_AND_NORTHEAST = 2;
const NO_SURFACE = 99;
const RIFLE_SURFACE = 4;

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
    frame: DRAWN_FRAME,
    palettes: ['', '', '', ''],
    hand: '',
    surface: 0,
    frameSlot: 0,
    boundingFrame: BOUNDING_FRAME,
    stateTick: 0,
    frameDelay: 0,
    ...over,
  };
}

const sheetOf = (surface: number): SheetRequest => ({ id: `sheet${surface}`, surface });
const sheetFor: SheetFor = (s) => (s.surface === NO_SURFACE ? null : sheetOf(s.surface));

function following(...views: SoldierView[][]): SoldierBoundingBoxes {
  const boxes = new SoldierBoundingBoxes();
  for (const soldiers of views) boxes.update(soldiers, sheetFor);
  return boxes;
}

describe('the bounding box of a soldier (SetSoldierLocatorOffsets)', () => {
  it("takes the view's bounding frame, not the frame drawn", () => {
    expect(following([soldier()]).frameOf(SOLDIER)).toEqual({
      sheet: sheetOf(0),
      scriptFrame: BOUNDING_FRAME,
      facing: facingOfDirection(NORTH),
    });
  });

  it('takes the facing a turn kept from the frame converted before it', () => {
    const boxes = following([soldier({ direction: NORTHEAST, boundingDirection: NORTH })]);
    expect(boxes.frameOf(SOLDIER)?.facing).toEqual(facingOfDirection(NORTH));
  });

  it('takes the 32-step facing of a vehicle whose frame was converted between two directions', () => {
    const boxes = following([soldier({ boundingHiResDirection: BETWEEN_NORTH_AND_NORTHEAST })]);
    expect(boxes.frameOf(SOLDIER)?.facing).toEqual({ direction: NORTH, hiResDirection: BETWEEN_NORTH_AND_NORTHEAST });
  });

  it('keeps the sheet shown when the box was set while the surface changes without a start or a turn', () => {
    const boxes = following([soldier()], [soldier({ surface: RIFLE_SURFACE })]);
    expect(boxes.frameOf(SOLDIER)?.sheet).toEqual(sheetOf(0));
  });

  it('takes the sheet shown again at a turn', () => {
    const boxes = following([soldier()], [soldier({ surface: RIFLE_SURFACE, direction: EAST, boundingDirection: NORTH })]);
    expect(boxes.frameOf(SOLDIER)?.sheet).toEqual(sheetOf(RIFLE_SURFACE));
  });

  it('falls back to the frame drawn for a view without a bounding frame', () => {
    const { boundingFrame: _, ...withoutBounding } = soldier();
    expect(following([withoutBounding]).frameOf(SOLDIER)?.scriptFrame).toBe(DRAWN_FRAME);
  });

  it('forgets a soldier who leaves the view', () => {
    expect(following([soldier()], []).frameOf(SOLDIER)).toBeNull();
  });

  it('has no box for an animation without a sheet', () => {
    expect(following([soldier()], [soldier({ surface: NO_SURFACE, stateTick: 10 })]).frameOf(SOLDIER)).toBeNull();
  });
});
