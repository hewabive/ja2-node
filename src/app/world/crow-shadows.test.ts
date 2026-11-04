import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../protocol/view.ts';
import { CrowShadows, nextShadowFrame } from './crow-shadows.ts';

const CROW_FLY = 120;
const CROW_EAT = 121;
const CROW = 19;
const FRAMES = 14;
const DELAY = 50;
const SOUTH = 4;
const EAST = 2;

function crow(over: Partial<SoldierView> = {}): SoldierView {
  return {
    id: 40,
    team: 3,
    name: '',
    bodyType: CROW,
    gridNo: 1000,
    x: 805.7,
    y: 845.2,
    level: 1,
    heightAdjustment: 20,
    direction: SOUTH,
    animation: CROW_FLY,
    frame: 0,
    palettes: ['', '', '', ''],
    hand: '',
    surface: 0,
    frameSlot: 0,
    stateTick: 0,
    frameDelay: DELAY,
    ...over,
  };
}

const frames = () => FRAMES;
const southFirst = FRAMES * ((SOUTH + 1) % 8);

describe('crow shadows (HandleCrowShadowNewGridNo)', () => {
  it('shows no shadow for a crow that comes into sight flying until he reaches another tile', () => {
    const shadows = new CrowShadows(CROW_FLY);
    expect(shadows.update([crow()], 0, frames)).toEqual([]);
    expect(shadows.update([crow({ x: 808 })], 30, frames)).toEqual([]);
    expect(shadows.update([crow({ gridNo: 1001, x: 812.9 })], 60, frames)).toEqual([{ gridNo: 1001, x: 812, y: 845, frame: southFirst }]);
  });

  it('starts the shadow only on the tile after the take-off: the flight state is switched on before it is set', () => {
    const shadows = new CrowShadows(CROW_FLY);
    shadows.update([crow({ animation: CROW_EAT, heightAdjustment: 0, level: 0 })], 0, frames);
    expect(shadows.update([crow({ heightAdjustment: 2 })], 10, frames)).toEqual([]);
    expect(shadows.update([crow({ gridNo: 1001 })], 20, frames)).toHaveLength(1);
  });

  it('loops the frames of his direction at his frame delay and restarts them on each new tile', () => {
    const shadows = new CrowShadows(CROW_FLY);
    shadows.update([crow()], 0, frames);
    const at = (gridNo: number, ms: number) => shadows.update([crow({ gridNo })], ms, frames)[0]?.frame;
    expect([at(1001, 100), at(1001, 149), at(1001, 150), at(1001, 100 + DELAY * FRAMES)]).toEqual([
      southFirst,
      southFirst,
      southFirst + 1,
      southFirst,
    ]);
    expect(at(1002, 100 + DELAY * FRAMES + 60)).toBe(southFirst);
  });

  it('runs on through the frames of the next directions after a turn to a later block, and jumps back after a turn to an earlier one', () => {
    const southLast = southFirst + FRAMES - 1;
    expect(nextShadowFrame(southLast, SOUTH + 1, FRAMES)).toBe(southLast + 1);
    expect(nextShadowFrame(southFirst + 3, EAST, FRAMES)).toBe(FRAMES * (EAST + 1));
  });

  it('drops the shadow when the crow lands or leaves the view, and keeps it while he fades out', () => {
    const shadows = new CrowShadows(CROW_FLY);
    shadows.update([crow()], 0, frames);
    expect(shadows.update([crow({ gridNo: 1001, fadingOut: true })], 10, frames)).toHaveLength(1);
    expect(shadows.update([crow({ gridNo: 1001, animation: CROW_EAT })], 20, frames)).toEqual([]);
    expect(shadows.update([crow({ gridNo: 1002 })], 30, frames)).toHaveLength(1);
    expect(shadows.update([], 40, frames)).toEqual([]);
    expect(shadows.update([crow({ gridNo: 1003 })], 50, frames)).toEqual([]);
  });
});
