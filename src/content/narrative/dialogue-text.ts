// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/content/Dialogs.cc GetDialogueTextFilename; DefaultContentManager.cc loadDialogQuoteFromFile;
// @src src/game/Tactical/Dialogue_Control.cc FindDelayForString, GetDialogue. See docs/24 §1.5, §11.5.

import { DIALOGUE_SIZE, decodeEdtRow, type EdtEncoding, utf32Length } from '../formats/edt.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { NUM_PROFILES, SharedDialogueFile } from './npc-constants.ts';
import { NPCDATA_DIR, readLayered, threeDigits } from './npc-records.ts';

export const MERCEDT_DIR = 'mercedt';

export interface TextKey {
  readonly file: string;
  readonly row: number;
  readonly width: number;
}

export interface QuoteLengths {
  chars(key: TextKey): number;
}

export function npcDialogueFile(profile: number): string {
  const id = profile >= SharedDialogueFile.FIRST && profile <= SharedDialogueFile.LAST ? SharedDialogueFile.FIRST : profile;
  return `${NPCDATA_DIR}/${threeDigits(id)}.edt`;
}

export function alternateDialogueFile(profile: number): string {
  return `${NPCDATA_DIR}/d_${threeDigits(profile)}.edt`;
}

export function mercDialogueFile(voice: number): string {
  return `${MERCEDT_DIR}/${threeDigits(voice)}.edt`;
}

export function dialogueFileCandidates(): string[] {
  const files: string[] = [];
  for (let id = 0; id < NUM_PROFILES; id++) files.push(npcDialogueFile(id), alternateDialogueFile(id), mercDialogueFile(id));
  return [...new Set(files)];
}

export class DialogueTexts implements QuoteLengths {
  readonly #files: ReadonlyMap<string, Uint8Array>;
  readonly #encoding: EdtEncoding;
  readonly #lengths = new Map<string, number>();

  constructor(files: ReadonlyMap<string, Uint8Array>, encoding: EdtEncoding = 'english') {
    this.#files = files;
    this.#encoding = encoding;
  }

  static async load(read: ReadFile, encoding: EdtEncoding = 'english', paths = dialogueFileCandidates()): Promise<DialogueTexts> {
    const files = new Map<string, Uint8Array>();
    for (const path of paths) {
      const bytes = await readLayered(read, path);
      if (bytes) files.set(path, bytes);
    }
    return new DialogueTexts(files, encoding);
  }

  has(file: string): boolean {
    return this.#files.has(file);
  }

  text(key: TextKey): string | null {
    const bytes = this.#files.get(key.file);
    if (!bytes) return null;
    return decodeEdtRow(bytes, key.row, key.width, this.#encoding);
  }

  chars(key: TextKey): number {
    const memo = `${key.file}#${key.row}#${key.width}`;
    const known = this.#lengths.get(memo);
    if (known !== undefined) return known;
    const text = this.text(key);
    const n = text === null ? 0 : utf32Length(text);
    this.#lengths.set(memo, n);
    return n;
  }
}

export const NO_DIALOGUE_TEXTS: QuoteLengths = { chars: () => 0 };

export function textKey(file: string, row: number, width = DIALOGUE_SIZE): TextKey {
  return { file, row, width };
}
