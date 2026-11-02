// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc ExplosiveDamageStructureAtGridNo (debris, decals, wall ends and the
// @src fountain), HandleFencePartnerCheck, ReplaceWall, RemoveOnWall; Tactical/Structure_Wrap.cc
// @src GetWallStructOfSameOrientationAtGridno; TileEngine/WorldMan.cc AddWallToStructLayer (without the insertion before
// @src a roof tile), ReplaceStructIndex, RemoveAllStructsOfTypeRange, TypeRangeExistsInObjectLayer.

import { Orientation } from '../../../content/formats/jsd.ts';
import { DIRECTION_INCREMENT, Direction, newGridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import {
  has,
  ORIENT_LEFT,
  ORIENT_RIGHT,
  StructureFlags,
  type StructureInstance,
  StructureTileFlags,
} from '../../../content/world/structures.ts';
import type { TileElement } from '../../../content/world/tile-database.ts';
import { type TileTables, tileIndexFromTypeSubIndex, tileTypeOf, typeIndex } from '../../../content/world/tile-tables.ts';
import {
  addObjectToHead,
  addStructTileToHead,
  addStructTileToTail,
  levelNodeTile,
  objectLayerAt,
  recordStructureAdded,
  recordStructureRemoved,
  removeStructTile,
  structLayerAt,
} from '../map-changes.ts';
import type { TacticalState } from '../state.ts';

export interface StructureChanges {
  readonly gridNos: Set<number>;
}

export interface Wreck {
  readonly current: StructureInstance;
  readonly base: StructureInstance;
  readonly destructionPartner: number;
  readonly baseTile: number | null;
}

const SECOND_DEBRIS_SET_START = 40;
const DEBRIS_VARIANTS = 3;
const WALL_DECALS = [
  ['FIRSTWALLDECAL', 'FOURTHWALLDECAL'],
  ['FIFTHWALLDECAL', 'EIGTHWALLDECAL'],
] as const;
const DECALS_LEFT_OUT_OF_TEMP_FILE = true;
const FOUNTAIN_SURFACE = 'fount1.sti';
const FOUNTAIN_WATER_SUBINDICES = [1, 2, 3] as const;
const FOUNTAIN_WATER_REMOVALS = 2;
const WallEnd = {
  OUTSIDE_LEFT_WEST: 48,
  OUTSIDE_LEFT_EAST: 49,
  OUTSIDE_RIGHT_SOUTH: 50,
  OUTSIDE_RIGHT_NORTH: 51,
  INSIDE_LEFT_WEST: 52,
  INSIDE_LEFT_EAST: 53,
  INSIDE_RIGHT_SOUTH: 54,
  INSIDE_RIGHT_NORTH: 55,
} as const;

function step(g: number, direction: number): number {
  return newGridNo(g, DIRECTION_INCREMENT[direction] ?? 0);
}

function onMap(g: number): boolean {
  return g >= 0 && g < WORLD_MAX;
}

export function markStructureTiles(changes: StructureChanges, base: StructureInstance): void {
  for (const tile of base.def.tiles) changes.gridNos.add(base.gridNo + tile.posRelToBase);
}

export function addPartnerGraphic(t: TacticalState, base: StructureInstance, partner: number): void {
  const def = base.file?.structures[partner - 1];
  const added = def ? t.world.structures.add(base.gridNo, 0, def, undefined, base.file) : null;
  if (added) recordStructureAdded(t, added);
}

function typeInRange(tables: TileTables, tile: number, first: string, last: string): boolean {
  if (tile >= tables.numberOfTiles) return false;
  const type = tileTypeOf(tables, tile);
  return type >= typeIndex(tables, first) && type <= typeIndex(tables, last);
}

function debrisTile(tables: TileTables, partner: number): number {
  return partner >= SECOND_DEBRIS_SET_START
    ? tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'SECONDEXPLDEBRIS'), partner - SECOND_DEBRIS_SET_START)
    : tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'FIRSTEXPLDEBRIS'), partner);
}

function hasExplosionDebris(t: TacticalState, tables: TileTables, g: number): boolean {
  return objectLayerAt(t, g).some((tile) => typeInRange(tables, tile, 'FIRSTEXPLDEBRIS', 'SECONDEXPLDEBRIS'));
}

function dropDebris(t: TacticalState, tables: TileTables, g: number, tile: number): void {
  if (!onMap(g) || hasExplosionDebris(t, tables, g)) return;
  addObjectToHead(t, g, tile + t.rng.int(DEBRIS_VARIANTS));
}

function leaveDebris(t: TacticalState, tables: TileTables, w: Wreck): void {
  const tile = debrisTile(tables, w.destructionPartner);
  const g = w.base.gridNo;
  for (const part of w.base.def.tiles) {
    if (part.flags & StructureTileFlags.ON_ROOF) continue;
    dropDebris(t, tables, g + part.posRelToBase, tile);
  }
  if (!has(w.current.flags, StructureFlags.WALLSTUFF)) return;
  dropDebris(t, tables, step(g, w.current.wallOrientation & ORIENT_LEFT ? Direction.SOUTH : Direction.EAST), tile);
}

function handleFencePartnerCheck(t: TacticalState, g: number, changes: StructureChanges): void {
  const fence = t.world.structures.find(g, StructureFlags.FENCE);
  if (!fence || fence.def.destructionPartner >= 0) return;
  const base = t.world.structures.findBase(fence);
  if (!base) return;
  recordStructureRemoved(t, base);
  t.world.structures.remove(base);
  addPartnerGraphic(t, base, -base.def.destructionPartner);
  markStructureTiles(changes, base);
}

function damageFencePartners(t: TacticalState, w: Wreck, changes: StructureChanges): void {
  const g = w.base.gridNo;
  if (w.current.wallOrientation & ORIENT_RIGHT) {
    handleFencePartnerCheck(t, step(g, Direction.SOUTH), changes);
    handleFencePartnerCheck(t, step(g, Direction.NORTH), changes);
    return;
  }
  handleFencePartnerCheck(t, step(g, Direction.EAST), changes);
  handleFencePartnerCheck(t, step(g, Direction.WEST), changes);
}

function removeAllStructsOfTypeRange(t: TacticalState, tables: TileTables, g: number, first: string, last: string): void {
  for (const tile of structLayerAt(t, g)) {
    if (typeInRange(tables, tile, first, last)) removeStructTile(t, g, tile, DECALS_LEFT_OUT_OF_TEMP_FILE);
  }
}

function removeWallDecals(t: TacticalState, tables: TileTables, g: number): void {
  for (const [first, last] of WALL_DECALS) removeAllStructsOfTypeRange(t, tables, g, first, last);
}

function crossesWall(orientation: number, other: number): boolean {
  return (
    ((orientation & ORIENT_RIGHT) !== 0 && (other & ORIENT_LEFT) !== 0) ||
    ((orientation & ORIENT_LEFT) !== 0 && (other & ORIENT_RIGHT) !== 0)
  );
}

function sameWallSide(orientation: number, other: number): boolean {
  return (
    ((orientation & ORIENT_RIGHT) !== 0 && (other & ORIENT_RIGHT) !== 0) ||
    ((orientation & ORIENT_LEFT) !== 0 && (other & ORIENT_LEFT) !== 0)
  );
}

function wallOrientationOf(tiles: readonly TileElement[], tile: number): number {
  return tiles[tile]?.wallOrientation ?? Orientation.NONE;
}

function addWallToStructLayer(t: TacticalState, tiles: readonly TileElement[], g: number, tile: number, replace: boolean): void {
  const orientation = wallOrientationOf(tiles, tile);
  let insertFound = false;
  for (const node of structLayerAt(t, g)) {
    const other = wallOrientationOf(tiles, node);
    if (other > orientation && crossesWall(orientation, other)) insertFound = true;
    if (!sameWallSide(orientation, other)) continue;
    if (replace) replaceStructIndex(t, tiles, g, node, tile);
    return;
  }
  if (insertFound) addStructTileToHead(t, g, tile);
  else addStructTileToTail(t, g, tile);
}

function replaceStructIndex(t: TacticalState, tiles: readonly TileElement[], g: number, old: number, tile: number): void {
  removeStructTile(t, g, old);
  addWallToStructLayer(t, tiles, g, tile, false);
}

function wallOfSameOrientationAt(t: TacticalState, g: number, side: number): StructureInstance | null {
  for (const s of t.world.structures.at(g)) {
    if (!has(s.flags, StructureFlags.WALLSTUFF) || !(s.wallOrientation & side)) continue;
    const base = t.world.structures.findBase(s);
    if (base) return base;
  }
  return null;
}

function wallEndTile(tables: TileTables, node: number, subIndex: number): number | null {
  let type = tileTypeOf(tables, node);
  if (type > typeIndex(tables, 'FOURTHWALL')) type -= typeIndex(tables, 'FIRSTDECORATIONS') - typeIndex(tables, 'FIRSTWALL');
  return tables.types[type] ? tileIndexFromTypeSubIndex(tables, type, subIndex) : null;
}

function replaceWall(t: TacticalState, g: number, orientation: number, subIndex: number, changes: StructureChanges): void {
  const { tables, tiles } = t.world;
  if (!tables || !tiles) return;
  const wall = wallOfSameOrientationAt(t, g, orientation & ORIENT_LEFT ? ORIENT_LEFT : ORIENT_RIGHT);
  if (!wall || !has(wall.flags, StructureFlags.WALL)) return;
  const node = levelNodeTile(t, wall);
  const tile = node === null ? null : wallEndTile(tables, node, subIndex);
  if (tile === null || tile >= tiles.length) return;
  recordStructureRemoved(t, wall);
  t.world.structures.remove(wall);
  addWallToStructLayer(t, tiles, g, tile, true);
  changes.gridNos.add(g);
}

function removeOnWall(t: TacticalState, g: number, flag: number, changes: StructureChanges): void {
  for (let attached = t.world.structures.find(g, flag); attached; attached = t.world.structures.find(g, flag)) {
    const base = t.world.structures.findBase(attached);
    if (!base) return;
    recordStructureRemoved(t, base);
    t.world.structures.remove(base);
    markStructureTiles(changes, base);
  }
}

function breakWall(t: TacticalState, w: Wreck, changes: StructureChanges): void {
  const g = w.base.gridNo;
  const orientation = w.current.wallOrientation;
  if (orientation & ORIENT_LEFT) {
    const outside = orientation === Orientation.OUTSIDE_LEFT;
    replaceWall(t, step(g, Direction.WEST), orientation, outside ? WallEnd.OUTSIDE_LEFT_WEST : WallEnd.INSIDE_LEFT_WEST, changes);
    replaceWall(t, step(g, Direction.EAST), orientation, outside ? WallEnd.OUTSIDE_LEFT_EAST : WallEnd.INSIDE_LEFT_EAST, changes);
    removeOnWall(t, g, StructureFlags.ON_LEFT_WALL, changes);
    removeOnWall(t, step(g, Direction.SOUTH), StructureFlags.ON_LEFT_WALL, changes);
    return;
  }
  const outside = orientation === Orientation.OUTSIDE_RIGHT;
  replaceWall(t, step(g, Direction.NORTH), orientation, outside ? WallEnd.OUTSIDE_RIGHT_NORTH : WallEnd.INSIDE_RIGHT_NORTH, changes);
  replaceWall(t, step(g, Direction.SOUTH), orientation, outside ? WallEnd.OUTSIDE_RIGHT_SOUTH : WallEnd.INSIDE_RIGHT_SOUTH, changes);
  removeOnWall(t, g, StructureFlags.ON_RIGHT_WALL, changes);
  removeOnWall(t, step(g, Direction.EAST), StructureFlags.ON_RIGHT_WALL, changes);
}

function ownTilesetSurfaceName(t: TacticalState, te: TileElement): string {
  const path = te.surfacePath.toLowerCase();
  const dir = `tilesets/${t.world.level.tilesetId}/`;
  const at = path.lastIndexOf(dir);
  return at < 0 ? '' : path.slice(at + dir.length);
}

function drainFountain(t: TacticalState, tables: TileTables, tiles: readonly TileElement[], w: Wreck): void {
  const te = w.baseTile === null ? undefined : tiles[w.baseTile];
  if (!te || ownTilesetSurfaceName(t, te) !== FOUNTAIN_SURFACE) return;
  for (const subIndex of FOUNTAIN_WATER_SUBINDICES) {
    const water = tileIndexFromTypeSubIndex(tables, te.type, subIndex);
    for (let k = 0; k < FOUNTAIN_WATER_REMOVALS; k++) removeStructTile(t, w.base.gridNo, water);
  }
}

export function wreckSurroundings(t: TacticalState, w: Wreck, changes: StructureChanges): void {
  const { tables, tiles } = t.world;
  if (w.destructionPartner > 0) {
    if (tables) leaveDebris(t, tables, w);
  } else if (has(w.current.flags, StructureFlags.FENCE)) damageFencePartners(t, w, changes);
  if (tables && has(w.current.flags, StructureFlags.WALLSTUFF | StructureFlags.WIREFENCE)) removeWallDecals(t, tables, w.base.gridNo);
  if (has(w.current.flags, StructureFlags.WALLSTUFF)) breakWall(t, w, changes);
  if (tables && tiles) drainFountain(t, tables, tiles, w);
}
