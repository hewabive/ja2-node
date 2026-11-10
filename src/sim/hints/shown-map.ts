// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-10. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc SetUIMouseCursor (the exit grid cursor only over a tile outside rooms or revealed);
// @src TileEngine/Render_Fun.cc SetGridNoRevealedFlag, RemoveRoomRoof (the roofs a room reveal or a load takes off),
// @src ExamineGridNoForSlantRoofExtraGraphic (a slanted roof's ceiling over the tiles no merc has seen).

import type { Sector } from '../../content/strategic/sector-ids.ts';
import { exitGridCursorShownOver, NO_ROOM } from '../../content/world/exit-grid-cursor.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import type { KnowledgeView } from '../knowledge/view.ts';
import type { TileRun } from '../tactical/perception/fov.ts';
import { exitGridAt } from '../tactical/sector-exit.ts';
import { onVisibleWorldTile, type TacticalState } from '../tactical/state.ts';
import { flatRoofAboveGridNo } from '../tactical/world-items.ts';

export interface ShownExitGrid {
  readonly gridNo: number;
  readonly sector: Sector;
}

export function tilesOfRuns(runs: readonly TileRun[] | undefined): Uint8Array {
  const tiles = new Uint8Array(WORLD_MAX);
  for (const [first, count] of runs ?? []) tiles.fill(1, Math.max(0, first), Math.min(WORLD_MAX, first + count));
  return tiles;
}

export function shownExitGrids(t: TacticalState, view: KnowledgeView): ShownExitGrid[] {
  const revealed = tilesOfRuns(view.revealedTiles);
  const shown: ShownExitGrid[] = [];
  for (const g of [...t.world.exitGrids].sort((a, b) => a - b)) {
    if (!onVisibleWorldTile(t, g) || !exitGridCursorShownOver(t.world.level.rooms[g] ?? NO_ROOM, revealed[g] === 1)) continue;
    const exit = exitGridAt(t, g);
    if (exit) shown.push({ gridNo: g, sector: exit.sector });
  }
  return shown;
}

function roofsTakenOff(t: TacticalState, view: KnowledgeView): Uint8Array {
  const off = tilesOfRuns(view.revealedAtLoad);
  const rooms = new Set(view.revealedRooms ?? []);
  if (rooms.size === 0) return off;
  for (let g = 0; g < WORLD_MAX; g++) if (rooms.has(t.world.level.rooms[g] ?? NO_ROOM)) off[g] = 1;
  return off;
}

function underSlantedRoof(t: TacticalState, g: number): boolean {
  return t.world.structures.at(g).some((s) => has(s.flags, StructureFlags.SLANTED_ROOF));
}

export function groundUnderDrawnRoofs(t: TacticalState, view: KnowledgeView): Uint8Array {
  const off = roofsTakenOff(t, view);
  const revealed = tilesOfRuns(view.revealedTiles);
  const covered = new Uint8Array(WORLD_MAX);
  for (let g = 0; g < WORLD_MAX; g++) {
    const flat = flatRoofAboveGridNo(t, g) && off[g] !== 1;
    const slanted = revealed[g] !== 1 && underSlantedRoof(t, g);
    if (flat || slanted) covered[g] = 1;
  }
  return covered;
}
