// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc LoadMapTempFilesFromSavedGameFile, sectorFlagBits, GetMapTempFileName,
// @src LoadWorldItemsFromTempItemFile; Tactical/World_Items.h WORLDITEM; Tactical/Keys.cc door table and door status files

import { FormatError } from '../binary/errors.ts';
import { decodeObject, OBJECT_RECORD_BYTES, type ObjectRecord } from './object.ts';
import { SaveCursor } from './savegame-cursor.ts';
import type { SectorPosition } from './savegame-header.ts';

export const WORLD_ITEM_BYTES = 52;
const WORLD_ITEM_OBJECT_OFFSET = 8;
const DOOR_RECORD_BYTES = 14;
const DOOR_STATUS_RECORD_BYTES = 4;
const WORLD_ITEM_TAIL_PADDING = 3;
const DOOR_PADDING_BYTES = 5;
const DOOR_STATUS_PADDING_BYTES = 1;

export const TEMP_FILE_KINDS = [
  { kind: 'items', flag: 0x10000000, prefix: 'i' },
  { kind: 'rottingCorpses', flag: 0x20000000, prefix: 'r' },
  { kind: 'mapModifications', flag: 0x40000000, prefix: 'm' },
  { kind: 'doorTable', flag: 0x80000000, prefix: 'd' },
  { kind: 'revealedStatus', flag: 0x01000000, prefix: 'v' },
  { kind: 'doorStatus', flag: 0x02000000, prefix: 'ds' },
  { kind: 'enemyPreserved', flag: 0x04000000, prefix: 'e' },
  { kind: 'civilianPreserved', flag: 0x08000000, prefix: 'c' },
  { kind: 'smokeEffects', flag: 0x00100000, prefix: 'sm' },
  { kind: 'lightingEffects', flag: 0x00200000, prefix: 'l' },
] as const;

export type TempFileKind = (typeof TEMP_FILE_KINDS)[number]['kind'];

export interface SectorTempFile {
  readonly sector: SectorPosition;
  readonly kind: TempFileKind;
  readonly bytes: Uint8Array;
}

export interface SavedWorldItem {
  readonly index: number;
  readonly exists: boolean;
  readonly gridNo: number;
  readonly level: number;
  readonly object: ObjectRecord;
  readonly flags: number;
  readonly renderZHeightAboveLevel: number;
  readonly visible: number;
  readonly nonExistChance: number;
}

export interface SavedDoor {
  readonly gridNo: number;
  readonly locked: boolean;
  readonly trapLevel: number;
  readonly trapId: number;
  readonly lockId: number;
  readonly perceivedLocked: number;
  readonly perceivedTrapped: number;
  readonly lockDamage: number;
}

export interface SavedDoorStatus {
  readonly gridNo: number;
  readonly flags: number;
}

export function readSectorTempFiles(c: SaveCursor, sector: SectorPosition, flags: number): SectorTempFile[] {
  const files: SectorTempFile[] = [];
  for (const k of TEMP_FILE_KINDS) {
    if ((flags & k.flag) === 0) continue;
    const size = c.u32();
    files.push({ sector, kind: k.kind, bytes: c.view(size).slice() });
  }
  return files;
}

export function decodeWorldItemsFile(bytes: Uint8Array): SavedWorldItem[] {
  if (bytes.length === 0) return [];
  const c = new SaveCursor(bytes);
  const count = c.u32();
  if (c.remaining !== count * WORLD_ITEM_BYTES) {
    throw new FormatError(`item temp file: ${count} items need ${count * WORLD_ITEM_BYTES} bytes, have ${c.remaining}`);
  }
  const items: SavedWorldItem[] = [];
  for (let index = 0; index < count; index++) {
    const at = c.pos;
    const exists = c.bool();
    c.skip(1);
    const gridNo = c.i16();
    const level = c.u8();
    c.skip(3);
    const object = decodeObject(bytes, at + WORLD_ITEM_OBJECT_OFFSET);
    c.skip(OBJECT_RECORD_BYTES);
    const flags = c.u16();
    const renderZHeightAboveLevel = c.i8();
    const visible = c.i8();
    const nonExistChance = c.u8();
    c.skip(WORLD_ITEM_TAIL_PADDING);
    items.push({ index, exists, gridNo, level, object, flags, renderZHeightAboveLevel, visible, nonExistChance });
  }
  return items;
}

function countedRecords<T>(bytes: Uint8Array, recordBytes: number, what: string, read: (c: SaveCursor) => T): T[] {
  if (bytes.length === 0) return [];
  const c = new SaveCursor(bytes);
  const count = c.u8();
  if (c.remaining !== count * recordBytes)
    throw new FormatError(`${what}: ${count} records need ${count * recordBytes} bytes, have ${c.remaining}`);
  return Array.from({ length: count }, () => read(c));
}

export function decodeDoorTableFile(bytes: Uint8Array): SavedDoor[] {
  return countedRecords(bytes, DOOR_RECORD_BYTES, 'door table temp file', (c) => {
    const door = {
      gridNo: c.i16(),
      locked: c.bool(),
      trapLevel: c.u8(),
      trapId: c.u8(),
      lockId: c.u8(),
      perceivedLocked: c.i8(),
      perceivedTrapped: c.i8(),
      lockDamage: c.i8(),
    };
    c.skip(DOOR_PADDING_BYTES);
    return door;
  });
}

export function decodeDoorStatusFile(bytes: Uint8Array): SavedDoorStatus[] {
  return countedRecords(bytes, DOOR_STATUS_RECORD_BYTES, 'door status temp file', (c) => {
    const status = { gridNo: c.i16(), flags: c.u8() };
    c.skip(DOOR_STATUS_PADDING_BYTES);
    return status;
  });
}
