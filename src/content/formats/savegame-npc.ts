// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/NPC.cc ConditionalExtractNPCQuoteInfoArrayFromFile, LoadNPCInfoFromSavedGameFile,
// @src LoadBackupNPCInfoFromSavedGameFile; SaveLoadGame.cc NumProfilesInSavedGame, MAX_NUM_SOLDIERS. See docs/14 §4,
// @src docs/24 §12.3.

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { type NpcRecord, type NpcRecordLayout, readNpcRecordArray } from './npc.ts';
import { profilesInSave, type SaveSection } from './savegame.ts';

export const NPC_INFO_SECTION = 'npc info';
export const BACKUP_NPC_INFO_SECTION = 'backup npc info';
export const SAVED_CIV_QUOTE_FILES = 20;
const FIRST_VERSION_WITH_PROFILE_COUNT = 44;
const FIRST_VERSION_WITH_CIV_QUOTES = 56;
const OLD_SOLDIER_COUNT = 156;

export interface SavedNpcRecords {
  readonly arrays: readonly (NpcRecord[] | null)[];
  readonly civilian: readonly (NpcRecord[] | null)[];
  readonly backups: readonly (NpcRecord[] | null)[];
}

function readConditionalArrays(r: BinaryReader, count: number, layout: NpcRecordLayout): (NpcRecord[] | null)[] {
  return Array.from({ length: count }, () => (r.u8() !== 0 ? readNpcRecordArray(r, layout) : null));
}

function sectionBytes(bytes: Uint8Array, sections: readonly SaveSection[], name: string): Uint8Array {
  const s = sections.find((x) => x.name === name);
  if (!s) throw new FormatError(`savegame has no ${name} section`);
  return bytes.subarray(s.offset, s.offset + s.size);
}

export function decodeNpcInfo(bytes: Uint8Array, version: number, layout: NpcRecordLayout = 'standard') {
  const r = new BinaryReader(bytes);
  const count = version >= FIRST_VERSION_WITH_PROFILE_COUNT ? profilesInSave(version) : OLD_SOLDIER_COUNT;
  const arrays = readConditionalArrays(r, count, layout);
  const civilian = version >= FIRST_VERSION_WITH_CIV_QUOTES ? readConditionalArrays(r, SAVED_CIV_QUOTE_FILES, layout) : [];
  if (r.remaining !== 0) throw new FormatError(`npc info section has ${r.remaining} unread bytes`);
  return { arrays, civilian };
}

export function decodeBackupNpcInfo(bytes: Uint8Array, version: number, layout: NpcRecordLayout = 'standard'): (NpcRecord[] | null)[] {
  const r = new BinaryReader(bytes);
  const backups = readConditionalArrays(r, profilesInSave(version), layout);
  if (r.remaining !== 0) throw new FormatError(`backup npc info section has ${r.remaining} unread bytes`);
  return backups;
}

export function readSavedNpcRecords(
  bytes: Uint8Array,
  sections: readonly SaveSection[],
  version: number,
  layout: NpcRecordLayout = 'standard',
): SavedNpcRecords {
  const info = decodeNpcInfo(sectionBytes(bytes, sections, NPC_INFO_SECTION), version, layout);
  const backups = decodeBackupNpcInfo(sectionBytes(bytes, sections, BACKUP_NPC_INFO_SECTION), version, layout);
  return { ...info, backups };
}
