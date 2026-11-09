import { describe, expect, it } from 'vitest';
import { testRuntime } from '../../../../tests/support/ui-runtime.ts';
import { LOW_PERCENT_SHADOW_FACTOR } from '../../draw-list.ts';
import type { Screen } from '../../screen.ts';
import {
  SECTOR_ZOOM_SHADE_STEP_MS,
  SECTOR_ZOOM_TIME,
  SectorZoom,
  sectorZoomPercentage,
  sectorZoomShadePasses,
  sectorZoomSource,
} from './sector-zoom.ts';

const WIDE = { width: 960, height: 540 };

function idleScreen(): Screen {
  return { id: 'map', enter: () => undefined, exit: () => undefined, update: () => undefined, input: () => false, render: () => undefined };
}

describe('the zoom into a sector', () => {
  it('bends the percentage by the gravity factor over 2000 ms and truncates it after the bend', () => {
    expect(sectorZoomPercentage(0)).toBe(0);
    expect(sectorZoomPercentage(200)).toBe(2);
    expect(sectorZoomPercentage(500)).toBe(13);
    expect(sectorZoomPercentage(SECTOR_ZOOM_TIME / 2)).toBe(50);
    expect(sectorZoomPercentage(1020)).toBe(52);
    expect(sectorZoomPercentage(1500)).toBe(87);
    expect(sectorZoomPercentage(SECTOR_ZOOM_TIME * 2)).toBe(100);
  });

  it('adds 0.05 where the first half adds 0.5, so 98 % is drawn as 99 % and the zoom ends at 99 % of its time', () => {
    expect(sectorZoomPercentage(1960)).toBe(99);
    expect(sectorZoomPercentage(1980)).toBe(100);
  });

  it('stretches the screen from a rectangle that closes in on 536, 367 and keeps 99 by 74 pixels at 640 by 480', () => {
    expect(sectorZoomSource(0, 640, 480)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
    expect(sectorZoomSource(50, 640, 480)).toEqual({ x: 268, y: 183, width: 370, height: 277 });
    expect(sectorZoomSource(100, 640, 480)).toEqual({ x: 536, y: 367, width: 99, height: 74 });
  });

  it('aims at the same pixels on a wider screen, as the constants are not moved by STD_SCREEN_X and STD_SCREEN_Y', () => {
    expect(sectorZoomSource(100, WIDE.width, WIDE.height)).toEqual({ x: 536, y: 367, width: 419, height: 134 });
  });

  it('shades the saved screen once more every 16 ms once the percentage is past half way', () => {
    expect(sectorZoomShadePasses(1008)).toBe(0);
    expect(sectorZoomShadePasses(1024)).toBe(1);
    expect(sectorZoomShadePasses(1024 + SECTOR_ZOOM_SHADE_STEP_MS * 9)).toBe(10);
  });

  it('draws the frozen screen stretched over the whole screen without a cursor, shaded past half way, and ends after its last frame', async () => {
    const done: string[] = [];
    const pauses: boolean[] = [];
    const t = await testRuntime(undefined, { pauseGame: (paused) => pauses.push(paused) });
    t.runtime.host.push(idleScreen());
    const zoom = new SectorZoom(t.runtime, () => done.push('done'));
    t.runtime.host.openModal(zoom);
    t.frame();
    expect(zoom.hidesCursor).toBe(true);
    expect(t.list.items.find((i) => i.kind === 'snapshot')).toMatchObject({ x: 0, y: 0, width: 640, height: 480 });
    for (let elapsed = 0; elapsed < 1024; elapsed += 16) t.frame(16);
    expect(t.list.items.find((i) => i.kind === 'shadow')).toMatchObject({ factor: LOW_PERCENT_SHADOW_FACTOR });
    for (let elapsed = 1024; elapsed < 1980; elapsed += 16) t.frame(16);
    expect(t.runtime.host.modal).toBe(zoom);
    t.frame(16);
    t.frame(16);
    expect(done).toEqual(['done']);
    expect(t.runtime.host.modal).toBeNull();
    expect(pauses).toEqual([true, false]);
  });
});
