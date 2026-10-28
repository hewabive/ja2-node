// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/DefaultContentManager.cc loadMusic, loadMusicModeList (music.json: a list of track paths per mode
// @src key).

import { FormatError } from '../binary/errors.ts';
import { parseJsoncBytes } from '../strategic/jsonc.ts';

export const MUSIC_TABLE_PATH = 'externalized/music.json';

export type MusicTable = ReadonlyMap<string, readonly string[]>;

export function parseMusicTable(json: unknown): MusicTable {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new FormatError('music.json must be an object');
  const table = new Map<string, readonly string[]>();
  for (const [key, list] of Object.entries(json as Record<string, unknown>)) {
    if (!Array.isArray(list) || list.some((p) => typeof p !== 'string')) throw new FormatError(`music.json ${key} must list track paths`);
    table.set(key, list as string[]);
  }
  return table;
}

export async function loadMusicTable(read: (path: string) => Promise<Uint8Array>): Promise<MusicTable> {
  return parseMusicTable(parseJsoncBytes(await read(MUSIC_TABLE_PATH)));
}
