import { describe, expect, it } from 'vitest';
import { gridNo, isVisibleTile, WORLD_COLS, WORLD_MAX } from './grid.ts';
import {
  absoluteScreenXY,
  gridNoOnVisibleWorldTile,
  mapPosFromAbsoluteScreenXY,
  RestrictedScroll,
  renderBounds,
  renderedScreenSize,
} from './render-bounds.ts';

function visibleTiles(restrictedScrollId: number): number[] {
  return Array.from({ length: WORLD_MAX }, (_, g) => g).filter((g) => gridNoOnVisibleWorldTile(restrictedScrollId, g));
}

describe('render bounds per scroll restriction', () => {
  it('match InitRenderParams for the default and the basement maps', () => {
    expect(renderBounds(RestrictedScroll.NONE)).toEqual({ leftX: -1580, topY: 860, rightX: 1600, bottomY: 2400 });
    expect(renderBounds(RestrictedScroll.BASEMENT)).toEqual({ leftX: -640, topY: 1330, rightX: 640, bottomY: 1920 });
    expect(renderedScreenSize(RestrictedScroll.BASEMENT)).toEqual({ width: 1280, height: 590 });
  });

  it('put a tile 25 px below its north vertex in the absolute frame, as gsCY = 1625 does', () => {
    expect(absoluteScreenXY(RestrictedScroll.NONE, gridNo(80, 80))).toEqual({ x: 1580, y: 765 });
    expect(absoluteScreenXY(RestrictedScroll.BASEMENT, gridNo(80, 80))).toEqual({ x: 640, y: 295 });
  });

  it('map absolute screen positions back to their tiles on both restrictions', () => {
    for (const restriction of [RestrictedScroll.NONE, RestrictedScroll.BASEMENT]) {
      for (const g of [gridNo(70, 90), gridNo(80, 80), gridNo(95, 75)]) {
        const { x, y } = absoluteScreenXY(restriction, g);
        expect(mapPosFromAbsoluteScreenXY(restriction, x, y)).toBe(g);
      }
    }
  });
});

describe('the visible world tile test', () => {
  it('equals the full-map diamond without a restriction', () => {
    const differing = Array.from({ length: WORLD_MAX }, (_, g) => g).filter(
      (g) => gridNoOnVisibleWorldTile(RestrictedScroll.NONE, g) !== isVisibleTile(g),
    );
    expect(differing).toEqual([]);
    expect(visibleTiles(RestrictedScroll.NONE)).toHaveLength(11775);
  });

  it('keeps a basement to 133 <= x+y <= 187 and -31 <= x-y <= 30', () => {
    const basement = visibleTiles(RestrictedScroll.BASEMENT);
    const inBox = (g: number) => {
      const x = g % WORLD_COLS;
      const y = Math.trunc(g / WORLD_COLS);
      return x + y >= 133 && x + y <= 187 && x - y >= -31 && x - y <= 30;
    };
    expect(basement.every(inBox)).toBe(true);
    expect(Array.from({ length: WORLD_MAX }, (_, g) => g).filter(inBox)).toHaveLength(basement.length);
    expect(gridNoOnVisibleWorldTile(RestrictedScroll.BASEMENT, gridNo(80, 80))).toBe(true);
    expect(gridNoOnVisibleWorldTile(RestrictedScroll.BASEMENT, gridNo(112, 80))).toBe(false);
    expect(isVisibleTile(gridNo(112, 80))).toBe(true);
  });

  it('rejects positions off the array on every restriction', () => {
    for (const restriction of [RestrictedScroll.NONE, RestrictedScroll.BASEMENT]) {
      expect(gridNoOnVisibleWorldTile(restriction, -1)).toBe(false);
      expect(gridNoOnVisibleWorldTile(restriction, WORLD_MAX)).toBe(false);
    }
  });
});
