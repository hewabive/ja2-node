// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc LoadMapTempFilesFromSavedGameFile, sectorFlagBits, GetMapTempFileName,
// @src LoadWorldItemsFromTempItemFile; Tactical/World_Items.h WORLDITEM; Tactical/Keys.cc door table and door status files;
// @src Tactical/Soldier_Init_List.cc NewWayOfLoadingEnemySoldierInitListLinks (link records)

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
export const ROTTING_CORPSE_BYTES = 160;
const CORPSE_POSITION_BYTES = 8;
const PALETTE_NAME_BYTES = 30;
const CORPSE_TAIL_PADDING = 12;
export const MAP_MODIFICATION_BYTES = 8;

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

export interface SavedCorpse {
  readonly type: number;
  readonly bodyType: number;
  readonly gridNo: number;
  readonly heightAdjustment: number;
  readonly palettes: { readonly head: string; readonly pants: string; readonly vest: string; readonly skin: string };
  readonly direction: number;
  readonly timeOfDeath: number;
  readonly flags: number;
  readonly level: number;
  readonly visible: number;
  readonly servicingCrows: number;
  readonly profile: number;
  readonly headTaken: boolean;
  readonly aiWarningValue: number;
}

export const MapModificationType = {
  LAND: 1,
  OBJECT: 2,
  STRUCT: 3,
  SHADOW: 4,
  MERC: 5,
  ROOF: 6,
  ONROOF: 7,
  TOPMOST: 8,
  REMOVE_LAND: 9,
  REMOVE_OBJECT: 10,
  REMOVE_STRUCT: 11,
  REMOVE_SHADOW: 12,
  REMOVE_MERC: 13,
  REMOVE_ROOF: 14,
  REMOVE_ONROOF: 15,
  REMOVE_TOPMOST: 16,
  BLOOD_SMELL: 17,
  DAMAGED_STRUCT: 18,
  EXIT_GRIDS: 19,
  OPENABLE_STRUCT: 20,
  WINDOW_HIT: 21,
} as const;

export interface SavedMapModification {
  readonly gridNo: number;
  readonly imageType: number;
  readonly subImageIndex: number;
  readonly type: number;
  readonly extra: number;
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

export function decodeRottingCorpsesFile(bytes: Uint8Array): SavedCorpse[] {
  if (bytes.length === 0) return [];
  const c = new SaveCursor(bytes);
  const count = c.u32();
  if (c.remaining !== count * ROTTING_CORPSE_BYTES)
    throw new FormatError(`corpse temp file: ${count} corpses need ${count * ROTTING_CORPSE_BYTES} bytes, have ${c.remaining}`);
  return Array.from({ length: count }, () => {
    const type = c.u8();
    const bodyType = c.u8();
    const gridNo = c.i16();
    c.skip(CORPSE_POSITION_BYTES);
    const heightAdjustment = c.i16();
    const palettes = {
      head: c.ascii(PALETTE_NAME_BYTES),
      pants: c.ascii(PALETTE_NAME_BYTES),
      vest: c.ascii(PALETTE_NAME_BYTES),
      skin: c.ascii(PALETTE_NAME_BYTES),
    };
    const direction = c.i8();
    c.skip(1);
    const corpse = {
      type,
      bodyType,
      gridNo,
      heightAdjustment,
      palettes,
      direction,
      timeOfDeath: c.u32(),
      flags: c.u16(),
      level: c.i8(),
      visible: c.i8(),
      servicingCrows: c.i8(),
      profile: c.u8(),
      headTaken: c.bool(),
      aiWarningValue: c.u8(),
    };
    c.skip(CORPSE_TAIL_PADDING);
    return corpse;
  });
}

export function decodeMapModificationsFile(bytes: Uint8Array): SavedMapModification[] {
  if (bytes.length % MAP_MODIFICATION_BYTES !== 0)
    throw new FormatError(`map modification temp file: ${bytes.length} bytes is not a multiple of ${MAP_MODIFICATION_BYTES}`);
  const c = new SaveCursor(bytes);
  return Array.from({ length: bytes.length / MAP_MODIFICATION_BYTES }, () => ({
    gridNo: c.u16(),
    imageType: c.u16(),
    subImageIndex: c.u16(),
    type: c.u8(),
    extra: c.u8(),
  }));
}

export interface PreservedSoldierLink {
  readonly nodeId: number;
  readonly soldierId: number;
}

export function decodePreservedSoldierLinks(bytes: Uint8Array): PreservedSoldierLink[] {
  const c = new SaveCursor(bytes, 0);
  c.skip(2);
  const count = c.u8();
  const links: PreservedSoldierLink[] = [];
  for (let i = 0; i < count; i++) links.push({ nodeId: c.u8(), soldierId: c.u8() });
  return links;
}
