// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Enemy_Soldier_Save.cc NewWayOfSavingEnemyAndCivliansToTempFile (the file),
// @src NewWayOfLoadingEnemySoldiersFromTempFile, NewWayOfLoadingCiviliansFromTempFile (its checks);
// @src Tactical/Soldier_Init_List.cc SaveSoldierInitListLinks; Tactical/LoadSaveSoldierCreate.cc
// @src ExtractSoldierCreateFromFileWithChecksumAndGuess (the layout guessed by the checksum).

import { FormatError } from '../binary/errors.ts';
import { sectorId } from '../strategic/sector-ids.ts';
import { calcSoldierCreateCheckSum, type DetailedPlacement, detailedPlacementBytes, parseDetailedPlacement } from './placement.ts';
import { SaveCursor } from './savegame-cursor.ts';
import type { SectorPosition } from './savegame-header.ts';

const SLOT_LIMIT = 64;

export interface PreservedSoldierLink {
  readonly nodeId: number;
  readonly soldierId: number;
}

export interface PreservedSoldiersFile {
  readonly links: readonly PreservedSoldierLink[];
  readonly timestamp: number;
  readonly records: readonly DetailedPlacement[];
}

function expectSector(what: string, saved: number, sector: number): void {
  if (saved !== sector) throw new FormatError(`preserved soldiers file: sector ${what} ${saved}, expected ${sector}`);
}

function readLinks(c: SaveCursor): PreservedSoldierLink[] {
  return Array.from({ length: c.u8() }, () => ({ nodeId: c.u8(), soldierId: c.u8() }));
}

function extractSoldierCreateWithChecksumAndGuess(c: SaveCursor, index: number): DetailedPlacement {
  const at = c.pos;
  for (const stracLinux of [false, true]) {
    c.pos = at;
    const raw = c.view(detailedPlacementBytes(stracLinux));
    if (c.u16() === calcSoldierCreateCheckSum(raw, stracLinux)) return parseDetailedPlacement(raw, stracLinux);
  }
  throw new FormatError(`preserved soldier ${index}: the checksum holds in neither layout`);
}

export function decodePreservedSoldiersFile(bytes: Uint8Array, sector: SectorPosition, enemies: boolean): PreservedSoldiersFile {
  const c = new SaveCursor(bytes);
  expectSector('y', c.i16(), sector.y);
  const links = readLinks(c);
  expectSector('x', c.i16(), sector.x);
  const slots = c.i32();
  const timestamp = c.u32();
  expectSector('z', c.i8(), sector.z);
  if (slots === 0) return { links, timestamp, records: [] };
  if (slots < 0 || slots >= SLOT_LIMIT) throw new FormatError(`preserved soldiers file: ${slots} slots`);
  const records = Array.from({ length: slots }, (_, i) => extractSoldierCreateWithChecksumAndGuess(c, i));
  const savedSectorId = c.u8();
  if (enemies) expectSector('id', savedSectorId, sectorId(sector));
  return { links, timestamp, records };
}
