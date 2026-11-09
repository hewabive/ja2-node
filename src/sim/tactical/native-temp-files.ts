// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/SaveLoadMap.cc LoadAllMapChangesFromMapTempFileAndApplyThem (the records written back),
// @src SetOpenableStructStatusFromMapTempFile, AddBloodOrSmellFromMapTempFileToMap, DamageStructsFromMapTempFile,
// @src ModifyWindowStatus; TileEngine/SmokeEffects.cc LoadSmokeEffectsFromMapTempFile (the owner by his saved id);
// @src TileEngine/LightEffects.cc LoadLightEffectsFromMapTempFile; TileEngine/SaveLoadMap.cc
// @src LoadRevealedStatusArrayFromRevealedTempFile; Tactical/Keys.cc LoadDoorStatusArrayFromDoorStatusTempFile (the door
// @src status flags), LoadDoorTableFromDoorTableTempFile; Tactical/Tactical_Save.cc LoadRottingCorpsesFromTempCorpseFile
// @src (the placement flags), all for any sector's files (2026-11-08).

import type { MapDoor } from '../../content/formats/map.ts';
import {
  MapModificationType,
  type SavedCorpse,
  type SavedDoor,
  type SavedDoorStatus,
  type SavedLightEffect,
  type SavedMapModification,
  type SavedSmokeEffect,
} from '../../content/formats/savegame-temp-files.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { type TileTables, tileIndexFromTypeSubIndex } from '../../content/world/tile-tables.ts';
import { u8 } from '../../core/int.ts';
import type { Corpse } from './combat/death.ts';
import type { StoredDoorStatus } from './doors/door-status.ts';
import { setOpenableStructStatus, swapStructureForPartnerAndRecord } from './doors.ts';
import { type LightEffectRecord, loadLightEffects } from './explosions/light.ts';
import { loadSmokeEffects } from './explosions/smoke.ts';
import type { SmokeCloud } from './explosions/state.ts';
import { Insertion } from './insertion.ts';
import {
  type AddedExitGrid,
  applyMapChanges,
  exitGridChange,
  type MapChange,
  MapChangeKind,
  objectChange,
  recordStructureDamaged,
  structTileChange,
} from './map-changes.ts';
import { setMapRevealedStatus } from './perception/fov.ts';
import { restoreBloodAndSmellAt } from './smell.ts';
import { type Soldier, TOTAL_SOLDIERS } from './soldier.ts';
import type { TacticalState } from './state.ts';

const NOBODY = TOTAL_SOLDIERS;
const BYTE_BITS = 8;
const SAVED_LEVEL_BIT = 0x80;
const REVEALED = 1;
const DOOR_OPEN = 0x01;
const DOOR_PERCEIVED_OPEN = 0x02;
const DOOR_PERCEIVED_NOTSET = 0x04;
const DOOR_HAS_TIN_CAN = 0x10;
const RottingCorpseFlags = {
  FIND_SWEETSPOT_FROM_GRIDNO: 0x01,
  USE_NORTH_ENTRY_POINT: 0x02,
  USE_SOUTH_ENTRY_POINT: 0x04,
  USE_EAST_ENTRY_POINT: 0x08,
  USE_WEST_ENTRY_POINT: 0x10,
  USE_CAMO_PALETTE: 0x20,
} as const;
const ENTRY_POINT_FLAGS: readonly (readonly [flag: number, entryPoint: number])[] = [
  [RottingCorpseFlags.USE_NORTH_ENTRY_POINT, Insertion.NORTH],
  [RottingCorpseFlags.USE_SOUTH_ENTRY_POINT, Insertion.SOUTH],
  [RottingCorpseFlags.USE_EAST_ENTRY_POINT, Insertion.EAST],
  [RottingCorpseFlags.USE_WEST_ENTRY_POINT, Insertion.WEST],
];
const ALWAYS_WRITTEN_BACK: ReadonlySet<number> = new Set([
  MapModificationType.OBJECT,
  MapModificationType.STRUCT,
  MapModificationType.REMOVE_STRUCT,
  MapModificationType.EXIT_GRIDS,
]);
const APPLIED_OUTSIDE_MAP_CHANGES: ReadonlySet<number> = new Set([
  MapModificationType.OPENABLE_STRUCT,
  MapModificationType.BLOOD_SMELL,
  MapModificationType.DAMAGED_STRUCT,
  MapModificationType.WINDOW_HIT,
]);

export function loadAllMapChangesFromMapTempFile(t: TacticalState, modifications: readonly SavedMapModification[]): boolean {
  let writtenBack = 0;
  for (const m of modifications) if (applyMapModification(t, m)) writtenBack++;
  return writtenBack > 0;
}

export function applyMapModification(t: TacticalState, m: SavedMapModification): boolean {
  if (m.type === MapModificationType.OPENABLE_STRUCT) setOpenableStructStatus(t, m.gridNo, m.imageType !== 0);
  else if (m.type === MapModificationType.BLOOD_SMELL) restoreBloodAndSmell(t, m.gridNo, m.imageType, m.subImageIndex);
  else if (m.type === MapModificationType.DAMAGED_STRUCT) damageStructsFromMapTempFile(t, m);
  else if (m.type === MapModificationType.WINDOW_HIT) return modifyWindowStatus(t, m.gridNo);
  else {
    const change = t.world.tables ? savedMapChange(t.world.tables, m) : null;
    if (change) applyMapChanges(t, [change]);
  }
  return ALWAYS_WRITTEN_BACK.has(m.type);
}

export function skippedMapModificationCount(tables: TileTables, modifications: readonly SavedMapModification[]): number {
  return modifications.filter((m) => !APPLIED_OUTSIDE_MAP_CHANGES.has(m.type) && savedMapChange(tables, m) === null).length;
}

function onTheMap(gridNo: number): boolean {
  return gridNo >= 0 && gridNo < WORLD_MAX;
}

function damageStructsFromMapTempFile(t: TacticalState, m: SavedMapModification): void {
  const structures = t.world.structures;
  if (!onTheMap(m.gridNo) || !structures.find(m.gridNo, StructureFlags.BASE_TILE)) return;
  const level = m.extra & SAVED_LEVEL_BIT;
  const wallOrientation = m.extra & ~SAVED_LEVEL_BIT;
  const damaged = structures.findBySavedInfo(m.gridNo, u8(m.imageType), wallOrientation, level);
  if (!damaged) return;
  damaged.hitPoints = u8(m.subImageIndex);
  if (has(damaged.flags, StructureFlags.BASE_TILE)) recordStructureDamaged(t, damaged);
}

function modifyWindowStatus(t: TacticalState, gridNo: number): boolean {
  const window = onTheMap(gridNo) ? t.world.structures.find(gridNo, StructureFlags.WALLNWINDOW) : null;
  if (!window) return false;
  swapStructureForPartnerAndRecord(t, window);
  return true;
}

function savedMapChange(tables: TileTables, m: SavedMapModification): MapChange | null {
  if (!onTheMap(m.gridNo)) return null;
  if (m.type === MapModificationType.EXIT_GRIDS) return exitGridChange(savedExitGrid(m));
  const tile = savedStructTile(tables, m);
  if (tile === null) return null;
  if (m.type === MapModificationType.OBJECT) return objectChange(m.gridNo, tile);
  if (m.type === MapModificationType.STRUCT) return structTileChange(MapChangeKind.APPEND_STRUCT_TILE, m.gridNo, tile);
  if (m.type === MapModificationType.REMOVE_STRUCT) return structTileChange(MapChangeKind.REMOVE_STRUCT_TILE, m.gridNo, tile);
  return null;
}

function savedStructTile(tables: TileTables, m: SavedMapModification): number | null {
  const type = tables.types[m.imageType];
  if (!type || m.subImageIndex < 1 || m.subImageIndex > type.count) return null;
  return tileIndexFromTypeSubIndex(tables, m.imageType, m.subImageIndex);
}

function savedExitGrid(m: SavedMapModification): AddedExitGrid {
  return { mapIndex: m.gridNo, gridNo: m.subImageIndex, sector: { x: u8(m.imageType), y: u8(m.imageType >> BYTE_BITS), z: m.extra } };
}

function restoreBloodAndSmell(t: TacticalState, gridNo: number, blood: number, smell: number): void {
  if (onTheMap(gridNo)) restoreBloodAndSmellAt(t, gridNo, blood, smell);
}

export function loadSmokeEffectsFromMapTempFile(t: TacticalState, smoke: readonly SavedSmokeEffect[]): void {
  loadSmokeEffects(
    t,
    smoke.map((s) => (s.allocated ? savedSmokeCloud(s) : null)),
  );
}

function savedSmokeCloud(s: SavedSmokeEffect): SmokeCloud {
  return {
    gridNo: s.gridNo,
    item: s.item,
    type: s.type,
    ownerId: s.ownerId,
    duration: s.duration,
    radius: s.radius,
    age: s.age,
    flags: s.flags,
    lastUpdate: s.lastUpdate,
  };
}

export function soldierOfSavedId(t: TacticalState, id: number): Soldier | null {
  return id === NOBODY ? null : (t.soldiers[id] ?? null);
}

export function loadLightEffectsFromMapTempFile(t: TacticalState, lights: readonly SavedLightEffect[]): void {
  loadLightEffects(
    t,
    lights.map((l): LightEffectRecord | null =>
      l.allocated ? { gridNo: l.gridNo, radius: l.radius, duration: l.duration, age: l.age, lastUpdate: l.lastUpdate } : null,
    ),
  );
}

export function loadRevealedStatusFromRevealedTempFile(t: TacticalState, revealed: Uint8Array): void {
  setMapRevealedStatus(t, (g) => revealed[g] === REVEALED);
}

export function storedDoorStatus(d: SavedDoorStatus): StoredDoorStatus {
  return {
    gridNo: d.gridNo,
    open: (d.flags & DOOR_OPEN) !== 0,
    perceivedOpen: (d.flags & DOOR_PERCEIVED_OPEN) !== 0,
    perceivedNotSet: (d.flags & DOOR_PERCEIVED_NOTSET) !== 0,
    hasTinCan: (d.flags & DOOR_HAS_TIN_CAN) !== 0,
  };
}

export function savedMapDoor(d: SavedDoor): MapDoor {
  return {
    gridNo: d.gridNo,
    locked: d.locked,
    trapLevel: d.trapLevel,
    trapId: d.trapId,
    lockId: d.lockId,
    perceivedLocked: d.perceivedLocked,
    perceivedTrapped: d.perceivedTrapped,
    lockDamage: d.lockDamage,
  };
}

function corpsePlacement(flags: number): Pick<Corpse, 'findSweetSpot' | 'entryPoint'> {
  if (flags & RottingCorpseFlags.FIND_SWEETSPOT_FROM_GRIDNO) return { findSweetSpot: true };
  const entry = ENTRY_POINT_FLAGS.find(([flag]) => flags & flag);
  return entry ? { entryPoint: entry[1] } : {};
}

export function savedCorpse(c: SavedCorpse): Corpse {
  return {
    gridNo: c.gridNo,
    level: c.level,
    heightAdjustment: c.heightAdjustment,
    bodyType: c.bodyType,
    direction: c.direction,
    state: 0,
    profile: c.profile,
    type: c.type,
    timeOfDeath: c.timeOfDeath,
    headTaken: c.headTaken,
    servicingCrows: c.servicingCrows,
    ...corpsePlacement(c.flags),
    palettes: [c.palettes.head, c.palettes.skin, c.palettes.vest, c.palettes.pants],
    ...(c.flags & RottingCorpseFlags.USE_CAMO_PALETTE ? { camo: true } : {}),
  };
}
