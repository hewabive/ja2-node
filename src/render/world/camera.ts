// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc InitRenderParams, ApplyScrolling, HandleScrollDirections, SetRenderCenter;
// @src src/game/TileEngine/Isometric_Utils.cc FromCellToScreenCoordinates, FromScreenToCellCoordinates;
// @src src/game/Tactical/Interface.h scroll paddings. See docs/05-render-pipeline.md §1.3, §1.4.

import { WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';
import { type Camera, mapCenter, ROOF_LEVEL_HEIGHT, type Viewport } from './geometry.ts';

const CELL_SIZE = 10;
const HALF_CELL = 5;
const SCREEN_CENTER_OFFSET_Y = 10;
const SCROLL_LEFT_PADDING = -30;
const SCROLL_RIGHT_PADDING = 10;
const SCROLL_TOP_PADDING = -50;
const SCROLL_BOTTOM_PADDING = -20;
const MAP_CENTER_SCREEN_X = 0;
const MAP_CENTER_SCREEN_Y = 1625;

export type ScrollAxis = 'horizontal' | 'vertical' | 'any';

export interface ScrollLimits {
  readonly leftX: number;
  readonly rightX: number;
  readonly topY: number;
  readonly bottomY: number;
}

export function scrollLimits(restrictedScrollId: number): ScrollLimits {
  const restricted = restrictedScrollId === 1;
  const topLeft = restricted
    ? { x: (CELL_SIZE * WORLD_ROWS * 3) / 10, y: (CELL_SIZE * WORLD_ROWS) / 2 }
    : { x: CELL_SIZE, y: (CELL_SIZE * WORLD_ROWS) / 2 };
  const bottomRight = restricted
    ? { x: (CELL_SIZE * WORLD_ROWS * 7) / 10, y: (CELL_SIZE * WORLD_ROWS) / 2 }
    : { x: CELL_SIZE * WORLD_COLS, y: (CELL_SIZE * WORLD_ROWS) / 2 };
  const a = cellToScreen(topLeft.x, topLeft.y);
  const b = cellToScreen(bottomRight.x, bottomRight.y);
  return { leftX: a.x, rightX: b.x, topY: a.y + ROOF_LEVEL_HEIGHT, bottomY: b.y };
}

export function cellToScreen(cellX: number, cellY: number): { readonly x: number; readonly y: number } {
  return { x: (cellX - cellY) * 2, y: cellX + cellY };
}

export function screenToCell(sx: number, sy: number): { readonly x: number; readonly y: number } {
  return { x: Math.floor((Math.fround(sx) / 2 + sy) / 2), y: Math.floor((sy - Math.fround(sx) / 2) / 2) };
}

export function snapToTileCentre(v: number): number {
  return Math.trunc(v / CELL_SIZE) * CELL_SIZE + HALF_CELL;
}

export function snapCamera(c: Camera): Camera {
  return { centerX: snapToTileCentre(c.centerX), centerY: snapToTileCentre(c.centerY) };
}

export function cameraOnGridNo(g: number): Camera {
  return { centerX: (g % WORLD_COLS) * CELL_SIZE + HALF_CELL, centerY: Math.floor(g / WORLD_COLS) * CELL_SIZE + HALF_CELL };
}

interface Outside {
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
}

function outside(screenCenter: { x: number; y: number }, half: { x: number; y: number }, l: ScrollLimits): Outside {
  return {
    left: l.leftX + SCROLL_LEFT_PADDING > screenCenter.x - half.x,
    right: l.rightX + SCROLL_RIGHT_PADDING < screenCenter.x + half.x,
    top: l.topY + SCROLL_TOP_PADDING >= screenCenter.y - half.y,
    bottom: l.bottomY + SCROLL_BOTTOM_PADDING < screenCenter.y + half.y,
  };
}

function forcedCenter(screenCenter: { x: number; y: number }, half: { x: number; y: number }, l: ScrollLimits, o: Outside, v: Viewport) {
  const mapHeight = l.bottomY + SCROLL_BOTTOM_PADDING - (l.topY + SCROLL_TOP_PADDING);
  const mapWidth = l.rightX + SCROLL_RIGHT_PADDING - (l.leftX + SCROLL_LEFT_PADDING);
  let x = screenCenter.x;
  let y = screenCenter.y;
  if (v.height > mapHeight) y = MAP_CENTER_SCREEN_Y + Math.trunc((SCROLL_TOP_PADDING + SCROLL_BOTTOM_PADDING) / 2);
  else if (o.top) y = l.topY + SCROLL_TOP_PADDING + half.y;
  else if (o.bottom) y = l.bottomY + SCROLL_BOTTOM_PADDING - half.y;
  if (v.width > mapWidth) x = MAP_CENTER_SCREEN_X + Math.trunc((SCROLL_LEFT_PADDING + SCROLL_RIGHT_PADDING) / 2);
  else if (o.left) x = l.leftX + SCROLL_LEFT_PADDING + half.x;
  else if (o.right) x = l.rightX + SCROLL_RIGHT_PADDING - half.x;
  return screenToCell(x, y);
}

export function applyScrolling(
  target: Camera,
  current: Camera,
  v: Viewport,
  l: ScrollLimits,
  axis: ScrollAxis,
  force: boolean,
): Camera | null {
  const snapped = snapCamera(target);
  const cell = cellToScreen(snapped.centerX, snapped.centerY);
  const screenCenter = { x: cell.x, y: cell.y - SCREEN_CENTER_OFFSET_Y };
  const half = mapCenter(v);
  const o = outside(screenCenter, half, l);
  let good = !o.left && !o.right && !o.top && !o.bottom;
  if (!good && axis === 'horizontal') {
    good = (snapped.centerX < current.centerX && !o.left) || (snapped.centerX > current.centerX && !o.right);
  }
  if (!good && axis === 'vertical') {
    good = (snapped.centerY < current.centerY && !o.top) || (snapped.centerY > current.centerY && !o.bottom);
  }
  if (good) return snapped;
  if (!force) return null;
  const c = forcedCenter(screenCenter, half, l, o, v);
  return snapCamera({ centerX: c.x, centerY: c.y });
}

export function setRenderCenter(target: Camera, v: Viewport, l: ScrollLimits): Camera {
  return applyScrolling(target, target, v, l, 'any', true) as Camera;
}

export function scrollBy(current: Camera, screenDx: number, screenDy: number, v: Viewport, l: ScrollLimits): Camera {
  let camera = current;
  if (screenDx !== 0) {
    const d = screenToCell(screenDx, 0);
    camera = applyScrolling({ centerX: camera.centerX + d.x, centerY: camera.centerY + d.y }, camera, v, l, 'horizontal', false) ?? camera;
  }
  if (screenDy !== 0) {
    const d = screenToCell(0, screenDy);
    camera = applyScrolling({ centerX: camera.centerX + d.x, centerY: camera.centerY + d.y }, camera, v, l, 'vertical', false) ?? camera;
  }
  return camera;
}
