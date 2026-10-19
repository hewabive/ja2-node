import { describe, expect, it } from 'vitest';
import { autoUiScale, resolveResolution, toLogical } from './resolution.ts';

describe('the UI scale and the logical resolution (docs/28 §2.6)', () => {
  it('picks the largest integer scale that keeps 640×480', () => {
    expect(autoUiScale(1920, 1080)).toBe(2);
    expect(autoUiScale(2560, 1440)).toBe(3);
    expect(autoUiScale(1280, 720)).toBe(1);
    expect(autoUiScale(600, 400)).toBe(1);
  });

  it('derives the logical size and the std640 frame origin', () => {
    expect(resolveResolution(1920, 1080)).toEqual({
      scale: 2,
      logicalWidth: 960,
      logicalHeight: 540,
      viewX: 0,
      viewY: 0,
      viewWidth: 1920,
      viewHeight: 1080,
      stdScreenX: 160,
      stdScreenY: 30,
    });
    expect(resolveResolution(2560, 1440)).toMatchObject({ scale: 3, logicalWidth: 853, logicalHeight: 480, viewX: 0, viewWidth: 2559 });
    expect(resolveResolution(1280, 960)).toMatchObject({ scale: 2, logicalWidth: 640, logicalHeight: 480, stdScreenX: 0, stdScreenY: 0 });
  });

  it('honours a forced scale and the 640×480-only option with black bars', () => {
    expect(resolveResolution(1920, 1080, { scale: 1, fixed640: false })).toMatchObject({ logicalWidth: 1920, logicalHeight: 1080 });
    expect(resolveResolution(1920, 1080, { scale: 0, fixed640: true })).toMatchObject({
      scale: 2,
      logicalWidth: 640,
      logicalHeight: 480,
      viewX: 320,
      viewY: 60,
      viewWidth: 1280,
      viewHeight: 960,
      stdScreenX: 0,
      stdScreenY: 0,
    });
    expect(resolveResolution(1920, 1080, { scale: 3, fixed640: false })).toMatchObject({
      logicalWidth: 640,
      logicalHeight: 480,
      viewHeight: 1080,
    });
  });

  it('shrinks to fit when even 640×480 does not fit the canvas', () => {
    expect(resolveResolution(320, 480)).toMatchObject({
      scale: 1,
      logicalWidth: 640,
      logicalHeight: 480,
      viewWidth: 320,
      viewHeight: 240,
      viewY: 120,
    });
  });

  it('maps device pixels to logical pixels through the letterbox', () => {
    const r = resolveResolution(1920, 1080, { scale: 0, fixed640: true });
    expect(toLogical(r, 320, 60)).toEqual({ x: 0, y: 0 });
    expect(toLogical(r, 321, 61)).toEqual({ x: 0, y: 0 });
    expect(toLogical(r, 322, 62)).toEqual({ x: 1, y: 1 });
    expect(toLogical(r, 1599, 1019)).toEqual({ x: 639, y: 479 });
    expect(toLogical(r, 300, 50)).toEqual({ x: -10, y: -5 });
  });
});
