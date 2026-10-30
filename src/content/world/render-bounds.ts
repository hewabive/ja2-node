// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-28. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc InitRenderParams; src/game/TileEngine/RenderWorld.h gCenterWorldX/Y, gsCX, gsCY;
// @src src/game/TileEngine/Isometric_Utils.cc GetAbsoluteScreenXYFromMapPos, GetMapPosFromAbsoluteScreenXY,
// @src GridNoOnVisibleWorldTile.

import { idiv } from '../../core/int.ts';
import { CELL_X_SIZE, CELL_Y_SIZE, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from './grid.ts';

export const RestrictedScroll = { NONE: 0, BASEMENT: 1 } as const;

export interface RenderBounds {
  readonly leftX: number;
  readonly topY: number;
  readonly rightX: number;
  readonly bottomY: number;
}

export interface MapWithRestriction {
  readonly map?: { readonly info?: { readonly restrictedScrollId: number } };
}

export interface ScreenXY {
  readonly x: number;
  readonly y: number;
}

export interface WorldXY {
  readonly x: number;
  readonly y: number;
}

const ROOF_LEVEL_HEIGHT = 50;
const CENTER_WORLD_X = 800;
const CENTER_WORLD_Y = 800;
const MAP_CENTER_SCREEN_X = 0;
const MAP_CENTER_SCREEN_Y = 1625;
const VISIBLE_MARGIN = 20;
const LIMIT_MIDDLE_Y = (CELL_X_SIZE * WORLD_ROWS) / 2;

function boundsBetween(topLeftX: number, topLeftY: number, bottomRightX: number, bottomRightY: number): RenderBounds {
  return {
    leftX: (topLeftX - topLeftY) * 2,
    topY: topLeftX + topLeftY + ROOF_LEVEL_HEIGHT,
    rightX: (bottomRightX - bottomRightY) * 2,
    bottomY: bottomRightX + bottomRightY,
  };
}

const FULL_MAP_BOUNDS = boundsBetween(CELL_X_SIZE, LIMIT_MIDDLE_Y, CELL_Y_SIZE * WORLD_COLS, LIMIT_MIDDLE_Y);
const BASEMENT_BOUNDS = boundsBetween(
  (CELL_X_SIZE * WORLD_ROWS * 3) / 10,
  LIMIT_MIDDLE_Y,
  (CELL_X_SIZE * WORLD_ROWS * 7) / 10,
  LIMIT_MIDDLE_Y,
);

export function restrictedScrollIdOf(w: MapWithRestriction): number {
  return w.map?.info?.restrictedScrollId ?? RestrictedScroll.NONE;
}

export function renderBounds(restrictedScrollId: number): RenderBounds {
  return restrictedScrollId === RestrictedScroll.BASEMENT ? BASEMENT_BOUNDS : FULL_MAP_BOUNDS;
}

export function renderedScreenSize(restrictedScrollId: number): { readonly width: number; readonly height: number } {
  const b = renderBounds(restrictedScrollId);
  return { width: b.rightX - b.leftX, height: b.bottomY - b.topY };
}

function screenXOf(b: RenderBounds, g: number): number {
  const dx = (g % WORLD_COLS) * CELL_X_SIZE - CENTER_WORLD_X;
  const dy = idiv(g, WORLD_COLS) * CELL_Y_SIZE - CENTER_WORLD_Y;
  return 2 * dx - 2 * dy + MAP_CENTER_SCREEN_X - b.leftX;
}

function screenYOf(b: RenderBounds, g: number): number {
  const dx = (g % WORLD_COLS) * CELL_X_SIZE - CENTER_WORLD_X;
  const dy = idiv(g, WORLD_COLS) * CELL_Y_SIZE - CENTER_WORLD_Y;
  return dx + dy + MAP_CENTER_SCREEN_Y - b.topY;
}

export function absoluteScreenXY(restrictedScrollId: number, g: number): ScreenXY {
  const b = renderBounds(restrictedScrollId);
  return { x: screenXOf(b, g), y: screenYOf(b, g) };
}

export function worldXYFromAbsoluteScreenXY(restrictedScrollId: number, x: number, y: number): WorldXY {
  const b = renderBounds(restrictedScrollId);
  const dx = x - MAP_CENTER_SCREEN_X + b.leftX;
  const dy = y - MAP_CENTER_SCREEN_Y + b.topY;
  return { x: idiv(dx + 2 * dy, 4) + CENTER_WORLD_X, y: idiv(2 * dy - dx, 4) + CENTER_WORLD_Y };
}

export function mapPosFromAbsoluteScreenXY(restrictedScrollId: number, x: number, y: number): number {
  const world = worldXYFromAbsoluteScreenXY(restrictedScrollId, x, y);
  return idiv(world.y, CELL_X_SIZE) * WORLD_COLS + idiv(world.x, CELL_Y_SIZE);
}

export function gridNoOnVisibleWorldTile(restrictedScrollId: number, g: number): boolean {
  if (g < 0 || g >= WORLD_MAX) return false;
  const b = renderBounds(restrictedScrollId);
  const x = screenXOf(b, g);
  const y = screenYOf(b, g);
  return x > 0 && x < b.rightX - b.leftX - VISIBLE_MARGIN && y > VISIBLE_MARGIN && y < b.bottomY - b.topY - VISIBLE_MARGIN;
}
