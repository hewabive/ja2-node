// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Radar_Screen.cc RenderRadarScreen, RadarRegionButtonCallback; RenderWorld.cc InitRenderParams;
// @src src/game/TileEngine/Isometric_Utils.cc GetAbsoluteScreenXYFromMapPos; src/game/Tactical/Soldier_Find.cc GridNoOnScreen

import { rgb565ToRgba } from '../../content/formats/rgb565.ts';
import { decodeSti, type Sti } from '../../content/formats/sti.ts';
import { WORLD_COLS } from '../../content/world/grid.ts';
import type { Camera, Viewport } from '../../render/world/geometry.ts';
import { fetchVfsFile, type ReadVfsFile } from '../net/vfs.ts';

export const RADAR_WIDTH = 88;
export const RADAR_HEIGHT = 44;
const LEFT_X = -1580;
const RIGHT_X = 1600;
const TOP_Y = 860;
const BOTTOM_Y = 2400;
const SCALE_X = RADAR_WIDTH / (RIGHT_X - LEFT_X);
const SCALE_Y = RADAR_HEIGHT / (BOTTOM_Y - TOP_Y);
const CELL_BLOCK = 10;
const CELL_BLOCK_CENTRE = 5;
const CELL_SIZE = 10;
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

export interface RadarCell {
  readonly cellX: number;
  readonly cellY: number;
}

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

export function radarCellAt(fractionX: number, fractionY: number): RadarCell {
  const ax = (fractionX * RADAR_WIDTH) / SCALE_X + LEFT_X;
  const ay = (fractionY * RADAR_HEIGHT) / SCALE_Y + TOP_Y;
  const cellX = Math.round((ax / 2 + ay) / 2);
  const cellY = Math.round((ay - ax / 2) / 2);
  return {
    cellX: Math.floor(cellX / CELL_BLOCK) * CELL_BLOCK + CELL_BLOCK_CENTRE,
    cellY: Math.floor(cellY / CELL_BLOCK) * CELL_BLOCK + CELL_BLOCK_CENTRE,
  };
}

export function visibleWorldBox(o: Viewport & { readonly camera: Camera }): RadarBox {
  const { centerX, centerY } = o.camera;
  const screenX = 2 * (centerX - centerY);
  const screenY = centerX + centerY - VIEW_CENTRE_LIFT;
  return {
    x1: screenX - Math.floor(o.width / 2) - LEFT_X,
    y1: screenY - Math.floor(o.height / 2) - TOP_Y,
    x2: screenX + Math.floor(o.width / 2) - LEFT_X,
    y2: screenY + Math.floor(o.height / 2) - TOP_Y,
  };
}

export function absoluteScreenOfGridNo(gridNo: number): { readonly x: number; readonly y: number } {
  const cellX = (gridNo % WORLD_COLS) * CELL_SIZE;
  const cellY = Math.floor(gridNo / WORLD_COLS) * CELL_SIZE;
  return { x: 2 * (cellX - cellY) - LEFT_X, y: cellX + cellY - TOP_Y };
}

export function gridNoOnScreen(gridNo: number, o: Viewport & { readonly camera: Camera }, underTopBar: boolean): boolean {
  const box = visibleWorldBox(o);
  const at = absoluteScreenOfGridNo(gridNo);
  const allowance = underTopBar ? ON_SCREEN_ALLOWANCE_UNDER_TOP_BAR : ON_SCREEN_ALLOWANCE;
  return box.x1 <= at.x && at.x <= box.x2 && box.y1 + allowance <= at.y && at.y <= box.y2 + ON_SCREEN_BOTTOM_ALLOWANCE;
}

export function radarDotOf(gridNo: number): { readonly x: number; readonly y: number } {
  const at = absoluteScreenOfGridNo(gridNo);
  return { x: Math.floor(at.x * SCALE_X), y: Math.floor(at.y * SCALE_Y) };
}

export function radarViewportBox(o: Viewport & { readonly camera: Camera }): RadarBox {
  const { x1: topLeftX, y1: topLeftY, x2: bottomRightX, y2: bottomRightY } = visibleWorldBox(o);
  return {
    x1: Math.max(0, Math.round((topLeftX + 30) * SCALE_X)),
    y1: Math.max(0, Math.round((topLeftY + 50) * SCALE_Y)),
    x2: Math.min(Math.round((bottomRightX + 20) * SCALE_X - 1), RADAR_WIDTH - 1),
    y2: Math.min(Math.round((bottomRightY + 70) * SCALE_Y - 1), RADAR_HEIGHT - 1),
  };
}
