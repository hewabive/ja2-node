// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Add.cc FindGridNoFromSweetSpotExcludingSweetSpot; TileEngine/GridSquare.cc GridSquare (the
// @src row-major walk over the clipped square).

import { WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../content/world/grid.ts';
import { rangeInCellCoords } from './insertion.ts';
import { NOWHERE, newOKDestination } from './pathfinding.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

const NO_RANGE = 999999;

function gridSquare(center: number, apothem: number): number[] {
  if (center < 0 || center >= WORLD_MAX || apothem < 0) return [];
  const row = Math.trunc(center / WORLD_COLS);
  const column = center % WORLD_COLS;
  const out: number[] = [];
  for (let r = Math.max(0, row - apothem); r <= Math.min(WORLD_ROWS - 1, row + apothem); r++)
    for (let c = Math.max(0, column - apothem); c <= Math.min(WORLD_COLS - 1, column + apothem); c++) out.push(r * WORLD_COLS + c);
  return out;
}

export function findGridNoFromSweetSpotExcludingSweetSpot(t: TacticalState, s: Soldier, sweet: number, radius: number): number {
  let lowest = NOWHERE;
  let lowestRange = NO_RANGE;
  for (const g of gridSquare(sweet, radius)) {
    if (g === sweet || !newOKDestination(t.pathEnv, s, g, true, s.level)) continue;
    const range = rangeInCellCoords(sweet, g);
    if (range < lowestRange) {
      lowest = g;
      lowestRange = range;
    }
  }
  return lowest;
}
