// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/DefaultContentManager.cc loadTranslationTable; src/sgp/Font.cc GetGlyphIndex

import { FormatError } from '../binary/errors.ts';

export type GlyphTable = ReadonlyMap<number, number>;

const MAX_GLYPH_INDEX = 0xffff;
const FALLBACK_CHARACTER = '?';

export function parseGlyphTable(json: unknown): Map<number, number> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new FormatError('glyph table is not an object');
  const table = new Map<number, number>();
  for (const [key, value] of Object.entries(json)) {
    const codePoints = [...key];
    if (codePoints.length !== 1) throw new FormatError(`glyph table entry needs a single character, got ${JSON.stringify(key)}`);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_GLYPH_INDEX)
      throw new FormatError(`glyph table entry ${JSON.stringify(key)} has a bad glyph index ${String(value)}`);
    table.set(key.codePointAt(0) as number, value);
  }
  if (!table.has(FALLBACK_CHARACTER.codePointAt(0) as number)) throw new FormatError('glyph table has no glyph for "?"');
  return table;
}

export function glyphIndexOf(table: GlyphTable, codePoint: number): number {
  return table.get(codePoint) ?? (table.get(FALLBACK_CHARACTER.codePointAt(0) as number) as number);
}

export function glyphCount(table: GlyphTable): number {
  return Math.max(-1, ...table.values()) + 1;
}
