import { type GlyphSource, loadGlyphSource } from '../fonts.ts';
import type { IndexedRaster } from '../raster.ts';

export const LABEL_FONT = 'stub-pixel-12.txt';
const BITS_PER_BYTE = 8;
const GLYPH_GAP = 1;
const FALLBACK = '?';

let font: Promise<GlyphSource> | null = null;

export function labelFont(): Promise<GlyphSource> {
  font ??= loadGlyphSource(LABEL_FONT);
  return font;
}

function rowsOf(source: GlyphSource, character: string): readonly number[] {
  return source.glyphs.get(character.codePointAt(0) as number) ?? source.glyphs.get(FALLBACK.codePointAt(0) as number) ?? [];
}

function inkAt(rows: readonly number[], x: number, y: number): boolean {
  return (((rows[y] ?? 0) >> (BITS_PER_BYTE - 1 - x)) & 1) === 1;
}

function glyphWidth(source: GlyphSource, rows: readonly number[]): number {
  let right = -1;
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < source.cellWidth; x++) if (inkAt(rows, x, y)) right = Math.max(right, x);
  return right < 0 ? Math.ceil(source.cellWidth / 2) : right + 1;
}

export function labelWidth(source: GlyphSource, text: string): number {
  return [...text].reduce((w, c) => w + glyphWidth(source, rowsOf(source, c)) + GLYPH_GAP, 0);
}

export function labelHeight(source: GlyphSource): number {
  return source.cellHeight;
}

export function stampLabel(raster: IndexedRaster, source: GlyphSource, text: string, x: number, y: number, color: number): void {
  let pen = x;
  for (const character of text) {
    const rows = rowsOf(source, character);
    for (let gy = 0; gy < rows.length; gy++)
      for (let gx = 0; gx < source.cellWidth; gx++) if (inkAt(rows, gx, gy)) raster.set(pen + gx, y + gy, color);
    pen += glyphWidth(source, rows) + GLYPH_GAP;
  }
}
