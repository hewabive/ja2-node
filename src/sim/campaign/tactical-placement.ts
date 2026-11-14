// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Tactical_Placement_GUI.cc InitTacticalPlacementGUI (who is placed, the edge-index codes
// @src turned into sides, the saved default button), PlaceMercs, ChooseRandomEdgepoints, SpreadPlacementsCallback,
// @src GroupPlacementsCallback, ClearPlacementsCallback, HandleTacticalPlacementClicksInOverheadMap (gfValidCursor of
// @src TacticalPlacementHandle: a merc whose side is no map edge has no valid spot), EnsureDoneButtonStatus,
// @src KillTacticalPlacementGUI, PutDownMercPiece (vanilla's release build keeps sInsertionGridNo for a code with no
// @src entry point, V:TileEngine/TacticalPlacementGUI.c:952-970), PickUpMercPiece;
// @src Tactical/Soldier_Control.cc EVENT_SetSoldierPositionNoCenter (the cell corner).

import { CELL_X_SIZE, CELL_Y_SIZE, isVisibleTile, WORLD_COLS } from '../../content/world/grid.ts';
import { idiv } from '../../core/int.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { PlacementButton, type PlacementPiece } from '../strategic/forces/battle-state.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { setSoldierDirection } from '../tactical/animation.ts';
import type { RandomStream } from '../tactical/combat/context.ts';
import {
  beginMapEdgepointSearch,
  chooseMapEdgepoint,
  endMapEdgepointSearch,
  searchForClosestPrimaryMapEdgepoint,
} from '../tactical/edgepoints.ts';
import { CENTER_GRIDNO, directionFromTo } from '../tactical/insertion.ts';
import { removeSoldierFromGridNo, setSoldierPositionXY } from '../tactical/movement.ts';
import { NOWHERE } from '../tactical/soldier.ts';
import { sectorMapOf, type TacticalState } from '../tactical/state.ts';
import { findGridNoFromSweetSpot } from '../tactical/sweet-spots.ts';
import type { RosterMerc } from './roster.ts';

const PIECE_SWEET_SPOT_RADIUS = 4;
const MAP_EDGE_SIDES: ReadonlySet<number> = new Set([InsertionCode.NORTH, InsertionCode.EAST, InsertionCode.SOUTH, InsertionCode.WEST]);

export const PlacementChoice = { PLACE: 'place', SPREAD: 'spread', GROUP: 'group', CLEAR: 'clear', DONE: 'done' } as const;
export const PLACEMENT_CHOICES: readonly string[] = Object.values(PlacementChoice);

export type PlaceOutcome = 'placed' | 'invalidLocation' | 'inaccessible';

export interface PlacementTable {
  readonly t: TacticalState;
  readonly pieces: readonly PlacementPiece[];
  readonly rolls: RandomStream;
  readonly underground: boolean;
  merc(soldier: number): RosterMerc | null;
}

export interface PlacementSector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function sameSector(a: PlacementSector, b: PlacementSector): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function placedByThePlayer(m: RosterMerc, battleGroupSector: PlacementSector): boolean {
  return (
    m.life !== 0 &&
    !m.betweenSectors &&
    sameSector(m.sector, battleGroupSector) &&
    !m.isVehicle &&
    m.assignment !== Assignment.ASSIGNMENT_POW &&
    m.assignment !== Assignment.IN_TRANSIT &&
    m.sector.z === 0
  );
}

function isEdgeIndex(code: number): boolean {
  return code === InsertionCode.PRIMARY_EDGEINDEX || code === InsertionCode.SECONDARY_EDGEINDEX;
}

export function placementPieces(mercs: readonly RosterMerc[]): PlacementPiece[] {
  return mercs.map((m) => {
    if (isEdgeIndex(m.insertionCode)) m.insertionCode = m.soldier.insertionData;
    return { soldier: m.id, side: m.insertionCode, placed: false };
  });
}

function pieceInsertionGridNo(t: TacticalState, m: RosterMerc): number {
  const info = sectorMapOf(t).info;
  switch (m.insertionCode) {
    case InsertionCode.NORTH:
      return info.northGridNo;
    case InsertionCode.SOUTH:
      return info.southGridNo;
    case InsertionCode.EAST:
      return info.eastGridNo;
    case InsertionCode.WEST:
      return info.westGridNo;
    case InsertionCode.GRIDNO:
      return m.soldier.insertionData;
    default:
      return m.soldier.insertionGridNo;
  }
}

function cellCorner(g: number): { readonly x: number; readonly y: number } {
  return { x: (g % WORLD_COLS) * CELL_X_SIZE, y: idiv(g, WORLD_COLS) * CELL_Y_SIZE };
}

function pickUpMercPiece(table: PlacementTable, piece: PlacementPiece): void {
  piece.placed = false;
  const m = table.merc(piece.soldier);
  if (!m) return;
  removeSoldierFromGridNo(table.t, m.soldier);
  m.soldier.placed = false;
}

function putDownMercPiece(table: PlacementTable, piece: PlacementPiece): void {
  const t = table.t;
  const m = table.merc(piece.soldier);
  if (!m) return;
  const s = m.soldier;
  const insertion = pieceInsertionGridNo(t, m);
  s.insertionGridNo = insertion;
  if (piece.placed) pickUpMercPiece(table, piece);
  const g = isVisibleTile(insertion) ? findGridNoFromSweetSpot(t, s, insertion, PIECE_SWEET_SPOT_RADIUS) : NOWHERE;
  if (g === NOWHERE) return;
  t.soldiers[s.id] = s;
  const corner = cellCorner(g);
  setSoldierPositionXY(t, s, corner.x, corner.y);
  setSoldierDirection(t, s, directionFromTo(g, CENTER_GRIDNO));
  m.insertionDirection = s.direction;
  piece.placed = true;
}

export function pickUpEveryPiece(table: PlacementTable): void {
  for (const piece of table.pieces) pickUpMercPiece(table, piece);
}

function chooseRandomEdgepoints(table: PlacementTable): void {
  for (const piece of table.pieces) {
    const m = table.merc(piece.soldier);
    if (m && !m.isVehicle) {
      const g = chooseMapEdgepoint(table.t, piece.side, table.rolls);
      m.soldier.insertionData = g;
      m.insertionCode = g !== NOWHERE ? InsertionCode.GRIDNO : piece.side;
    }
    putDownMercPiece(table, piece);
  }
}

export function placeMercs(table: PlacementTable, button: number): void {
  if (button === PlacementButton.SPREAD) chooseRandomEdgepoints(table);
  else if (button === PlacementButton.CLEAR) pickUpEveryPiece(table);
}

export function everyonePlaced(pieces: readonly PlacementPiece[]): boolean {
  return pieces.every((p) => p.placed);
}

export function onAMapEdge(piece: PlacementPiece): boolean {
  return MAP_EDGE_SIDES.has(piece.side);
}

function closestEdgepoint(table: PlacementTable, gridNo: number, piece: PlacementPiece): number {
  return searchForClosestPrimaryMapEdgepoint(table.t, gridNo, piece.side, table.underground);
}

function placeGroup(table: PlacementTable, gridNo: number, groupId: number): boolean {
  const members = table.pieces.flatMap((piece) => {
    const m = table.merc(piece.soldier);
    return m && m.groupId === groupId ? [{ piece, m }] : [];
  });
  for (const { piece, m } of members) {
    m.soldier.insertionData = closestEdgepoint(table, gridNo, piece);
    if (m.soldier.insertionData === NOWHERE) return false;
  }
  for (const piece of table.pieces) {
    const m = table.merc(piece.soldier);
    if (!m) continue;
    m.insertionCode = InsertionCode.GRIDNO;
    if (m.groupId === groupId) putDownMercPiece(table, piece);
  }
  return true;
}

function placeOne(table: PlacementTable, gridNo: number, piece: PlacementPiece, m: RosterMerc): boolean {
  m.soldier.insertionData = closestEdgepoint(table, gridNo, piece);
  if (m.soldier.insertionData === NOWHERE) return false;
  m.insertionCode = InsertionCode.GRIDNO;
  putDownMercPiece(table, piece);
  return true;
}

export function placeMercAt(table: PlacementTable, button: number, piece: PlacementPiece, gridNo: number): PlaceOutcome {
  const m = table.merc(piece.soldier);
  if (!m || !onAMapEdge(piece)) return 'invalidLocation';
  beginMapEdgepointSearch(table.t);
  const placed = button === PlacementButton.GROUP ? placeGroup(table, gridNo, m.groupId) : placeOne(table, gridNo, piece, m);
  endMapEdgepointSearch(table.t);
  return placed ? 'placed' : 'inaccessible';
}
