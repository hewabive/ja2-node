// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-28. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Faces.cc SetFaceTalking and HandleTalkingAutoFace (a line with valid speech lasts as long as
// @src its sample plays); src/externalized/content/Dialogs.cc GetDialogueVoiceFilename. See docs/04 §6.37.

import { readWavInfo, wavDurationMs } from '../formats/wav.ts';
import { normalizeVfsPath } from '../vfs/path.ts';
import type { VfsFileInfo } from '../vfs/vfs.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { type SpokenLine, speechPathForLine } from './speech.ts';

export const SPEECH_LENGTHS_PATH = '@rules/speech/lengths.json';
export const SPEECH_LENGTHS_VERSION = 1;
export const SPEECH_LENGTHS_LAYER = 'speech';
const SPEECH_HEAD_BYTES = 256;
const SPEECH_FILE = /^(npc_speech|speech)\/[^/]+\.wav$/;
const STUB_PREFIX = 'stubs/';

export interface VoiceLengths {
  ms(line: SpokenLine): number | null;
}

export const NO_VOICE_LENGTHS: VoiceLengths = { ms: () => null };

export function isSpeechFile(path: string): boolean {
  return SPEECH_FILE.test(path);
}

function speechPathOf(path: string): string | null {
  const unprefixed = path.startsWith(STUB_PREFIX) ? path.slice(STUB_PREFIX.length) : path;
  return isSpeechFile(unprefixed) ? unprefixed : null;
}

export function isSpeechLengthsPath(path: string): boolean {
  return path === SPEECH_LENGTHS_PATH;
}

export function speechLengthMs(bytes: Uint8Array, fileSize = bytes.length): number | null {
  try {
    return Math.ceil(wavDurationMs(readWavInfo(bytes, fileSize)));
  } catch {
    return null;
  }
}

export async function measureSpeech(
  files: Iterable<string>,
  length: (path: string) => Promise<number | null>,
): Promise<Map<string, number>> {
  const own: [string, string][] = [];
  const stubbed: [string, string][] = [];
  for (const path of files) {
    const speech = speechPathOf(path);
    if (speech !== null) (speech === path ? own : stubbed).push([speech, path]);
  }
  const lengths = new Map<string, number>();
  for (const [speech, path] of [...own, ...stubbed]) {
    if (lengths.has(speech)) continue;
    const ms = await length(path);
    if (ms !== null) lengths.set(speech, ms);
  }
  return lengths;
}

export interface SpeechSource {
  list(): readonly VfsFileInfo[];
  read(path: string, start?: number, end?: number): Promise<Uint8Array>;
}

async function lengthFromHead(source: SpeechSource, path: string, size: number): Promise<number | null> {
  const head = await source.read(path, 0, Math.min(size, SPEECH_HEAD_BYTES));
  return speechLengthMs(head, size) ?? speechLengthMs(await source.read(path));
}

export function withSpeechLengths(read: ReadFile, source: SpeechSource): ReadFile {
  let derived: Promise<Uint8Array | null> | null = null;
  const derive = async (): Promise<Uint8Array | null> => {
    const sizes = new Map(source.list().map((f) => [f.path, f.size]));
    const lengths = await measureSpeech(sizes.keys(), (path) => lengthFromHead(source, path, sizes.get(path) ?? 0));
    return lengths.size > 0 ? encodeSpeechLengths(lengths) : null;
  };
  return (path) => {
    if (!isSpeechLengthsPath(normalizeVfsPath(path))) return read(path);
    derived ??= derive();
    return derived;
  };
}

function byPath([a]: readonly [string, number], [b]: readonly [string, number]): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function encodeSpeechLengths(lengths: ReadonlyMap<string, number>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(Object.fromEntries([...lengths].sort(byPath))));
}

export function decodeSpeechLengths(bytes: Uint8Array): Map<string, number> {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  return new Map(Object.entries(parsed).filter((e): e is [string, number] => Number.isInteger(e[1])));
}

export class SpeechLengths implements VoiceLengths {
  readonly #lengths: ReadonlyMap<string, number>;
  readonly #rpcSpeechPrefixed: boolean;

  constructor(lengths: ReadonlyMap<string, number>, rpcSpeechPrefixed: boolean) {
    this.#lengths = lengths;
    this.#rpcSpeechPrefixed = rpcSpeechPrefixed;
  }

  static async load(read: ReadFile, rpcSpeechPrefixed: boolean): Promise<SpeechLengths> {
    const bytes = await read(SPEECH_LENGTHS_PATH);
    return new SpeechLengths(bytes ? decodeSpeechLengths(bytes) : new Map(), rpcSpeechPrefixed);
  }

  get size(): number {
    return this.#lengths.size;
  }

  ms(line: SpokenLine): number | null {
    const path = speechPathForLine(line, this.#rpcSpeechPrefixed);
    return path === null ? null : (this.#lengths.get(path) ?? null);
  }
}
