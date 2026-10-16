// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/strings/EncryptedString.cc LoadEncryptedData; src/externalized/DefaultContentManager.cc
// @src DIALOGUESIZE, loadDialogQuoteFromFile; Tactical/Civ_Quotes.cc CIV_QUOTE_TEXT_SIZE; Tactical/Dialogue_Control.cc
// @src FindDelayForString. See docs/24 §1.5.

export const DIALOGUE_SIZE = 240;
export const CIV_QUOTE_TEXT_SIZE = 160;
const UTF16_BYTES = 2;
const ROT_THRESHOLD = 33;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdbff;

export type EdtEncoding = 'english' | 'russian' | 'polish' | 'other';

const ENGLISH_FIXES: Readonly<Record<number, number>> = { 128: 0x00c7, 130: 0x00e9, 135: 0x00e7 };
const POLISH_FIXES: Readonly<Record<number, number>> = {
  143: 0x0179,
  163: 0x0141,
  165: 0x0104,
  175: 0x017b,
  179: 0x0142,
  182: 179,
  185: 0x0105,
  191: 0x017c,
  198: 0x0106,
  202: 0x0118,
  209: 0x0143,
  230: 0x0107,
  234: 0x0119,
  241: 0x0144,
  338: 0x015a,
  339: 0x015b,
  376: 0x017a,
};
const RUSSIAN_SHIFT = { FIRST: 0xc0, LAST: 0xff, OFFSET: 0x0350 } as const;

function fixCyrillic(c: number): number {
  if (c >= 0x044d && c <= 0x0452) return c - 0x044d + 0x0410;
  if (c === 0x0453) return 0x0401;
  if (c >= 0x0454 && c <= 0x0467) return c - 0x0454 + 0x0416;
  if (c >= 0x0468 && c <= 0x046c) return c - 0x0468 + 0x042b;
  return c;
}

function fixUnit(raw: number, encoding: EdtEncoding): number {
  const c = raw > ROT_THRESHOLD ? raw - 1 : raw;
  if (encoding === 'russian') return c >= RUSSIAN_SHIFT.FIRST && c <= RUSSIAN_SHIFT.LAST ? c + RUSSIAN_SHIFT.OFFSET : c;
  const fixed = (encoding === 'english' ? ENGLISH_FIXES[c] : encoding === 'polish' ? POLISH_FIXES[c] : undefined) ?? c;
  return fixCyrillic(fixed);
}

export function edtRowCount(bytes: Uint8Array, width = DIALOGUE_SIZE): number {
  return Math.floor(bytes.length / (width * UTF16_BYTES));
}

export function decodeEdtRow(bytes: Uint8Array, row: number, width = DIALOGUE_SIZE, encoding: EdtEncoding = 'english'): string | null {
  if (row < 0 || row >= edtRowCount(bytes, width)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = row * width * UTF16_BYTES;
  const units: number[] = [];
  for (let i = 0; i < width - 1; i++) {
    const raw = view.getUint16(start + i * UTF16_BYTES, true);
    if (raw === 0) break;
    units.push(fixUnit(raw, encoding));
  }
  return String.fromCharCode(...units);
}

export function utf32Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= SURROGATE_FIRST && c <= SURROGATE_LAST && i + 1 < text.length) i++;
    n++;
  }
  return n;
}

export function encodeEdtRow(text: string, width = DIALOGUE_SIZE): Uint8Array {
  if (text.length >= width) throw new RangeError(`EDT row longer than ${width - 1} units: ${text}`);
  const out = new Uint8Array(width * UTF16_BYTES);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    view.setUint16(i * UTF16_BYTES, c >= ROT_THRESHOLD ? c + 1 : c, true);
  }
  return out;
}

export function encodeEdtFile(rows: readonly string[], width = DIALOGUE_SIZE): Uint8Array {
  const out = new Uint8Array(rows.length * width * UTF16_BYTES);
  rows.forEach((text, k) => {
    out.set(encodeEdtRow(text, width), k * width * UTF16_BYTES);
  });
  return out;
}
