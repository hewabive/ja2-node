import { describe, expect, it } from 'vitest';
import {
  FAST_UNIT_TIME,
  LOAD_UNITS,
  LoadPending,
  loadUnitTime,
  slideFinished,
  slideStep,
  TITLE_BAR_ITERATIONS,
  titleBarSlideRect,
  UNIT_TIME,
  zoomPercentage,
  zoomRect,
} from './laptop-timers.ts';

const FRAME_MS = 16;

function framesUntilDone(load: LoadPending): number {
  let frames = 0;
  while (!load.update(frames * FRAME_MS)) frames++;
  return frames;
}

describe('the laptop timers', () => {
  it('picks the unit time of a page load and scales it by the client setting', () => {
    expect(loadUnitTime({ fast: false, subPage: false, slowSite: false }, 1)).toBe(UNIT_TIME);
    expect(loadUnitTime({ fast: true, subPage: false, slowSite: false }, 1)).toBe(FAST_UNIT_TIME);
    expect(loadUnitTime({ fast: true, subPage: true, slowSite: false }, 1)).toBe(2);
    expect(loadUnitTime({ fast: false, subPage: true, slowSite: false }, 1)).toBe(25);
    expect(loadUnitTime({ fast: false, subPage: false, slowSite: true }, 1)).toBe(120);
    expect(loadUnitTime({ fast: false, subPage: false, slowSite: false }, 0)).toBe(0);
    expect(loadUnitTime({ fast: false, subPage: false, slowSite: false }, 2.5)).toBe(100);
  });

  it('accounts a unit only when more than its time passed and finishes after thirty units', () => {
    const load = new LoadPending({ fast: false, subPage: false, slowSite: false }, 1);
    expect(load.update(0)).toBe(false);
    expect(load.update(40)).toBe(false);
    expect(load.total).toBe(0);
    expect(load.update(41)).toBe(false);
    expect(load.total).toBe(41);
    expect(load.segments()).toBe(2);
    const frames = framesUntilDone(new LoadPending({ fast: false, subPage: false, slowSite: false }, 1));
    expect(frames * FRAME_MS).toBeGreaterThanOrEqual(UNIT_TIME * LOAD_UNITS);
  });

  it('finishes at once when the World Wide Wait is switched off', () => {
    const load = new LoadPending({ fast: false, subPage: false, slowSite: false }, 0);
    expect(load.update(0)).toBe(true);
    expect(load.done).toBe(true);
  });

  it('slides the title bar in eighteen fixed steps and snaps the last one', () => {
    expect(slideStep(true, 0, FRAME_MS)).toBe(1);
    expect(slideFinished(true, slideStep(true, (TITLE_BAR_ITERATIONS - 1) * FRAME_MS, FRAME_MS))).toBe(false);
    expect(slideFinished(true, slideStep(true, TITLE_BAR_ITERATIONS * FRAME_MS, FRAME_MS))).toBe(true);
    expect(slideStep(false, 0, FRAME_MS)).toBe(TITLE_BAR_ITERATIONS - 1);
    expect(slideFinished(false, slideStep(false, TITLE_BAR_ITERATIONS * FRAME_MS, FRAME_MS))).toBe(true);
    expect(slideFinished(true, slideStep(true, 0, 0))).toBe(true);
    expect(slideFinished(false, slideStep(false, 0, 0))).toBe(true);
    const ends = { startX: 0, startRightX: 36, startY: 66, endX: 111, endRightX: 600, endY: 27, height: 19 };
    expect(titleBarSlideRect(ends, 0)).toEqual({ x: 0, y: 66, width: 36, height: 19 });
    expect(titleBarSlideRect(ends, 9)).toEqual({ x: 55, y: 46, width: 263, height: 19 });
    expect(titleBarSlideRect(ends, TITLE_BAR_ITERATIONS)).toEqual({ x: 111, y: 27, width: 489, height: 19 });
  });

  it('zooms from the laptop icon to the full screen over one second', () => {
    expect(zoomPercentage(0, true)).toBe(0);
    expect(zoomPercentage(500, true)).toBe(50);
    expect(zoomPercentage(2000, true)).toBe(100);
    expect(zoomPercentage(250, false)).toBe(75);
    expect(zoomRect(0)).toEqual({ x: 464, y: 417, width: 12, height: 9 });
    expect(zoomRect(100)).toEqual({ x: 1, y: 1, width: 639, height: 479 });
    const half = zoomRect(50);
    expect(half.width).toBe(24);
    expect(half.height).toBe(18);
  });
});
