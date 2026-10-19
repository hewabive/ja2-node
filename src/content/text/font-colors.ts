// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Font_Control.h FONT_MCOLOR_*, FONT_* colours, NO_SHADOW, DEFAULT_SHADOW; src/sgp/Font.cc
// @src SetFontForeground, SetFontShadow, SetFontBackground; src/sgp/VObject_Blitters.cc
// @src Blt8BPPDataTo16BPPBufferMonoShadowClip (0 background, 1 shadow, else foreground; a 16-bit 0 is not drawn).
// See docs/28 §3.4.

import { rgbToRgb565 } from '../formats/rgb565.ts';

export const FontColor = {
  MCOLOR_BLACK: 0,
  MCOLOR_WHITE: 208,
  MCOLOR_DKWHITE: 134,
  MCOLOR_LTGRAY: 134,
  MCOLOR_DKGRAY: 136,
  MCOLOR_LTBLUE: 203,
  MCOLOR_LTRED: 162,
  MCOLOR_RED: 163,
  MCOLOR_DKRED: 164,
  MCOLOR_LTGREEN: 184,
  MCOLOR_LTYELLOW: 144,
  WHITE: 208,
  GRAY1: 133,
  GRAY2: 134,
  GRAY3: 135,
  GRAY4: 136,
  GRAY5: 137,
  GRAY6: 138,
  GRAY7: 139,
  GRAY8: 140,
  NEARBLACK: 141,
  BLACK: 0,
  LTRED: 162,
  RED: 163,
  DKRED: 218,
  ORANGE: 76,
  YELLOW: 145,
  DKYELLOW: 80,
  LTGREEN: 184,
  GREEN: 185,
  DKGREEN: 186,
  LTBLUE: 71,
  BLUE: 203,
  DKBLUE: 205,
  BEIGE: 130,
  METALGRAY: 94,
  BURGUNDY: 172,
  LTKHAKI: 88,
  KHAKI: 198,
  DKKHAKI: 201,
} as const;

export const NO_SHADOW = 0;
export const DEFAULT_SHADOW = 2;
export const GLYPH_BACKGROUND_PIXEL = 0;
export const GLYPH_SHADOW_PIXEL = 1;
export const NEAR_BLACK_RGB = 0x000008;

export interface ResolvedFontColors {
  readonly foreground: number;
  readonly shadow: number | null;
  readonly background: number | null;
}

const PALETTE_BYTES = 768;

function paletteRgb(palette: Uint8Array, index: number): [number, number, number] {
  if (palette.length !== PALETTE_BYTES) throw new RangeError('a font palette has 256 RGB colours');
  const at = (index & 0xff) * 3;
  return [palette[at] as number, palette[at + 1] as number, palette[at + 2] as number];
}

function packed([r, g, b]: [number, number, number]): number {
  return (r << 16) | (g << 8) | b;
}

function blackIn16Bits([r, g, b]: [number, number, number]): boolean {
  return rgbToRgb565(r, g, b) === 0;
}

export function resolveFontColors(palette: Uint8Array, foreground: number, shadow: number, background: number): ResolvedFontColors {
  const shadowRgb = paletteRgb(palette, shadow);
  const backgroundRgb = paletteRgb(palette, background);
  const shadowColor = !blackIn16Bits(shadowRgb) ? packed(shadowRgb) : shadow !== NO_SHADOW ? NEAR_BLACK_RGB : null;
  return {
    foreground: packed(paletteRgb(palette, foreground)),
    shadow: shadowColor,
    background: blackIn16Bits(backgroundRgb) ? null : packed(backgroundRgb),
  };
}
