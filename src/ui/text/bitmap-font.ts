// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Font.cc GetGlyphIndex (one translation table for every font), GetWidth (width + x offset). See docs/28 §3.4.

import type { Sti } from '../../content/formats/sti.ts';
import { type GlyphTable, glyphIndexOf } from '../../content/text/glyph-table.ts';
import type { FontId } from '../draw-list.ts';

export interface GlyphMetrics {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface BitmapFont {
  readonly id: FontId;
  readonly glyphs: readonly GlyphMetrics[];
  readonly table: GlyphTable;
}

export function fontPath(id: FontId): string {
  return `fonts/${id}.sti`;
}

export function bitmapFontFromSti(id: FontId, sti: Sti, table: GlyphTable): BitmapFont {
  if (sti.kind !== 'indexed') throw new Error(`font ${id} is not an indexed STI`);
  return { id, table, glyphs: sti.subImages.map((s) => ({ width: s.width, height: s.height, offsetX: s.offsetX, offsetY: s.offsetY })) };
}

export function glyphOf(font: BitmapFont, codePoint: number): number | null {
  const index = glyphIndexOf(font.table, codePoint);
  return index < font.glyphs.length ? index : null;
}

export function glyphAdvance(font: BitmapFont, index: number): number {
  const glyph = font.glyphs[index];
  return glyph ? glyph.width + glyph.offsetX : 0;
}
