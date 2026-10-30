// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc gusShadeLevels, CreateShadedPalettes, AddSaturatePalette;
// @src src/sgp/HImage.cc Create16BPPPaletteShaded, Get16BPPColor; src/sgp/Shading.cc

import { idiv } from '../../core/int.ts';

export const SHADE_LEVEL_COUNT = 16;
export const BRIGHTEST_SHADE = 1;
export const DARKEST_NATURAL_SHADE = 15;
export const NORMAL_SHADE = 4;
export const SHADOW_FACTOR = 0.48;
const BLACK_SUBSTITUTE = 0x0001;

export const SHADE_LEVELS: readonly (readonly [number, number, number])[] = [
  [500, 500, 500],
  [450, 450, 450],
  [350, 350, 350],
  [300, 300, 300],
  [255, 255, 255],
  [231, 199, 199],
  [209, 185, 185],
  [187, 171, 171],
  [165, 157, 157],
  [143, 143, 143],
  [121, 121, 129],
  [99, 99, 115],
  [77, 77, 101],
  [36, 36, 244],
  [18, 18, 224],
  [48, 222, 48],
];

export function rgbTo565(r: number, g: number, b: number): number {
  const color = ((r << 8) & 0xf800) | ((g << 3) & 0x07e0) | ((b >> 3) & 0x001f);
  return color === 0 && r + g + b !== 0 ? BLACK_SUBSTITUTE : color;
}

export function displayRgbFrom565(c: number): [number, number, number] {
  const r = (c >> 11) & 0x1f;
  const g = (c >> 5) & 0x3f;
  const b = c & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

export function shadedPalette565(
  palette: Uint8Array,
  shade: number,
  lightColor: readonly [number, number, number] = [0, 0, 0],
): Uint16Array {
  const scale = SHADE_LEVELS[shade];
  if (!scale) throw new RangeError(`shade level ${shade} out of range`);
  const [sr, sg, sb] = scale;
  const out = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    const r = Math.min((palette[i * 3] ?? 0) + lightColor[0], 255);
    const g = Math.min((palette[i * 3 + 1] ?? 0) + lightColor[1], 255);
    const b = Math.min((palette[i * 3 + 2] ?? 0) + lightColor[2], 255);
    let rm: number;
    let gm: number;
    let bm: number;
    if (shade === 0) {
      const lumin = idiv(r * 299 + g * 587 + b * 114, 1000);
      rm = idiv(sr * lumin, 256);
      gm = idiv(sg * lumin, 256);
      bm = idiv(sb * lumin, 256);
    } else {
      rm = idiv(sr * r, 256);
      gm = idiv(sg * g, 256);
      bm = idiv(sb * b, 256);
    }
    out[i] = rgbTo565(Math.min(rm, 255), Math.min(gm, 255), Math.min(bm, 255));
  }
  return out;
}

export function shadedDisplayPalette(palette: Uint8Array, shade: number, lightColor?: readonly [number, number, number]): Uint8Array {
  const out = new Uint8Array(768);
  shadedPalette565(palette, shade, lightColor).forEach((c, i) => {
    out.set(displayRgbFrom565(c), i * 3);
  });
  return out;
}

export function clampShade(level: number): number {
  return Math.min(Math.max(level, BRIGHTEST_SHADE), DARKEST_NATURAL_SHADE);
}
