// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc GetMapXYWorldY, RenderTiles (z levels, positions), InitRenderParams;
// @src src/game/TileEngine/Isometric_Utils.cc GetMouseWorldCoords. See docs/05-render-pipeline.md §1, §3, §7.

import { WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';

export const Z_SUBLAYERS = 8;
export const LAND_Z_LEVEL = 0;
export const OBJECT_Z_LEVEL = 1;
export const SHADOW_Z_LEVEL = 2;
export const MERC_Z_LEVEL = 3;
export const STRUCT_Z_LEVEL = 4;
export const ROOF_Z_LEVEL = 5;
export const ONROOF_Z_LEVEL = 6;
export const TOPMOST_Z_LEVEL = 32767;
export const WALL_HEIGHT = 50;
export const ROOF_LEVEL_HEIGHT = 50;
export const SHADOW_ROW_OFFSET = 80;
export const Z_STRIP_DELTA = Z_SUBLAYERS * 10;
export const HALF_TILE_X = 20;
export const CLIFF_HEIGHT_STEP = 80;
export const LIGHT_DUSK_CUTOFF = 8;
export const MERC_SCREEN_OFFSET_Y = 10;
export const ROOF_MERC_WORLD_Y_OFFSET = WALL_HEIGHT + 20;
export const NOBURN_Z_BONUS = 2;
export const ROW_COUNT = WORLD_COLS + WORLD_ROWS - 1;
export const SWEEP_MARGIN_X = 120;
export const SWEEP_MARGIN_Y = 200;

const SCREEN_CENTER_Y = 1625;
const RESTRICTED_TOP_Y = [860, 1330] as const;

export interface Camera {
  readonly centerX: number;
  readonly centerY: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export function topYOf(restrictedScrollId: number): number {
  return RESTRICTED_TOP_Y[restrictedScrollId === 1 ? 1 : 0];
}

export function mapCenter(v: Viewport): { readonly x: number; readonly y: number } {
  return { x: Math.floor(v.width / 2), y: Math.floor(v.height / 2) };
}

export function worldOrigin(x: number, y: number): { readonly x: number; readonly y: number } {
  return { x: 20 * (x - y) - 20, y: 10 * (x + y) - 10 };
}

export function cameraOffset(v: Viewport, camera: Camera, renderHeight: number): { readonly x: number; readonly y: number } {
  const c = mapCenter(v);
  return {
    x: c.x - 2 * (camera.centerX - camera.centerY),
    y: c.y - (camera.centerX + camera.centerY) + renderHeight,
  };
}

export function tileOrigin(x: number, y: number, v: Viewport, camera: Camera): { readonly x: number; readonly y: number } {
  const o = worldOrigin(x, y);
  const off = cameraOffset(v, camera, 0);
  return { x: o.x + off.x, y: o.y + off.y };
}

export function screenToGridNo(sx: number, sy: number, v: Viewport, camera: Camera): number | null {
  const c = mapCenter(v);
  const offX = sx - c.x;
  const offY = sy - c.y + 10;
  const cellX = camera.centerX + Math.floor((offX / 2 + offY) / 2);
  const cellY = camera.centerY + Math.floor((offY - offX / 2) / 2);
  if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS * 10 || cellY >= WORLD_ROWS * 10) return null;
  return Math.floor(cellY / 10) * WORLD_COLS + Math.floor(cellX / 10);
}

export function worldY(x: number, y: number, topY: number): number {
  return 10 * (x - 80) + 10 * (y - 80) + SCREEN_CENTER_Y - topY;
}

export function wrap16(z: number): number {
  return z & 0xffff;
}

export function rowOf(g: number): number {
  return (g % WORLD_COLS) + Math.floor(g / WORLD_COLS);
}

export function visibleRows(v: Viewport, camera: Camera, renderHeight: number): { readonly first: number; readonly last: number } {
  const off = cameraOffset(v, camera, renderHeight);
  const first = Math.ceil((-SWEEP_MARGIN_Y - 20 - off.y + 10) / 10);
  const last = Math.floor((v.height + SWEEP_MARGIN_Y - off.y + 10) / 10);
  return { first: Math.max(0, first), last: Math.min(ROW_COUNT - 1, last) };
}

export function heightAdjusted(height: number, ignoresWorldHeight: boolean): number {
  return ignoresWorldHeight ? Math.max(0, (Math.floor(height / CLIFF_HEIGHT_STEP) - 1) * CLIFF_HEIGHT_STEP) : height;
}

export function objectZ(wy: number): number {
  return wrap16(wy * Z_SUBLAYERS + LAND_Z_LEVEL);
}

export function shadowZ(wy: number): number {
  return Math.max((wy - SHADOW_ROW_OFFSET) * Z_SUBLAYERS + SHADOW_Z_LEVEL, 0);
}

export function structZ(wy: number): number {
  return wy * Z_SUBLAYERS + STRUCT_Z_LEVEL;
}

export function itemZ(wy: number): number {
  return wrap16(wy * Z_SUBLAYERS + OBJECT_Z_LEVEL);
}

export function roofZ(wy: number): number {
  return wrap16((wy + WALL_HEIGHT) * Z_SUBLAYERS + ROOF_Z_LEVEL);
}

export function onRoofZ(wy: number): number {
  return wrap16((wy + WALL_HEIGHT) * Z_SUBLAYERS + ONROOF_Z_LEVEL);
}

export function mercZ(wy: number): number {
  return wrap16(wy * Z_SUBLAYERS + MERC_Z_LEVEL);
}

export const CORPSE_WORLD_Y_OFFSET = 20;
export const ROOF_CORPSE_WORLD_Y_OFFSET = 2 * (WALL_HEIGHT + 40);

export function corpseZ(wyOfNorthWest: number): number {
  return wrap16((wyOfNorthWest + CORPSE_WORLD_Y_OFFSET) * Z_SUBLAYERS + LAND_Z_LEVEL);
}

export function roofCorpseZ(wy: number): number {
  return wrap16((wy + ROOF_CORPSE_WORLD_Y_OFFSET) * Z_SUBLAYERS + ONROOF_Z_LEVEL);
}

export function roofMercZ(wy: number): number {
  return wrap16((wy + ROOF_MERC_WORLD_Y_OFFSET) * Z_SUBLAYERS + ONROOF_Z_LEVEL);
}
