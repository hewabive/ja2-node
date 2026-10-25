// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/content/Dialogs.cc GetDialogueTextFilename; DefaultContentManager.cc loadDialogQuoteFromFile;
// @src src/game/Tactical/Dialogue_Control.cc FindDelayForString, GetDialogue; Civ_Quotes.cc GetCivQuoteText. See docs/24 §1.5,
// @src §8.4, §11.5.

import { CIV_QUOTE_TEXT_SIZE, DIALOGUE_SIZE, decodeEdtRow, type EdtEncoding, edtRowCount, utf32Length } from '../formats/edt.ts';
import { sectorShortString } from '../strategic/sector-ids.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { CIV_QUOTE_SECTORS, CivQuote, NUM_CIV_QUOTES, NUM_PROFILES, SharedDialogueFile } from './npc-constants.ts';
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

export function civQuoteFile(quote: number): string {
  return `${NPCDATA_DIR}/civ${String(quote).padStart(2, '0')}.edt`;
}

export function civHintFile(sector: { readonly x: number; readonly y: number; readonly z: number }): string {
  if (sector.z > 0) return civQuoteFile(CivQuote.MINERS_NOT_FOR_PLAYER);
  return `${NPCDATA_DIR}/${sectorShortString(sector)}.edt`;
}

export function civQuoteTextKey(
  quote: number,
  entry: number,
  sector: { readonly x: number; readonly y: number; readonly z: number },
): TextKey {
  const file = quote === CivQuote.HINT ? civHintFile(sector) : civQuoteFile(quote);
  return { file, row: entry, width: CIV_QUOTE_TEXT_SIZE };
}

export function dialogueFileCandidates(): string[] {
  const files: string[] = [];
  for (let id = 0; id < NUM_PROFILES; id++) files.push(npcDialogueFile(id), alternateDialogueFile(id), mercDialogueFile(id));
  for (let quote = 0; quote < NUM_CIV_QUOTES; quote++) files.push(civQuoteFile(quote));
  for (const [x, y] of CIV_QUOTE_SECTORS) files.push(civHintFile({ x, y, z: 0 }));
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
    const loaded = await Promise.all(paths.map(async (path) => [path, await readLayered(read, path)] as const));
    const files = new Map<string, Uint8Array>();
    for (const [path, bytes] of loaded) if (bytes) files.set(path, bytes);
    return new DialogueTexts(files, encoding);
  }

  has(file: string): boolean {
    return this.#files.has(file);
  }

  rows(file: string, width: number): number {
    const bytes = this.#files.get(file);
    return bytes ? edtRowCount(bytes, width) : 0;
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
