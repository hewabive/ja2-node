// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/SaveLoadMap.cc AddStructToMapTempFile, RemoveStructFromMapTempFile,
// @src DamageStructsFromMapTempFile, LoadAllMapChangesFromMapTempFileAndApplyThem. See docs/16 §5.11.

import type { StructureFile } from '../../content/formats/jsd.ts';
import { recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { PROFILE_Z_SIZE, type StructureInstance } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import type { TacticalState } from './state.ts';

export const MapChangeKind = { REMOVE: 'removeStructure', ADD: 'addStructure', DAMAGE: 'damageStructure' } as const;
export type MapChangeKind = (typeof MapChangeKind)[keyof typeof MapChangeKind];

export interface MapChange {
  readonly kind: MapChangeKind;
  readonly gridNo: number;
  readonly level: number;
  readonly fileKey: number;
  readonly number: number;
  readonly hitPoints: number;
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

function findRecordedBase(t: TacticalState, c: MapChange): StructureInstance | null {
  const file = fileForKey(t, c.fileKey);
  for (const s of t.world.structures.at(c.gridNo)) {
    if (s.baseGridNo !== s.gridNo || s.def.number !== c.number || levelOf(s) !== c.level) continue;
    if (c.fileKey === NO_FILE || s.file === file) return s;
  }
  return null;
}

function applyMapChange(t: TacticalState, c: MapChange): void {
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
