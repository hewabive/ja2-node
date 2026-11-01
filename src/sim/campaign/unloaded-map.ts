// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/SaveLoadMap.cc AddStructToUnLoadedMapTempFile, RemoveStructFromUnLoadedMapTempFile,
// @src OpenMapModificationTempFile (the sector flag).

import type { Sector } from '../../content/strategic/sector-ids.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { setSectorFlag } from '../strategic/map/sectors.ts';
import type { StrategicState } from '../strategic/state.ts';
import { worldDay } from '../strategic/time/world-clock.ts';
import { MapChangeKind, type StructTileChangeKind, structTileChange } from '../tactical/map-changes.ts';
import { sectorDiffOf } from './sector-loot.ts';

function addStructTileChangeToUnloadedSector(
  state: StrategicState,
  kind: StructTileChangeKind,
  gridNo: number,
  tile: number,
  sector: Sector,
): void {
  const diff = sectorDiffOf(state, sector);
  diff.mapChanges ??= [];
  diff.mapChanges.push(structTileChange(kind, gridNo, tile));
  setSectorFlag(state.map, sector, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS, worldDay(state.clock));
}

export function addStructToUnloadedSector(state: StrategicState, gridNo: number, tile: number, sector: Sector): void {
  addStructTileChangeToUnloadedSector(state, MapChangeKind.APPEND_STRUCT_TILE, gridNo, tile, sector);
}

export function removeStructFromUnloadedSector(state: StrategicState, gridNo: number, tile: number, sector: Sector): void {
  addStructTileChangeToUnloadedSector(state, MapChangeKind.REMOVE_STRUCT_TILE, gridNo, tile, sector);
}
