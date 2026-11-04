// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/SaveLoadMap.cc AddStructToMapTempFile, RemoveStructFromMapTempFile,
// @src DamageStructsFromMapTempFile, LoadAllMapChangesFromMapTempFileAndApplyThem (a stored structure comes back at the
// @src tail of its tile, 2026-11-04), AddObjectToMapTempFile,
// @src AddObjectFromMapTempFileToMap; TileEngine/WorldMan.cc AddStructToTail, AddStructToHead, RemoveStruct,
// @src IndexExistsInStructLayer (the replayed tile records, over the structure layer the landed helicopter's pieces are
// @src already appended to), AddObjectToHead, TypeRangeExistsInObjectLayer; Structure.cc InternalSwapStructureForPartner
// @src (a partner swap keeps its node's place, 2026-11-04); the door removal of
// @src LoadAllMapChangesFromMapTempFileAndApplyThem with WorldMan.cc RemoveAllStructsOfTypeRange (2026-11-04).

import type { StructureDef, StructureFile } from '../../content/formats/jsd.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { has, PROFILE_Z_SIZE, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { typeIndex } from '../../content/world/tile-tables.ts';
import { idiv } from '../../core/int.ts';
import { helicopterPieces } from './helicopter-pieces.ts';
import type { TacticalState } from './state.ts';
import type { TileChangeKind } from './world-view.ts';

export const MapChangeKind = {
  REMOVE: 'removeStructure',
  ADD: 'addStructure',
  DAMAGE: 'damageStructure',
  ADD_EXIT_GRID: 'addExitGrid',
  APPEND_STRUCT_TILE: 'appendStructTile',
  REMOVE_STRUCT_TILE: 'removeStructTile',
  ADD_OBJECT: 'addObject',
} as const;
export type MapChangeKind = (typeof MapChangeKind)[keyof typeof MapChangeKind];
export type StructTileChangeKind = typeof MapChangeKind.APPEND_STRUCT_TILE | typeof MapChangeKind.REMOVE_STRUCT_TILE;

export interface AddedExitGrid {
  readonly mapIndex: number;
  readonly gridNo: number;
  readonly sector: { readonly x: number; readonly y: number; readonly z: number };
}

export interface MapChange {
  readonly kind: MapChangeKind;
  readonly gridNo: number;
  readonly level: number;
  readonly fileKey: number;
  readonly number: number;
  readonly hitPoints: number;
  readonly exitGrid?: AddedExitGrid;
  readonly tile?: number;
  readonly liveOnly?: boolean;
  readonly partnerSwap?: boolean;
}

export interface StructLayerEdit {
  readonly kind: TileChangeKind;
  readonly tile: number;
}

const NO_FILE = -1;
const GROUND_LEVEL = 0;
const FIRST_DOOR_TYPE = 'FIRSTDOOR';
const LAST_DOOR_TYPE = 'FOURTHDOOR';
const NO_EDITS: readonly StructLayerEdit[] = [];
const NO_TILES: readonly TileElement[] = [];
const fileKeys = new WeakMap<object, Map<StructureFile, number>>();

function fileKeyTable(t: TacticalState): Map<StructureFile, number> {
  const tiles = t.world.tiles ?? NO_TILES;
  let table = fileKeys.get(tiles);
  if (!table) {
    table = new Map();
    for (const te of tiles) if (te.structureFile && !table.has(te.structureFile)) table.set(te.structureFile, te.type);
    fileKeys.set(tiles, table);
  }
  return table;
}

function fileKeyOf(t: TacticalState, file: StructureFile | null): number {
  return file ? (fileKeyTable(t).get(file) ?? NO_FILE) : NO_FILE;
}

function fileForKey(t: TacticalState, key: number): StructureFile | null {
  for (const [file, k] of fileKeyTable(t)) if (k === key) return file;
  return null;
}

function levelOf(s: StructureInstance): number {
  return idiv(s.cubeOffset, PROFILE_Z_SIZE);
}

function structureRecord(t: TacticalState, kind: MapChangeKind, s: StructureInstance): MapChange {
  return {
    kind,
    gridNo: s.gridNo,
    level: levelOf(s),
    fileKey: fileKeyOf(t, s.file),
    number: s.def.number,
    hitPoints: s.hitPoints,
  };
}

function record(t: TacticalState, kind: MapChangeKind, s: StructureInstance): void {
  t.mapChanges.push(structureRecord(t, kind, s));
}

export function recordStructureRemoved(t: TacticalState, base: StructureInstance): void {
  record(t, MapChangeKind.REMOVE, base);
}

export function recordStructureAdded(t: TacticalState, base: StructureInstance): void {
  record(t, MapChangeKind.ADD, base);
}

export function recordStructureSwappedForPartner(t: TacticalState, removed: StructureInstance, partner: StructureInstance): void {
  record(t, MapChangeKind.REMOVE, removed);
  t.mapChanges.push({ ...structureRecord(t, MapChangeKind.ADD, partner), partnerSwap: true });
}

export function recordStructureDamaged(t: TacticalState, base: StructureInstance): void {
  record(t, MapChangeKind.DAMAGE, base);
}

const tilesByStructure = new WeakMap<object, Map<object, number>>();

function tileOfStructure(t: TacticalState): Map<object, number> {
  const tiles = t.world.tiles ?? NO_TILES;
  let table = tilesByStructure.get(tiles);
  if (!table) {
    table = new Map();
    for (const te of tiles) if (te.structure && !table.has(te.structure)) table.set(te.structure, te.index);
    tilesByStructure.set(tiles, table);
  }
  return table;
}

const changeTiles = new WeakMap<MapChange, number | null>();

export function mapChangeTile(t: TacticalState, c: MapChange): number | null {
  if (c.tile !== undefined) return c.tile;
  const known = changeTiles.get(c);
  if (known !== undefined) return known;
  const def = fileForKey(t, c.fileKey)?.structures[c.number];
  const tile = def ? (tileOfStructure(t).get(def) ?? null) : null;
  changeTiles.set(c, tile);
  return tile;
}

function isDoorTile(t: TacticalState, tile: number): boolean {
  const tables = t.world.tables;
  const type = (t.world.tiles ?? NO_TILES)[tile]?.type;
  if (!tables || type === undefined) return false;
  return type >= typeIndex(tables, FIRST_DOOR_TYPE) && type <= typeIndex(tables, LAST_DOOR_TYPE);
}

function removesAnyDoor(t: TacticalState, c: MapChange): boolean {
  if (c.kind !== MapChangeKind.REMOVE || c.level !== GROUND_LEVEL) return false;
  const tile = mapChangeTile(t, c);
  return tile !== null && isDoorTile(t, tile);
}

function findRecordedBase(t: TacticalState, c: MapChange): StructureInstance | null {
  const file = fileForKey(t, c.fileKey);
  for (const s of t.world.structures.at(c.gridNo)) {
    if (!has(s.flags, StructureFlags.BASE_TILE) || s.def.number !== c.number || levelOf(s) !== c.level) continue;
    if (c.fileKey === NO_FILE || s.file === file) return s;
  }
  return null;
}

export function addExitGridToWorld(t: TacticalState, exit: AddedExitGrid): void {
  t.world.exitGrids.add(exit.mapIndex);
  const at = t.addedExitGrids.findIndex((e) => e.mapIndex === exit.mapIndex);
  if (at >= 0) t.addedExitGrids.splice(at, 1);
  t.addedExitGrids.push(exit);
}

export function exitGridChange(exit: AddedExitGrid): MapChange {
  return {
    kind: MapChangeKind.ADD_EXIT_GRID,
    gridNo: exit.mapIndex,
    level: GROUND_LEVEL,
    fileKey: NO_FILE,
    number: 0,
    hitPoints: 0,
    exitGrid: exit,
  };
}

export function recordExitGridAdded(t: TacticalState, exit: AddedExitGrid): void {
  t.mapChanges.push(exitGridChange(exit));
}

export function structTileChange(kind: StructTileChangeKind, gridNo: number, tile: number, liveOnly = false): MapChange {
  return { kind, gridNo, level: GROUND_LEVEL, fileKey: NO_FILE, number: 0, hitPoints: 0, tile, ...(liveOnly ? { liveOnly } : {}) };
}

export function objectChange(gridNo: number, tile: number): MapChange {
  return { kind: MapChangeKind.ADD_OBJECT, gridNo, level: GROUND_LEVEL, fileKey: NO_FILE, number: 0, hitPoints: 0, tile };
}

export function sectorTempFileChanges(changes: readonly MapChange[]): MapChange[] {
  return changes.filter((c) => c.liveOnly !== true);
}

interface RemovedNode {
  readonly gridNo: number;
  readonly index: number;
}

export class StructLayerReplay {
  readonly #t: TacticalState;
  readonly #layers = new Map<number, number[]>();
  #lastRemoved: RemovedNode | null = null;

  constructor(t: TacticalState) {
    this.#t = t;
  }

  edits(c: MapChange): readonly StructLayerEdit[] {
    if (c.kind === MapChangeKind.ADD_OBJECT) return c.tile === undefined ? NO_EDITS : [{ kind: 'object', tile: c.tile }];
    if (c.kind === MapChangeKind.APPEND_STRUCT_TILE) return this.#appendTile(c);
    if (c.kind === MapChangeKind.REMOVE_STRUCT_TILE) return this.#removeTile(c);
    if (c.kind === MapChangeKind.ADD) return this.#addStructure(c);
    if (c.kind === MapChangeKind.REMOVE) return this.#removeStructure(c);
    return NO_EDITS;
  }

  layerAt(gridNo: number): readonly number[] {
    return [...this.#layer(gridNo)];
  }

  #layer(gridNo: number): number[] {
    let layer = this.#layers.get(gridNo);
    if (!layer) {
      layer = [...levelTilesAt(this.#t.world.level.layers.structs, gridNo), ...landedHelicopterTilesAt(this.#t, gridNo)];
      this.#layers.set(gridNo, layer);
    }
    return layer;
  }

  #appendTile(c: MapChange): readonly StructLayerEdit[] {
    const layer = this.#layer(c.gridNo);
    const tile = c.tile;
    if (tile === undefined || layer.includes(tile)) return NO_EDITS;
    layer.push(tile);
    this.#lastRemoved = null;
    return [{ kind: 'append', tile }];
  }

  #removeTile(c: MapChange): readonly StructLayerEdit[] {
    const tile = c.tile;
    if (tile === undefined) return NO_EDITS;
    if (isDoorTile(this.#t, tile)) return this.#removeAllDoors(c.gridNo);
    if (!this.#takeOut(c.gridNo, tile)) return NO_EDITS;
    return [{ kind: 'remove', tile }];
  }

  #removeStructure(c: MapChange): readonly StructLayerEdit[] {
    const tile = mapChangeTile(this.#t, c);
    if (tile === null) return NO_EDITS;
    if (removesAnyDoor(this.#t, c)) return this.#removeAllDoors(c.gridNo);
    if (c.level === GROUND_LEVEL) this.#takeOut(c.gridNo, tile);
    return [{ kind: 'remove', tile }];
  }

  #removeAllDoors(gridNo: number): readonly StructLayerEdit[] {
    const doors = this.#layer(gridNo).filter((tile) => isDoorTile(this.#t, tile));
    for (const door of doors) this.#takeOut(gridNo, door);
    return doors.map((tile): StructLayerEdit => ({ kind: 'remove', tile }));
  }

  #addStructure(c: MapChange): readonly StructLayerEdit[] {
    const tile = mapChangeTile(this.#t, c);
    if (tile === null) return NO_EDITS;
    const kind: TileChangeKind = c.partnerSwap ? 'swap' : 'add';
    if (c.level === GROUND_LEVEL) this.#layer(c.gridNo).splice(this.#insertionIndex(c.gridNo, kind), 0, tile);
    this.#lastRemoved = null;
    return [{ kind, tile }];
  }

  #insertionIndex(gridNo: number, kind: TileChangeKind): number {
    const removed = this.#lastRemoved;
    return kind === 'swap' && removed?.gridNo === gridNo ? removed.index : 0;
  }

  #takeOut(gridNo: number, tile: number): boolean {
    const layer = this.#layer(gridNo);
    const at = layer.indexOf(tile);
    if (at >= 0) {
      layer.splice(at, 1);
      this.#lastRemoved = { gridNo, index: at };
    }
    return at >= 0;
  }
}

function landedHelicopterTilesAt(t: TacticalState, gridNo: number): number[] {
  const heli = t.landedHelicopter;
  return heli ? helicopterPieces(heli).flatMap((piece) => (piece.gridNo === gridNo ? [piece.tile] : [])) : [];
}

function replayedAt(t: TacticalState, gridNo: number): StructLayerReplay {
  const replay = new StructLayerReplay(t);
  for (const earlier of t.mapChanges) if (earlier.gridNo === gridNo) replay.edits(earlier);
  return replay;
}

function structTileEdits(t: TacticalState, c: MapChange): readonly StructLayerEdit[] {
  return replayedAt(t, c.gridNo).edits(c);
}

export function structLayerAt(t: TacticalState, gridNo: number): readonly number[] {
  return replayedAt(t, gridNo).layerAt(gridNo);
}

export function objectLayerAt(t: TacticalState, gridNo: number): readonly number[] {
  const added = t.mapChanges.flatMap((c) =>
    c.kind === MapChangeKind.ADD_OBJECT && c.gridNo === gridNo && c.tile !== undefined ? [c.tile] : [],
  );
  return [...added.reverse(), ...levelTilesAt(t.world.level.layers.objects, gridNo)];
}

export function addObjectToHead(t: TacticalState, gridNo: number, tile: number): void {
  t.mapChanges.push(objectChange(gridNo, tile));
}

export function levelNodeTile(t: TacticalState, base: StructureInstance): number | null {
  return tileOfStructure(t).get(base.def) ?? null;
}

function groundStructureBase(t: TacticalState, gridNo: number, def: StructureDef): StructureInstance | null {
  return (
    t.world.structures.at(gridNo).find((s) => has(s.flags, StructureFlags.BASE_TILE) && s.def === def && levelOf(s) === GROUND_LEVEL) ??
    null
  );
}

function applyStructTileEdits(t: TacticalState, c: MapChange, edits: readonly StructLayerEdit[]): void {
  for (const edit of edits) {
    const te = (t.world.tiles ?? NO_TILES)[edit.tile];
    if (!te?.structure) continue;
    if (edit.kind === 'append') {
      t.world.structures.add(c.gridNo, GROUND_LEVEL, te.structure, undefined, te.structureFile);
      continue;
    }
    const base = groundStructureBase(t, c.gridNo, te.structure);
    if (base) t.world.structures.remove(base);
  }
}

function applyStructTileChange(t: TacticalState, c: MapChange): void {
  applyStructTileEdits(t, c, structTileEdits(t, c));
}

function changeStructLayer(t: TacticalState, c: MapChange): boolean {
  const edits = structTileEdits(t, c);
  if (edits.length === 0) return false;
  applyStructTileEdits(t, c, edits);
  t.mapChanges.push(c);
  return true;
}

export function removeStructTile(t: TacticalState, gridNo: number, tile: number, liveOnly = false): boolean {
  return changeStructLayer(t, structTileChange(MapChangeKind.REMOVE_STRUCT_TILE, gridNo, tile, liveOnly));
}

export function addStructTileToTail(t: TacticalState, gridNo: number, tile: number): void {
  changeStructLayer(t, structTileChange(MapChangeKind.APPEND_STRUCT_TILE, gridNo, tile));
}

export function addStructTileToHead(t: TacticalState, gridNo: number, tile: number): void {
  const te = (t.world.tiles ?? NO_TILES)[tile];
  if (!te?.structure) {
    addStructTileToTail(t, gridNo, tile);
    return;
  }
  const added = t.world.structures.add(gridNo, GROUND_LEVEL, te.structure, undefined, te.structureFile);
  if (added) recordStructureAdded(t, added);
}

function applyMapChange(t: TacticalState, c: MapChange): void {
  if (c.kind === MapChangeKind.ADD_OBJECT) return;
  if (c.kind === MapChangeKind.ADD_EXIT_GRID) {
    if (c.exitGrid) addExitGridToWorld(t, c.exitGrid);
    return;
  }
  if (c.kind === MapChangeKind.APPEND_STRUCT_TILE || c.kind === MapChangeKind.REMOVE_STRUCT_TILE || removesAnyDoor(t, c)) {
    applyStructTileChange(t, c);
    return;
  }
  if (c.kind === MapChangeKind.ADD) {
    const file = fileForKey(t, c.fileKey);
    const def = file?.structures[c.number];
    if (!def) return;
    const added = t.world.structures.add(c.gridNo, c.level, def, undefined, file);
    if (added) added.hitPoints = c.hitPoints;
    return;
  }
  const base = findRecordedBase(t, c);
  if (!base) return;
  if (c.kind === MapChangeKind.REMOVE) t.world.structures.remove(base);
  else base.hitPoints = c.hitPoints;
}

function readdedAtTail(t: TacticalState, c: MapChange): MapChange {
  if (c.kind !== MapChangeKind.ADD || c.partnerSwap) return c;
  const tile = mapChangeTile(t, c);
  return tile === null ? c : structTileChange(MapChangeKind.APPEND_STRUCT_TILE, c.gridNo, tile);
}

export function applyMapChanges(t: TacticalState, changes: readonly MapChange[]): void {
  for (const stored of changes) {
    const c = readdedAtTail(t, stored);
    applyMapChange(t, c);
    t.mapChanges.push(c);
    recompileLocalMovementCosts(t.world.costs, t.world, c.gridNo);
  }
}
