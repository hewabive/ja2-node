// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc ParseSavedGameHeader, isValidSavedGameHeader, ExtractSavedGameHeaderFromFile,
// @src CalcJA2EncryptionSet, ExtractGameOptions; src/game/Tactical/Tactical_Save.cc NewJA2EncryptedFileRead

import { u8, u32 } from '../../core/int.ts';
import { FormatError } from '../binary/errors.ts';
import { SaveCursor } from './savegame-cursor.ts';

export const SAVE_HEADER_BYTES = 432;
export const SAVE_HEADER_BYTES_STRAC_LINUX = 688;
export const SAVE_ENCRYPTION_PATH = 'tables/save-encryption.json';
const GAME_VERSION_CHARS = 16;
const DESCRIPTION_CHARS = 128;
const GAME_OPTIONS_PADDING = 7;
const FIRST_VERSION_WITH_STATE_SIZE = 102;
const MAX_SECTOR = 16;
const MAX_Z = 3;
const ROTATION_ARRAY_BYTES = 49;
const OPTION_SETS = 12;
const GUN_NUT_SET_OFFSET = 6;
const SCI_FI_SET_OFFSET = 3;
const GERMAN_SET_FACTOR = 11;
const DIFFICULTY_MEDIUM = 2;
const DIFFICULTY_HARD = 3;

export interface SavedGameOptions {
  readonly gunNut: boolean;
  readonly sciFi: boolean;
  readonly difficulty: number;
  readonly turnTimeLimit: boolean;
  readonly saveMode: number;
}

export interface SectorPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SaveGameHeader {
  readonly version: number;
  readonly gameVersion: string;
  readonly description: string;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly sector: SectorPosition;
  readonly mercsOnPlayerTeam: number;
  readonly currentBalance: number;
  readonly currentScreen: number;
  readonly alternateSector: boolean;
  readonly worldLoaded: boolean;
  readonly loadScreenId: number;
  readonly initialGameOptions: SavedGameOptions;
  readonly random: number;
  readonly saveStateSize: number;
}

export interface SaveEncryptionTable {
  readonly baseSets: number;
  readonly sets: readonly Uint8Array[];
}

function readSavedGameOptions(c: SaveCursor): SavedGameOptions {
  const options = { gunNut: c.bool(), sciFi: c.bool(), difficulty: c.u8(), turnTimeLimit: c.bool(), saveMode: c.u8() };
  c.skip(GAME_OPTIONS_PADDING);
  return options;
}

function readHeader(bytes: Uint8Array, utf32: boolean): SaveGameHeader {
  const c = new SaveCursor(bytes);
  const version = c.u32();
  const gameVersion = c.ascii(GAME_VERSION_CHARS);
  const description = c.wideString(DESCRIPTION_CHARS, utf32);
  c.skip(4);
  const day = c.u32();
  const hour = c.u8();
  const minute = c.u8();
  const sector = { x: c.i16(), y: c.i16(), z: c.i8() };
  const mercsOnPlayerTeam = c.u8();
  const currentBalance = c.i32();
  const currentScreen = c.u32();
  const alternateSector = c.bool();
  const worldLoaded = c.bool();
  const loadScreenId = c.u8();
  const initialGameOptions = readSavedGameOptions(c);
  c.skip(1);
  const random = c.u32();
  const saveStateSize = version >= FIRST_VERSION_WITH_STATE_SIZE ? c.u32() : 0;
  return {
    version,
    gameVersion,
    description,
    day,
    hour,
    minute,
    sector,
    mercsOnPlayerTeam,
    currentBalance,
    currentScreen,
    alternateSector,
    worldLoaded,
    loadScreenId,
    initialGameOptions,
    random,
    saveStateSize,
  };
}

export function isValidSectorPosition(s: SectorPosition): boolean {
  return s.x >= 1 && s.x <= MAX_SECTOR && s.y >= 1 && s.y <= MAX_SECTOR && s.z >= 0 && s.z <= MAX_Z;
}

export function isValidSaveHeader(h: SaveGameHeader): boolean {
  if (h.sector.x === 0 && h.sector.y === 0 && h.sector.z === -1) return h.day !== 0 && h.currentBalance >= 0;
  return h.day !== 0 && isValidSectorPosition(h.sector) && h.currentBalance >= 0;
}

export function parseSaveHeader(bytes: Uint8Array): { readonly header: SaveGameHeader; readonly stracLinuxFormat: boolean } {
  if (bytes.length >= SAVE_HEADER_BYTES_STRAC_LINUX) {
    const linux = readHeader(bytes.subarray(0, SAVE_HEADER_BYTES_STRAC_LINUX), true);
    if (isValidSaveHeader(linux)) return { header: linux, stracLinuxFormat: true };
  }
  if (bytes.length < SAVE_HEADER_BYTES) throw new FormatError(`savegame too short for a header: ${bytes.length} bytes`);
  return { header: readHeader(bytes.subarray(0, SAVE_HEADER_BYTES), false), stracLinuxFormat: false };
}

export function encryptionSetIndex(h: SaveGameHeader, baseSets: number, germanVersion: boolean): number {
  let set = u32(h.currentBalance);
  set = u32(Math.imul(set, h.mercsOnPlayerTeam + 1));
  set = u32(set + h.sector.z * 3);
  set = u32(set + h.loadScreenId);
  if (h.alternateSector) set = u32(set + 7);
  const r = h.random;
  if (r % 2 === 0) {
    set = u32(set + 1);
    if (r % 7 === 0) {
      set = u32(set + 1);
      if (r % 23 === 0) set = u32(set + 1);
      if (r % 79 === 0) set = u32(set + 2);
    }
  }
  if (germanVersion) set = u32(Math.imul(set, GERMAN_SET_FACTOR));
  set %= 10;
  set += Math.trunc(h.day / 10);
  set %= baseSets;
  const o = h.initialGameOptions;
  if (o.gunNut) set += baseSets * GUN_NUT_SET_OFFSET;
  if (o.sciFi) set += baseSets * SCI_FI_SET_OFFSET;
  if (o.difficulty === DIFFICULTY_MEDIUM) set += baseSets;
  if (o.difficulty === DIFFICULTY_HARD) set += baseSets * 2;
  return set;
}

export function parseSaveEncryptionTable(json: unknown): SaveEncryptionTable {
  const t = json as { baseSets?: unknown; sets?: unknown };
  if (typeof t?.baseSets !== 'number' || !Array.isArray(t.sets) || t.sets.length !== t.baseSets * OPTION_SETS) {
    throw new FormatError('malformed save encryption table');
  }
  const sets = t.sets.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== ROTATION_ARRAY_BYTES) throw new FormatError('malformed save encryption row');
    return Uint8Array.from(row as number[]);
  });
  return { baseSets: t.baseSets, sets };
}

export function decryptSaveRecord(encrypted: Uint8Array, key: Uint8Array): Uint8Array {
  const plain = new Uint8Array(encrypted.length);
  let previous = 0;
  for (let i = 0; i < encrypted.length; i++) {
    const byte = encrypted[i] ?? 0;
    plain[i] = u8(byte - previous - (key[i % key.length] ?? 0));
    previous = byte;
  }
  return plain;
}

export function encryptSaveRecord(plain: Uint8Array, key: Uint8Array): Uint8Array {
  const encrypted = new Uint8Array(plain.length);
  let previous = 0;
  for (let i = 0; i < plain.length; i++) {
    previous = u8((plain[i] ?? 0) + previous + (key[i % key.length] ?? 0));
    encrypted[i] = previous;
  }
  return encrypted;
}
