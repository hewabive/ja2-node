import { type GlyphTable, glyphCount, glyphIndexOf } from '../../content/text/glyph-table.ts';
import type { FontId } from '../draw-list.ts';

interface MissingCapital {
  readonly letter: string;
  readonly standIn: string;
}

const LACKS_CHE: MissingCapital = { letter: 'Ч', standIn: '4' };
const LACKS_PE: MissingCapital = { letter: 'П', standIn: '?' };

const FONTS_MISSING_A_CAPITAL: ReadonlyMap<FontId, MissingCapital> = new Map([
  ['blockfont', LACKS_CHE],
  ['blockfont2', LACKS_CHE],
  ['blockfontnarrow', LACKS_CHE],
  ['font14humanist', LACKS_PE],
]);

const CYRILLIC_CAPITALS = 'ЁАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const NO_GLYPH = -1;

function codePointOf(character: string): number {
  return character.codePointAt(0) as number;
}

function lastCapitalGlyph(table: GlyphTable): number {
  return Math.max(NO_GLYPH, ...Array.from(CYRILLIC_CAPITALS, (c) => table.get(codePointOf(c)) ?? NO_GLYPH));
}

function lacksOneGlyphOfTable(fontGlyphCount: number, table: GlyphTable): boolean {
  return fontGlyphCount === glyphCount(table) - 1;
}

export function fontGlyphTable(font: FontId, fontGlyphCount: number, table: GlyphTable): GlyphTable {
  const missing = FONTS_MISSING_A_CAPITAL.get(font);
  if (!missing || !lacksOneGlyphOfTable(fontGlyphCount, table)) return table;
  const gap = table.get(codePointOf(missing.letter));
  if (gap === undefined) return table;
  const lastCapital = lastCapitalGlyph(table);
  const standIn = glyphIndexOf(table, codePointOf(missing.standIn));
  const fontGlyph = (index: number): number => {
    if (index === gap) return standIn;
    if (index > gap && index <= lastCapital) return index - 1;
    return index;
  };
  return new Map(Array.from(table, ([codePoint, index]) => [codePoint, fontGlyph(index)]));
}
