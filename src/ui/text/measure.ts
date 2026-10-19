// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Font.cc GetCharWidth, StringPixLength (a plain sum of advances), CenterAlign, RightAlign,
// @src HCenterVCenterAlign, HRightVCenterAlign, FindFontCenterCoordinates, FindFontRightCoordinates (integer division
// @src truncating towards zero). See docs/28 §3.4.

import { idiv } from '../../core/int.ts';
import { type BitmapFont, drawableGlyph, fontHeight, glyphAdvance } from './bitmap-font.ts';

export interface TextPoint {
  readonly x: number;
  readonly y: number;
}

export function codePoints(text: string): number[] {
  return Array.from(text, (c) => c.codePointAt(0) as number);
}

export function charWidth(font: BitmapFont, codePoint: number): number {
  return glyphAdvance(font, drawableGlyph(font, codePoint));
}

export function stringPixLength(text: string, font: BitmapFont): number {
  let width = 0;
  for (const c of text) width += charWidth(font, c.codePointAt(0) as number);
  return width;
}

export function centerAlign(x: number, y: number, width: number, text: string, font: BitmapFont): TextPoint {
  return { x: idiv(width - stringPixLength(text, font) + 1, 2) + x, y };
}

export function rightAlign(x: number, y: number, width: number, text: string, font: BitmapFont): TextPoint {
  return { x: width - stringPixLength(text, font) + x, y };
}

export function hCenterVCenterAlign(x: number, y: number, width: number, height: number, text: string, font: BitmapFont): TextPoint {
  return { x: idiv(width - stringPixLength(text, font) + 1, 2) + x, y: idiv(height - fontHeight(font), 2) + y };
}

export function hRightVCenterAlign(x: number, y: number, width: number, height: number, text: string, font: BitmapFont): TextPoint {
  return { x: width - stringPixLength(text, font) + x, y: idiv(height - fontHeight(font), 2) + y };
}
