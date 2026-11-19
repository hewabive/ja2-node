// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Music_Control.cc MusicPoll (the victory track plays once, then the nothing mode);
// @src src/externalized/DefaultContentManager.cc getMusicForMode (any track of the mode's list).

import { normalizeVfsPath } from '../vfs/path.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import type { MusicTable } from './music-table.ts';
import { decodeSpeechLengths, encodeSpeechLengths } from './speech-lengths.ts';

export const MUSIC_LENGTHS_PATH = '@rules/music/victory-lengths.json';
export const MUSIC_LENGTHS_VERSION = 1;
export const MUSIC_LENGTHS_LAYER = 'music';
const VICTORY_TRACKS = 'tactical_victory';
const STUB_PREFIX = 'stubs/';

export interface MusicFiles {
  has(path: string): boolean;
}

export function isMusicLengthsPath(path: string): boolean {
  return path === MUSIC_LENGTHS_PATH;
}

function playedFile(track: string, files: MusicFiles, stubFallback: boolean): string | null {
  if (files.has(track)) return track;
  const stubbed = `${STUB_PREFIX}${track}`;
  return stubFallback && files.has(stubbed) ? stubbed : null;
}

export async function measureVictoryTracks(
  table: MusicTable,
  files: MusicFiles,
  stubFallback: boolean,
  length: (path: string) => Promise<number | null>,
): Promise<Map<string, number>> {
  const lengths = new Map<string, number>();
  for (const listed of table.get(VICTORY_TRACKS) ?? []) {
    const track = normalizeVfsPath(listed);
    const file = playedFile(track, files, stubFallback);
    if (file === null || lengths.has(track)) continue;
    const ms = await length(file);
    if (ms !== null) lengths.set(track, ms);
  }
  return lengths;
}

export function encodeMusicLengths(lengths: ReadonlyMap<string, number>): Uint8Array {
  return encodeSpeechLengths(lengths);
}

export async function longestVictoryTrackMs(read: ReadFile): Promise<number | null> {
  const bytes = await read(MUSIC_LENGTHS_PATH);
  const lengths = bytes ? [...decodeSpeechLengths(bytes).values()] : [];
  return lengths.length > 0 ? Math.max(...lengths) : null;
}
