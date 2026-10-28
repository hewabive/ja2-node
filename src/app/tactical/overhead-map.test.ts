import { describe, expect, it } from 'vitest';
import { gridNo, WORLD_MAX } from '../../content/world/grid.ts';
import type { LoadedWorld } from '../world/world-loader.ts';
import { OverheadPicture } from './overhead-map.ts';

const MAP_CENTRE = gridNo(80, 80);
const RAISED_LAND = 80;
const RENDER_HEIGHT = 40;

function flatWorld(renderHeight = 0): { readonly world: LoadedWorld; readonly heights: Uint8Array } {
  const heights = new Uint8Array(WORLD_MAX);
  const world = { level: { heights }, prepared: { renderHeight } } as unknown as LoadedWorld;
  return { world, heights };
}

describe('the overhead map projection', () => {
  it('places a cell at its absolute screen point over five, five pixels in', () => {
    const picture = new OverheadPicture('overhead', flatWorld().world);
    expect(picture.pointOf(MAP_CENTRE)).toEqual({ x: 321, y: 158 });
    expect(picture.pointOf(gridNo(81, 80))).toEqual({ x: 325, y: 160 });
    expect(picture.pointOf(gridNo(80, 81))).toEqual({ x: 317, y: 160 });
  });

  it('lifts a cell by its land height and lowers it by the render height', () => {
    const { world, heights } = flatWorld(RENDER_HEIGHT);
    heights[MAP_CENTRE] = RAISED_LAND;
    expect(new OverheadPicture('overhead', world).pointOf(MAP_CENTRE)).toEqual({ x: 321, y: 158 - 16 + 8 });
  });

  it('finds the cell under the pointer eight rows above it', () => {
    const picture = new OverheadPicture('overhead', flatWorld().world);
    expect(picture.gridNoAt(321, 163)).toBe(MAP_CENTRE);
    expect(picture.gridNoAt(325, 165)).toBe(gridNo(81, 80));
    expect(picture.gridNoAt(700, 0)).toBeNull();
  });
});
