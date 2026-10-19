// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Font.cc GetGlyphIndex (one translation table for every font, '?' for a missing code point),
// @src GetWidth (width + x offset), GetHeight, GetFontHeight (height + y offset of glyph 0). See docs/28 §3.4.

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

const FALLBACK_CODE_POINT = 0x3f;
const FIRST_GLYPH = 0;

export function fontPath(id: FontId): string {
  return `fonts/${id}.sti`;
}

export function fontIdOfPath(path: string): FontId {
  const name = path.split('/').at(-1) ?? path;
  return name.replace(/\.sti$/i, '').toLowerCase();
}

export function bitmapFontFromSti(id: FontId, sti: Sti, table: GlyphTable): BitmapFont {
  if (sti.kind !== 'indexed') throw new Error(`font ${id} is not an indexed STI`);
  return { id, table, glyphs: sti.subImages.map((s) => ({ width: s.width, height: s.height, offsetX: s.offsetX, offsetY: s.offsetY })) };
}

export function glyphOf(font: BitmapFont, codePoint: number): number | null {
  const index = glyphIndexOf(font.table, codePoint);
  return index < font.glyphs.length ? index : null;
}

export function drawableGlyph(font: BitmapFont, codePoint: number): number {
  return glyphOf(font, codePoint) ?? glyphOf(font, FALLBACK_CODE_POINT) ?? FIRST_GLYPH;
}

export function glyphAdvance(font: BitmapFont, index: number): number {
  const glyph = font.glyphs[index];
  return glyph ? glyph.width + glyph.offsetX : 0;
}

export function fontHeight(font: BitmapFont): number {
  const first = font.glyphs[FIRST_GLYPH];
  return first ? first.height + first.offsetY : 0;
}
