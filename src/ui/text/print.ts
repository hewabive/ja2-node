// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Font.cc MPrint, MPrintChar, MPrintBuffer (each glyph at the pen, the pen advanced by width + x offset;
// @src the colours are the font's foreground, shadow and background).

import { DEFAULT_SHADOW, FontColor } from '../../content/text/font-colors.ts';
import type { Area, DrawList, FontColors, PositionedGlyph } from '../draw-list.ts';
import { type BitmapFont, drawableGlyph, glyphAdvance } from './bitmap-font.ts';

export function fontColors(foreground: number, shadow: number = DEFAULT_SHADOW, background: number = FontColor.MCOLOR_BLACK): FontColors {
  return { foreground, shadow, background };
}

export function glyphRun(font: BitmapFont, text: string, x: number, y: number): { glyphs: PositionedGlyph[]; width: number } {
  const glyphs: PositionedGlyph[] = [];
  let pen = x;
  for (const c of text) {
    const index = drawableGlyph(font, c.codePointAt(0) as number);
    glyphs.push({ index, x: pen, y });
    pen += glyphAdvance(font, index);
  }
  return { glyphs, width: pen - x };
}

export function mprint(list: DrawList, font: BitmapFont, x: number, y: number, text: string, colors: FontColors): number {
  const run = glyphRun(font, text, x, y);
  if (font.glyphs.length > 0) list.glyphs(font.id, run.glyphs, colors);
  return run.width;
}

export function withClip(list: DrawList, clip: Area | null, draw: () => void): void {
  if (!clip) {
    draw();
    return;
  }
  list.pushClip(clip.x, clip.y, clip.x + clip.width, clip.y + clip.height);
  try {
    draw();
  } finally {
    list.popClip();
  }
}
