// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc LoadMapTempFilesFromSavedGameFile, sectorFlagBits, GetMapTempFileName,
// @src LoadWorldItemsFromTempItemFile; Tactical/World_Items.h WORLDITEM; Tactical/Keys.cc door table and door status files;
// @src TileEngine/SaveLoadMap.cc NUM_REVEALED_BYTES, LoadRevealedStatusArrayFromRevealedTempFile, SetMapRevealedStatus (bit order);
// @src the records read by their count, bytes past them unread (2026-11-08); TileEngine/LoadSaveSmokeEffect.cc
// @src ExtractSmokeEffectFromFile, TileEngine/LoadSaveLightEffect.cc ExtractLightEffectFromFile (2026-11-08)

import { idiv } from '../../core/int.ts';
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
const NUM_REVEALED_BYTES = 3200;
const BITS_PER_BYTE = 8;
const EFFECT_RECORD_BYTES = 16;
const SMOKE_EFFECT_PADDING = 1;
const LIGHT_EFFECT_PADDING = 5;

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

export interface SavedSmokeEffect {
  readonly gridNo: number;
  readonly duration: number;
  readonly radius: number;
  readonly flags: number;
  readonly age: number;
  readonly allocated: boolean;
  readonly type: number;
  readonly item: number;
  readonly ownerId: number;
  readonly lastUpdate: number;
}

export interface SavedLightEffect {
  readonly gridNo: number;
  readonly duration: number;
  readonly radius: number;
  readonly age: number;
  readonly allocated: boolean;
  readonly type: number;
  readonly lastUpdate: number;
}

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

type CountField = (c: SaveCursor) => number;
type RecordReader<T> = (c: SaveCursor, index: number) => T;

const U32_COUNT: CountField = (c) => c.u32();
const U8_COUNT: CountField = (c) => c.u8();

function countedRecords<T>(bytes: Uint8Array, count: CountField, recordBytes: number, what: string, read: RecordReader<T>): T[] {
  if (bytes.length === 0) return [];
  const c = new SaveCursor(bytes);
  const n = count(c);
  if (c.remaining < n * recordBytes) throw new FormatError(`${what}: ${n} records need ${n * recordBytes} bytes, have ${c.remaining}`);
  return Array.from({ length: n }, (_, index) => read(c, index));
}

export function decodeWorldItemsFile(bytes: Uint8Array): SavedWorldItem[] {
  return countedRecords(bytes, U32_COUNT, WORLD_ITEM_BYTES, 'item temp file', (c, index) => {
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
    return { index, exists, gridNo, level, object, flags, renderZHeightAboveLevel, visible, nonExistChance };
  });
}

export function decodeDoorTableFile(bytes: Uint8Array): SavedDoor[] {
  return countedRecords(bytes, U8_COUNT, DOOR_RECORD_BYTES, 'door table temp file', (c) => {
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
  return countedRecords(bytes, U8_COUNT, DOOR_STATUS_RECORD_BYTES, 'door status temp file', (c) => {
    const status = { gridNo: c.i16(), flags: c.u8() };
    c.skip(DOOR_STATUS_PADDING_BYTES);
    return status;
  });
}

export function decodeRottingCorpsesFile(bytes: Uint8Array): SavedCorpse[] {
  return countedRecords(bytes, U32_COUNT, ROTTING_CORPSE_BYTES, 'corpse temp file', (c) => {
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

export function decodeSmokeEffectsFile(bytes: Uint8Array): SavedSmokeEffect[] {
  return countedRecords(bytes, U32_COUNT, EFFECT_RECORD_BYTES, 'smoke effects temp file', (c) => {
    const smoke = {
      gridNo: c.i16(),
      duration: c.u8(),
      radius: c.u8(),
      flags: c.u8(),
      age: c.i8(),
      allocated: c.bool(),
      type: c.i8(),
      item: c.u16(),
      ownerId: c.u8(),
    };
    c.skip(SMOKE_EFFECT_PADDING);
    return { ...smoke, lastUpdate: c.u32() };
  });
}

export function decodeLightEffectsFile(bytes: Uint8Array): SavedLightEffect[] {
  return countedRecords(bytes, U32_COUNT, EFFECT_RECORD_BYTES, 'light effects temp file', (c) => {
    const light = { gridNo: c.i16(), duration: c.u8(), radius: c.u8(), age: c.i8(), allocated: c.bool(), type: c.i8() };
    c.skip(LIGHT_EFFECT_PADDING);
    return { ...light, lastUpdate: c.u32() };
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

export function decodeRevealedStatusFile(bytes: Uint8Array): Uint8Array {
  if (bytes.length < NUM_REVEALED_BYTES)
    throw new FormatError(`revealed status temp file: ${bytes.length} bytes, need ${NUM_REVEALED_BYTES}`);
  return Uint8Array.from(
    { length: NUM_REVEALED_BYTES * BITS_PER_BYTE },
    (_, g) => ((bytes[idiv(g, BITS_PER_BYTE)] ?? 0) >> (g % BITS_PER_BYTE)) & 1,
  );
}
