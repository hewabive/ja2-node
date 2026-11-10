// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-10. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc SetUIMouseCursor (the exit grid cursor only over a tile outside rooms or revealed).

import type { Sector } from '../../content/strategic/sector-ids.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import type { KnowledgeView } from '../knowledge/view.ts';
import type { TileRun } from '../tactical/perception/fov.ts';
import { exitGridAt } from '../tactical/sector-exit.ts';
import { onVisibleWorldTile, type TacticalState } from '../tactical/state.ts';

const NO_ROOM = 0;

export interface ShownExitGrid {
  readonly gridNo: number;
  readonly sector: Sector;
}

export function tilesOfRuns(runs: readonly TileRun[] | undefined): Uint8Array {
  const tiles = new Uint8Array(WORLD_MAX);
  for (const [first, count] of runs ?? []) tiles.fill(1, Math.max(0, first), Math.min(WORLD_MAX, first + count));
  return tiles;
}

function exitGridCursorShownAt(t: TacticalState, revealed: Uint8Array, g: number): boolean {
  return (t.world.level.rooms[g] ?? NO_ROOM) === NO_ROOM || revealed[g] === 1;
}

export function shownExitGrids(t: TacticalState, view: KnowledgeView): ShownExitGrid[] {
  const revealed = tilesOfRuns(view.revealedTiles);
  const shown: ShownExitGrid[] = [];
  for (const g of [...t.world.exitGrids].sort((a, b) => a - b)) {
    if (!onVisibleWorldTile(t, g) || !exitGridCursorShownAt(t, revealed, g)) continue;
    const exit = exitGridAt(t, g);
    if (exit) shown.push({ gridNo: g, sector: exit.sector });
  }
  return shown;
}
