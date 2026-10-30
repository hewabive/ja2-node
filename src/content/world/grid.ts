// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.h; TileEngine/GridSquare.cc GridSquare (the row-major walk over the clipped square);
// @src TileEngine/Isometric_Utils.cc GetRangeInCellCoordsFromGridNoDiff.

import { idiv } from '../../core/int.ts';

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
  return idiv(g, WORLD_COLS);
}

export function isOnMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WORLD_COLS && y < WORLD_ROWS;
}

const VISIBLE_MIN_SUM = 86;
const VISIBLE_MAX_SUM = 235;
const VISIBLE_MAX_SKEW = 78;
const LAST_ROW_START = WORLD_MAX - WORLD_COLS;

export function isVisibleTile(g: GridNo): boolean {
  if (g < 0 || g >= WORLD_MAX) return false;
  const x = g % WORLD_COLS;
  const y = idiv(g, WORLD_COLS);
  return x + y >= VISIBLE_MIN_SUM && x + y <= VISIBLE_MAX_SUM && Math.abs(x - y) <= VISIBLE_MAX_SKEW;
}

export function outOfBounds(g: GridNo, proposed: GridNo): boolean {
  const mod = g % WORLD_COLS;
  if (mod !== 0 && mod !== WORLD_COLS - 1 && g < LAST_ROW_START && g > WORLD_COLS) return false;
  if (proposed < 0) return true;
  const proposedMod = proposed % WORLD_COLS;
  if (mod === 0 && proposedMod === WORLD_COLS - 1) return true;
  if (mod === WORLD_COLS - 1 && proposedMod === 0) return true;
  return g >= LAST_ROW_START && proposed >= WORLD_MAX;
}

export function newGridNo(g: GridNo, increment: number): GridNo {
  const proposed = g + increment;
  return outOfBounds(g, proposed) ? g : proposed;
}

export function pythSpacesAway(a: GridNo, b: GridNo): number {
  const rows = idiv(a, WORLD_COLS) - idiv(b, WORLD_COLS);
  const cols = (a % WORLD_ROWS) - (b % WORLD_ROWS);
  return Math.trunc(Math.sqrt(rows * rows + cols * cols));
}

export function spacesAway(a: GridNo, b: GridNo): number {
  const rows = Math.abs(idiv(a, WORLD_COLS) - idiv(b, WORLD_COLS));
  const cols = Math.abs((a % WORLD_ROWS) - (b % WORLD_ROWS));
  return Math.max(rows, cols);
}

export function cardinalSpacesAway(a: GridNo, b: GridNo): number {
  const rows = Math.abs(idiv(a, WORLD_COLS) - idiv(b, WORLD_COLS));
  const cols = Math.abs((a % WORLD_ROWS) - (b % WORLD_ROWS));
  return rows + cols;
}

export function rangeInCellCoords(a: GridNo, b: GridNo): number {
  const dx = (b % WORLD_COLS) - (a % WORLD_COLS);
  const dy = idiv(b, WORLD_COLS) - idiv(a, WORLD_COLS);
  return Math.trunc(Math.hypot(dx, dy) * CELL_X_SIZE);
}

export function gridSquare(center: GridNo, apothem: number): GridNo[] {
  if (center < 0 || center >= WORLD_MAX || apothem < 0) return [];
  const row = idiv(center, WORLD_COLS);
  const column = center % WORLD_COLS;
  const out: GridNo[] = [];
  for (let r = Math.max(0, row - apothem); r <= Math.min(WORLD_ROWS - 1, row + apothem); r++)
    for (let c = Math.max(0, column - apothem); c <= Math.min(WORLD_COLS - 1, column + apothem); c++) out.push(r * WORLD_COLS + c);
  return out;
}

export const Direction = { NORTH: 0, NORTHEAST: 1, EAST: 2, SOUTHEAST: 3, SOUTH: 4, SOUTHWEST: 5, WEST: 6, NORTHWEST: 7 } as const;
export const DIRECTION_COUNT = 8;
export const DIRECTION_INCREMENT: readonly number[] = [
  -WORLD_COLS,
  1 - WORLD_COLS,
  1,
  WORLD_COLS + 1,
  WORLD_COLS,
  WORLD_COLS - 1,
  -1,
  -WORLD_COLS - 1,
];

export function directionIncrement(direction: number): number {
  return DIRECTION_INCREMENT[direction > 7 ? 1 : direction] ?? 0;
}
