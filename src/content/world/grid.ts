// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.h

export const WORLD_COLS = 160;
export const WORLD_ROWS = 160;
export const WORLD_MAX = WORLD_COLS * WORLD_ROWS;
export const WORLD_TILE_X = 40;
export const WORLD_TILE_Y = 20;
export const CELL_X_SIZE = 10;
export const CELL_Y_SIZE = 10;
export const WORLD_CLIFF_HEIGHT = 80;

export type GridNo = number;

export function gridNo(x: number, y: number): GridNo {
  return y * WORLD_COLS + x;
}

export function gridX(g: GridNo): number {
  return g % WORLD_COLS;
}

export function gridY(g: GridNo): number {
  return Math.floor(g / WORLD_COLS);
}

export function isOnMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WORLD_COLS && y < WORLD_ROWS;
}
