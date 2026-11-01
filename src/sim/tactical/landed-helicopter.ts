// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Helicopter.cc AddHeliPiece, AddHelicopterToMaps; TileEngine/WorldMan.cc
// @src AddStructToTail, RemoveStruct (the helicopter's pieces).

import type { StructureDef } from '../../content/formats/jsd.ts';
import { WORLD_COLS } from '../../content/world/grid.ts';
import { has, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { idiv } from '../../core/int.ts';
import { bumpAnyExistingMerc } from './narrative/schedules.ts';
import type { TacticalState } from './state.ts';
import type { TileChangeView } from './world-view.ts';

export interface LandedHelicopter {
  readonly gridNo: number;
  readonly firstTile: number;
}

export interface HelicopterLandingSite {
  readonly gridNo: number;
  readonly heliTileType: number;
}

interface HelicopterPiece {
  readonly gridNo: number;
  readonly tile: number;
}

const GROUND_LEVEL = 0;
const NORTH_PIECE_OFFSET = -800;
const PIECE_OFFSETS: readonly number[] = [0, 0, NORTH_PIECE_OFFSET, 0, 0, NORTH_PIECE_OFFSET];
const BUMP_HALF_SIDE = 5;
const NO_TILES: readonly TileElement[] = [];

function helicopterPieces(heli: LandedHelicopter): HelicopterPiece[] {
  return PIECE_OFFSETS.map((offset, k) => ({ gridNo: heli.gridNo + offset, tile: heli.firstTile + k }));
}

function tileElement(t: TacticalState, tile: number): TileElement | null {
  return (t.world.tiles ?? NO_TILES)[tile] ?? null;
}

function structureBase(t: TacticalState, gridNo: number, def: StructureDef): StructureInstance | null {
  return t.world.structures.at(gridNo).find((s) => has(s.flags, StructureFlags.BASE_TILE) && s.def === def) ?? null;
}

function pieceOnMap(t: TacticalState, piece: HelicopterPiece): boolean {
  const def = tileElement(t, piece.tile)?.structure;
  return def ? structureBase(t, piece.gridNo, def) !== null : t.landedHelicopter !== null;
}

function addPiece(t: TacticalState, piece: HelicopterPiece): void {
  const te = tileElement(t, piece.tile);
  if (te?.structure) t.world.structures.add(piece.gridNo, GROUND_LEVEL, te.structure, undefined, te.structureFile);
}

function removePiece(t: TacticalState, piece: HelicopterPiece): void {
  const def = tileElement(t, piece.tile)?.structure;
  const base = def ? structureBase(t, piece.gridNo, def) : null;
  if (base) t.world.structures.remove(base);
}

function firstTileOfType(t: TacticalState, type: number): number | null {
  const first = (t.world.tiles ?? NO_TILES).findIndex((te) => te.type === type);
  return first < 0 ? null : first;
}

function bumpAnyMercsAround(t: TacticalState, gridNo: number): void {
  const centreX = gridNo % WORLD_COLS;
  const centreY = idiv(gridNo, WORLD_COLS);
  for (let y = centreY - BUMP_HALF_SIDE; y < centreY + BUMP_HALF_SIDE; y++) {
    for (let x = centreX - BUMP_HALF_SIDE; x < centreX + BUMP_HALF_SIDE; x++) bumpAnyExistingMerc(t, y * WORLD_COLS + x);
  }
}

function addHelicopter(t: TacticalState, heli: LandedHelicopter): void {
  for (const piece of helicopterPieces(heli)) addPiece(t, piece);
  t.landedHelicopter = heli;
  bumpAnyMercsAround(t, heli.gridNo);
}

function removeHelicopter(t: TacticalState, heli: LandedHelicopter): void {
  for (const piece of helicopterPieces(heli)) removePiece(t, piece);
  t.landedHelicopter = null;
}

export function setHelicopterOnMap(t: TacticalState, site: HelicopterLandingSite, landed: boolean): void {
  const firstTile = firstTileOfType(t, site.heliTileType);
  if (firstTile === null) return;
  const heli = { gridNo: site.gridNo, firstTile };
  if (landed) addHelicopter(t, heli);
  else removeHelicopter(t, heli);
}

export function landedHelicopterTileChanges(t: TacticalState): TileChangeView[] {
  const heli = t.landedHelicopter;
  if (!heli) return [];
  return helicopterPieces(heli)
    .filter((piece) => pieceOnMap(t, piece))
    .map((piece) => ({ kind: 'append', gridNo: piece.gridNo, level: GROUND_LEVEL, tile: piece.tile }));
}
