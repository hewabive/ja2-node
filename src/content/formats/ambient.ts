// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Ambient_Types.h AMBIENTDATA_STRUCT; TileEngine/Ambient_Control.cc LoadAmbientControlFile,
// @src SetupNewAmbientSound; src/game/Directories.h AMBIENTDIR.

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';

export const AMBIENT_DIR = 'ambient';
export const MAX_AMBIENT_SOUNDS = 100;
export const AMBIENT_ENTRY_BYTES = 116;
const COUNT_BYTES = 2;
const FILE_NAME_BYTES = 100;
const PADDING_BYTES = 3;

export const AmbientTime = { DAWN: 0, DAY: 1, DUSK: 2, NIGHT: 3 } as const;

export interface AmbientEntry {
  readonly minTimeMs: number;
  readonly maxTimeMs: number;
  readonly timeCategory: number;
  readonly file: string;
  readonly volume: number;
}

export function ambientTablePath(ambientId: number): string {
  return `${AMBIENT_DIR}/${ambientId}.bad`;
}

export function ambientSoundPath(entry: Pick<AmbientEntry, 'file'>): string {
  return `${AMBIENT_DIR}/${entry.file.toLowerCase()}`;
}

export function parseAmbientTable(bytes: Uint8Array): AmbientEntry[] {
  const r = new BinaryReader(bytes);
  const count = r.i16();
  if (count < 0 || count > MAX_AMBIENT_SOUNDS)
    throw new FormatError(`ambient table: ${count} entries (0 to ${MAX_AMBIENT_SOUNDS} allowed)`);
  if (bytes.length < COUNT_BYTES + count * AMBIENT_ENTRY_BYTES)
    throw new FormatError(`ambient table: ${count} entries need ${COUNT_BYTES + count * AMBIENT_ENTRY_BYTES} bytes, have ${bytes.length}`);
  const entries: AmbientEntry[] = [];
  for (let i = 0; i < count; i++) {
    const minTimeMs = r.u32();
    const maxTimeMs = r.u32();
    const timeCategory = r.u8();
    const file = r.fixedString(FILE_NAME_BYTES);
    r.skip(PADDING_BYTES);
    const volume = r.u32();
    entries.push({ minTimeMs, maxTimeMs, timeCategory, file, volume });
  }
  return entries;
}

export function encodeAmbientTable(entries: readonly AmbientEntry[]): Uint8Array {
  if (entries.length > MAX_AMBIENT_SOUNDS) throw new RangeError(`ambient table: at most ${MAX_AMBIENT_SOUNDS} entries`);
  const w = new BinaryWriter(COUNT_BYTES + entries.length * AMBIENT_ENTRY_BYTES);
  w.i16(entries.length);
  for (const e of entries)
    w.u32(e.minTimeMs).u32(e.maxTimeMs).u8(e.timeCategory).fixedString(FILE_NAME_BYTES, e.file).zeros(PADDING_BYTES).u32(e.volume);
  return w.toBytes();
}
