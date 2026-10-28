import { describe, expect, it } from 'vitest';
import { decodeSti, encodeStiIndexed } from '../../content/formats/sti.ts';
import { gridNo } from '../../content/world/grid.ts';
import { RestrictedScroll } from '../../content/world/render-bounds.ts';
import {
  gridNoOnScreen,
  RADAR_HEIGHT,
  RADAR_WIDTH,
  radarDotOf,
  radarPathForMap,
  radarPixels,
  radarRenderCenter,
  radarScale,
  radarViewportBox,
} from './radar.ts';

const VIEW = { width: 640, height: 360 };
const ON_MAP_CENTRE = { ...VIEW, camera: { centerX: 805, centerY: 805 } };
const { NONE, BASEMENT } = RestrictedScroll;

describe('the radar logic', () => {
  it('finds the radar map of a sector map', () => {
    expect(radarPathForMap('maps/a9.dat')).toBe('radarmaps/a9.sti');
    expect(radarPathForMap('stubs/world/maps/village.dat')).toBe('stubs/world/radarmaps/village.sti');
  });

  it('scales the rendered world of each restriction onto the 88 x 44 radar', () => {
    expect(radarScale(NONE)).toEqual({ x: 88 / 3180, y: 44 / 1540 });
    expect(radarScale(BASEMENT)).toEqual({ x: 88 / 1280, y: 44 / 590 });
  });

  it('places soldier dots by the absolute screen position of their tile', () => {
    expect(radarDotOf(NONE, gridNo(80, 80))).toEqual({ x: 43, y: 21 });
    expect(radarDotOf(BASEMENT, gridNo(80, 80))).toEqual({ x: 44, y: 22 });
    expect(radarDotOf(NONE, gridNo(112, 80))).toEqual({ x: 61, y: 31 });
  });

  it('shows no dot for a soldier outside the visible world of the map', () => {
    expect(radarDotOf(BASEMENT, gridNo(112, 80))).toBeNull();
    expect(radarDotOf(NONE, gridNo(2, 2))).toBeNull();
  });

  it('draws the viewport box from the view corners in the frame of the map', () => {
    expect(radarViewportBox(NONE, ON_MAP_CENTRE)).toEqual({ x1: 36, y1: 17, x2: 52, y2: 27 });
    expect(radarViewportBox(BASEMENT, ON_MAP_CENTRE)).toEqual({ x1: 24, y1: 10, x2: 66, y2: 38 });
  });

  it('turns a radar click into a render centre in whole scroll steps around the world centre', () => {
    expect(radarRenderCenter(NONE, 44, 22, VIEW)).toEqual({ centerX: 810, centerY: 810 });
    expect(radarRenderCenter(BASEMENT, 44, 22, VIEW)).toEqual({ centerX: 810, centerY: 810 });
    expect(radarRenderCenter(NONE, 0, 0, VIEW)).toEqual({ centerX: 40, centerY: 820 });
    expect(radarRenderCenter(BASEMENT, 0, 0, VIEW)).toEqual({ centerX: 510, centerY: 830 });
  });

  it('counts a tile as on screen inside the view box with the merc allowance', () => {
    for (const restriction of [NONE, BASEMENT]) {
      expect(gridNoOnScreen(restriction, gridNo(80, 80), ON_MAP_CENTRE, false)).toBe(true);
      expect(gridNoOnScreen(restriction, gridNo(100, 100), ON_MAP_CENTRE, false)).toBe(false);
    }
  });

  it('turns an indexed radar picture into RGBA through its palette', () => {
    const palette = new Uint8Array(768);
    palette.set([10, 20, 30], 3);
    const sti = decodeSti(
      encodeStiIndexed({ palette, subImages: [{ offsetX: 0, offsetY: 0, width: 2, height: 1, pixels: Uint8Array.of(1, 0) }] }),
    );
    const rgba = radarPixels(sti);
    expect(rgba).toHaveLength(RADAR_WIDTH * RADAR_HEIGHT * 4);
    expect([...(rgba ?? new Uint8ClampedArray()).subarray(0, 8)]).toEqual([10, 20, 30, 255, 0, 0, 0, 255]);
  });
});
