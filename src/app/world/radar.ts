// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Radar_Screen.cc RenderRadarScreen, AdjustWorldCenterFromRadarCoords; RenderWorld.cc
// @src InitRenderParams (radar scale), ApplyScrolling (gsTopLeftWorldX/Y); src/game/Tactical/Soldier_Find.cc GridNoOnScreen

import { rgb565ToRgba } from '../../content/formats/rgb565.ts';
import { decodeSti, type Sti } from '../../content/formats/sti.ts';
import { WORLD_TILE_X, WORLD_TILE_Y } from '../../content/world/grid.ts';
import { absoluteScreenXY, gridNoOnVisibleWorldTile, renderBounds, renderedScreenSize } from '../../content/world/render-bounds.ts';
import { idiv } from '../../core/int.ts';
import { cellToScreen, screenToCell } from '../../render/world/camera.ts';
import { type Camera, mapCenter, type Viewport } from '../../render/world/geometry.ts';
import { fetchVfsFile, type ReadVfsFile } from '../net/vfs.ts';

export const RADAR_WIDTH = 88;
export const RADAR_HEIGHT = 44;
const RADAR_CENTRE_X = RADAR_WIDTH / 2;
const RADAR_CENTRE_Y = RADAR_HEIGHT / 2;
const SCROLL_X_STEP = WORLD_TILE_X;
const SCROLL_Y_STEP = WORLD_TILE_Y * 2;
const SCROLL_LEFT_PADDING = -30;
const SCROLL_RIGHT_PADDING = 10;
const SCROLL_TOP_PADDING = -50;
const SCROLL_BOTTOM_PADDING = -20;
const CENTER_WORLD_X = 800;
const CENTER_WORLD_Y = 800;
const VIEW_CENTRE_LIFT = 10;
const ON_SCREEN_ALLOWANCE = 20;
const ON_SCREEN_ALLOWANCE_UNDER_TOP_BAR = 40;
const ON_SCREEN_BOTTOM_ALLOWANCE = 20;

export interface RadarBox {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface RadarScale {
  readonly x: number;
  readonly y: number;
}

type ViewOnMap = Viewport & { readonly camera: Camera };

export function radarPathForMap(mapPath: string): string {
  return mapPath.replace(/(^|\/)maps\/([^/]+)\.dat$/, '$1radarmaps/$2.sti');
}

export function radarPixels(sti: Sti): Uint8ClampedArray<ArrayBuffer> | null {
  const rgba = new Uint8ClampedArray(RADAR_WIDTH * RADAR_HEIGHT * 4);
  if (sti.kind === 'rgb') {
    rgba.set(rgb565ToRgba(sti.pixels).subarray(0, rgba.length));
    return rgba;
  }
  const frame = sti.subImages[0];
  if (!frame) return null;
  for (let y = 0; y < Math.min(frame.height, RADAR_HEIGHT); y++) {
    for (let x = 0; x < Math.min(frame.width, RADAR_WIDTH); x++) {
      const index = frame.pixels[y * frame.width + x] ?? 0;
      rgba.set(
        [sti.palette[index * 3] ?? 0, sti.palette[index * 3 + 1] ?? 0, sti.palette[index * 3 + 2] ?? 0, 255],
        (y * RADAR_WIDTH + x) * 4,
      );
    }
  }
  return rgba;
}

export async function loadRadarPixels(
  mapPath: string,
  available: ReadonlySet<string>,
  read: ReadVfsFile = fetchVfsFile,
): Promise<Uint8ClampedArray<ArrayBuffer> | null> {
  const path = radarPathForMap(mapPath);
  if (!available.has(path)) return null;
  return radarPixels(decodeSti(await read(path)));
}

export function radarScale(restrictedScrollId: number): RadarScale {
  const { width, height } = renderedScreenSize(restrictedScrollId);
  return { x: RADAR_WIDTH / width, y: RADAR_HEIGHT / height };
}

const roundHalfAwayFromZero = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

const snapToStep = (v: number, centre: number, step: number) => idiv(v - centre, step) * step + centre;

export function radarRenderCenter(restrictedScrollId: number, radarX: number, radarY: number, v: Viewport): Camera {
  const scale = radarScale(restrictedScrollId);
  const centre = mapCenter(v);
  const screenX = snapToStep(Math.trunc((radarX - RADAR_CENTRE_X) / scale.x), centre.x, SCROLL_X_STEP);
  const screenY = snapToStep(Math.trunc((radarY - RADAR_CENTRE_Y) / scale.y), centre.y, SCROLL_Y_STEP);
  const cell = screenToCell(screenX, screenY);
  return { centerX: CENTER_WORLD_X + cell.x, centerY: CENTER_WORLD_Y + cell.y };
}

export function visibleWorldBox(restrictedScrollId: number, o: ViewOnMap): RadarBox {
  const bounds = renderBounds(restrictedScrollId);
  const centre = mapCenter(o);
  const screen = cellToScreen(o.camera.centerX, o.camera.centerY);
  const screenY = screen.y - VIEW_CENTRE_LIFT;
  return {
    x1: screen.x - centre.x - bounds.leftX,
    y1: screenY - centre.y - bounds.topY,
    x2: screen.x + centre.x - bounds.leftX,
    y2: screenY + centre.y - bounds.topY,
  };
}

export function gridNoOnScreen(restrictedScrollId: number, gridNo: number, o: ViewOnMap, underTopBar: boolean): boolean {
  const box = visibleWorldBox(restrictedScrollId, o);
  const at = absoluteScreenXY(restrictedScrollId, gridNo);
  const allowance = underTopBar ? ON_SCREEN_ALLOWANCE_UNDER_TOP_BAR : ON_SCREEN_ALLOWANCE;
  return box.x1 <= at.x && at.x <= box.x2 && box.y1 + allowance <= at.y && at.y <= box.y2 + ON_SCREEN_BOTTOM_ALLOWANCE;
}

export function radarDotOf(restrictedScrollId: number, gridNo: number): { readonly x: number; readonly y: number } | null {
  if (!gridNoOnVisibleWorldTile(restrictedScrollId, gridNo)) return null;
  const at = absoluteScreenXY(restrictedScrollId, gridNo);
  const scale = radarScale(restrictedScrollId);
  return { x: Math.floor(at.x * scale.x), y: Math.floor(at.y * scale.y) };
}

export function radarViewportBox(restrictedScrollId: number, o: ViewOnMap): RadarBox {
  const box = visibleWorldBox(restrictedScrollId, o);
  const scale = radarScale(restrictedScrollId);
  return {
    x1: Math.max(0, roundHalfAwayFromZero((box.x1 - SCROLL_LEFT_PADDING) * scale.x)),
    y1: Math.max(0, roundHalfAwayFromZero((box.y1 - SCROLL_TOP_PADDING) * scale.y)),
    x2: Math.min(roundHalfAwayFromZero((box.x2 - SCROLL_RIGHT_PADDING - SCROLL_LEFT_PADDING) * scale.x - 1), RADAR_WIDTH - 1),
    y2: Math.min(roundHalfAwayFromZero((box.y2 - SCROLL_BOTTOM_PADDING - SCROLL_TOP_PADDING) * scale.y - 1), RADAR_HEIGHT - 1),
  };
}
