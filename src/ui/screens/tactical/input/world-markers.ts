// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/PathAI.cc PlotPath (two footsteps per tile but the last: entering at sub-index direction + 2,
// @src leaving at the next direction + 2 + 8, the colour bases GREENSTEPSTART 0, PURPLESTEPSTART 32, BLUESTEPSTART 48,
// @src ORANGESTEPSTART 64 and REDSTEPSTART 16 by band, object layer tail or on-roof tail); Interface_Cursors.cc
// @src DrawUICursor (the SHOWTILE and AP-dependent diamonds, FIRSTPOINTERS3 and 14 on roof level, the second-level drop
// @src marker), DrawSnappingCursor (FIRSTPOINTERS1, the confirm figures GOODRUN1/GOODWALK1/GOODSWAT1/GOODPRONE1 and
// @src VEHICLEMOVE1 with the prone -6 and roof -WALL_HEIGHT - 8 offsets, BADMARKER1, the AP number on MOCKFLOOR1 at
// @src SNAPCURSOR_AP_X/Y_STARTVAL), GetSnapCursorIndex (the 3D cursor); Interface_Control.cc SetUpInterface (GOODRING1 and
// @src FIRSTPOINTERS2 under the hovered merc, the show-move-grid marker); Interface.cc SetupPhysicsTrajectoryUI
// @src (FIRSTPOINTERS8 or 12 at the impact tile).

import type { Footstep } from '../../../../protocol/hints.ts';
import type { WorldMarker } from '../environment.ts';
import { UiCursorFlag, type UiCursorTable } from './ui-cursors.ts';

const FOOTPRINTS = 'FOOTPRINTS';
const BAND_BASE: readonly number[] = [0, 32, 48, 64, 16];
const LEAVING = 8;
const DIRECTION_SUB_INDEX = 2;
const LAST_ENTERING_SUB_INDEX = 8;
export const WALL_HEIGHT = 50;
const ROOF_FIGURE_OFFSET = -WALL_HEIGHT - 8;
const PRONE_FIGURE_OFFSET = -6;
export const SNAPCURSOR_AP_X = 18;
export const SNAPCURSOR_AP_Y = 9;
const ROOF_AP_LIFT = WALL_HEIGHT + 10;
const DEFAULT_TILE_FOR_ROOF = 'FIRSTPOINTERS3';
const ROOF_DROP_MARKER = 'FIRSTPOINTERS14';

function footstepTile(subIndex: number, band: number): string {
  return `${FOOTPRINTS}${subIndex + (BAND_BASE[band] ?? BAND_BASE[BAND_BASE.length - 1] ?? 0)}`;
}

function enteringSubIndex(direction: number): number {
  const n = direction + DIRECTION_SUB_INDEX;
  return n > LAST_ENTERING_SUB_INDEX ? 1 : n;
}

export function footstepMarkers(steps: readonly Footstep[], level: number): WorldMarker[] {
  const layer = level === 0 ? 'object' : 'onRoof';
  return steps.flatMap((step) => [
    { gridNo: step.gridNo, layer, tile: footstepTile(enteringSubIndex(step.enterDir), step.band) },
    { gridNo: step.gridNo, layer, tile: footstepTile(enteringSubIndex(step.leaveDir) + LEAVING, step.band) },
  ]);
}

export interface CursorMarkerState {
  readonly uiCursor: string;
  readonly gridNo: number;
  readonly interfaceLevel: number;
  readonly targetGridNo: number | null;
  readonly apInvalidOrZero: boolean;
  readonly stealth: boolean;
  readonly displayAp: boolean;
}

const CONFIRM_FIGURES: Readonly<Record<string, string>> = {
  ALL_MOVE_RUN_UICURSOR: 'GOODRUN1',
  CONFIRM_MOVE_RUN_UICURSOR: 'GOODRUN1',
  ALL_MOVE_WALK_UICURSOR: 'GOODWALK1',
  CONFIRM_MOVE_WALK_UICURSOR: 'GOODWALK1',
  ALL_MOVE_SWAT_UICURSOR: 'GOODSWAT1',
  CONFIRM_MOVE_SWAT_UICURSOR: 'GOODSWAT1',
  ALL_MOVE_PRONE_UICURSOR: 'GOODPRONE1',
  CONFIRM_MOVE_PRONE_UICURSOR: 'GOODPRONE1',
  ALL_MOVE_VEHICLE_UICURSOR: 'VEHICLEMOVE1',
  CONFIRM_MOVE_VEHICLE_UICURSOR: 'VEHICLEMOVE1',
};

function snappingMarkers(s: CursorMarkerState): WorldMarker[] {
  const roof = s.interfaceLevel > 0;
  const figure = CONFIRM_FIGURES[s.uiCursor];
  if (s.uiCursor === 'NORMAL_SNAPUICURSOR') return [{ gridNo: s.gridNo, layer: 'topmost', tile: 'FIRSTPOINTERS1', head: true }];
  if (figure) {
    const prone = figure === 'GOODPRONE1' ? PRONE_FIGURE_OFFSET : 0;
    return [{ gridNo: s.gridNo, layer: 'topmost', tile: figure, offsetY: (roof ? ROOF_FIGURE_OFFSET : 0) + prone }];
  }
  if (s.uiCursor === 'CANNOT_MOVE_UICURSOR') {
    if (!roof) return [{ gridNo: s.gridNo, layer: 'topmost', tile: 'BADMARKER1', head: true }];
    return [
      { gridNo: s.gridNo, layer: 'topmost', tile: 'BADMARKER1', offsetY: ROOF_FIGURE_OFFSET },
      { gridNo: s.gridNo, layer: 'onRoof', tile: ROOF_DROP_MARKER, head: true },
    ];
  }
  return [];
}

export function cursorMarkers(table: UiCursorTable, s: CursorMarkerState): WorldMarker[] {
  const entry = table.entry(s.uiCursor);
  const roof = s.interfaceLevel > 0;
  const out: WorldMarker[] = [];
  if (entry.flags & UiCursorFlag.SHOWTILE && entry.data) {
    out.push({ gridNo: s.gridNo, layer: 'topmost', tile: roof ? DEFAULT_TILE_FOR_ROOF : entry.data });
    if (roof) out.push({ gridNo: s.gridNo, layer: 'onRoof', tile: entry.data, head: true });
  }
  if (entry.flags & UiCursorFlag.FREEFLOWING && !(entry.flags & UiCursorFlag.DONTSHOW2NDLEVEL) && roof)
    out.push({ gridNo: s.targetGridNo ?? s.gridNo, layer: 'topmost', tile: ROOF_DROP_MARKER });
  if (entry.flags & UiCursorFlag.SHOWTILEAPDEPENDENT && entry.data) {
    const tile = s.apInvalidOrZero ? (s.stealth ? 'FIRSTPOINTERS10' : 'FIRSTPOINTERS6') : s.stealth ? 'FIRSTPOINTERS9' : entry.data;
    out.push({ gridNo: s.gridNo, layer: 'topmost', tile: roof ? ROOF_DROP_MARKER : tile });
    if (roof) out.push({ gridNo: s.gridNo, layer: 'onRoof', tile, head: true });
  }
  if (entry.flags & UiCursorFlag.SNAPPING) out.push(...snappingMarkers(s));
  return out;
}

export function apNumberMarker(gridNo: number, interfaceLevel: number): WorldMarker {
  return {
    gridNo,
    layer: 'topmost',
    tile: 'MOCKFLOOR1',
    offsetX: SNAPCURSOR_AP_X,
    offsetY: SNAPCURSOR_AP_Y - (interfaceLevel > 0 ? ROOF_AP_LIFT : 0),
  };
}

export function selectionMarker(gridNo: number, level: number, tile: string): WorldMarker {
  return { gridNo, layer: level === 0 ? 'object' : 'roof', tile, head: true };
}

export function showMoveGridMarker(gridNo: number, interfaceLevel: number, tile: string): WorldMarker {
  return { gridNo, layer: interfaceLevel === 0 ? 'topmost' : 'onRoof', tile, head: true };
}

export function impactMarker(gridNo: number, level: number, good: boolean): WorldMarker {
  return { gridNo, layer: level === 0 ? 'topmost' : 'onRoof', tile: good ? 'FIRSTPOINTERS8' : 'FIRSTPOINTERS12', head: true };
}
