// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/SaveLoadMap.cc AddStructToMapTempFile, RemoveStructFromMapTempFile,
// @src DamageStructsFromMapTempFile, LoadAllMapChangesFromMapTempFileAndApplyThem.

import type { StructureFile } from '../../content/formats/jsd.ts';
import { recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { PROFILE_Z_SIZE, type StructureInstance } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import type { TacticalState } from './state.ts';

export const MapChangeKind = {
  REMOVE: 'removeStructure',
  ADD: 'addStructure',
  DAMAGE: 'damageStructure',
  ADD_EXIT_GRID: 'addExitGrid',
} as const;
export type MapChangeKind = (typeof MapChangeKind)[keyof typeof MapChangeKind];

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
}

const NO_FILE = -1;
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
  return Math.trunc(s.cubeOffset / PROFILE_Z_SIZE);
}

function record(t: TacticalState, kind: MapChangeKind, s: StructureInstance): void {
  t.mapChanges.push({
    kind,
    gridNo: s.gridNo,
    level: levelOf(s),
    fileKey: fileKeyOf(t, s.file),
    number: s.def.number,
    hitPoints: s.hitPoints,
  });
}

export function recordStructureRemoved(t: TacticalState, base: StructureInstance): void {
  record(t, MapChangeKind.REMOVE, base);
}

export function recordStructureAdded(t: TacticalState, base: StructureInstance): void {
  record(t, MapChangeKind.ADD, base);
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
  const known = changeTiles.get(c);
  if (known !== undefined) return known;
  const def = fileForKey(t, c.fileKey)?.structures[c.number];
  const tile = def ? (tileOfStructure(t).get(def) ?? null) : null;
  changeTiles.set(c, tile);
  return tile;
}

function findRecordedBase(t: TacticalState, c: MapChange): StructureInstance | null {
  const file = fileForKey(t, c.fileKey);
  for (const s of t.world.structures.at(c.gridNo)) {
    if (s.baseGridNo !== s.gridNo || s.def.number !== c.number || levelOf(s) !== c.level) continue;
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

export function recordExitGridAdded(t: TacticalState, exit: AddedExitGrid): void {
  t.mapChanges.push({
    kind: MapChangeKind.ADD_EXIT_GRID,
    gridNo: exit.mapIndex,
    level: 0,
    fileKey: NO_FILE,
    number: 0,
    hitPoints: 0,
    exitGrid: exit,
  });
}

function applyMapChange(t: TacticalState, c: MapChange): void {
  if (c.kind === MapChangeKind.ADD_EXIT_GRID) {
    if (c.exitGrid) addExitGridToWorld(t, c.exitGrid);
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

export function applyMapChanges(t: TacticalState, changes: readonly MapChange[]): void {
  for (const c of changes) {
    applyMapChange(t, c);
    t.mapChanges.push(c);
    recompileLocalMovementCosts(t.world.costs, t.world, c.gridNo);
  }
}
