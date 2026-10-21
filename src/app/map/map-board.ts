// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc DrawMap (BltVideoSurfaceHalf of b_map.pcx), InitializePalettesForMap
// @src (Create16BPPPaletteShaded 400/200 red and green, mono), ShadeMapElem; src/sgp/HImage.cc Create16BPPPaletteShaded;
// @src src/sgp/VSurface.cc BltVideoSurfaceHalf (every second pixel of every second row).

import { decodePcx, type Pcx } from '../../content/formats/pcx.ts';
import { rgbToRgb565 } from '../../content/formats/rgb565.ts';
import type { StiRgb } from '../../content/formats/sti.ts';
import type { MapBoardArt } from '../../ui/screens/map/map-view.ts';

export const BOARD_PCX = 'interface/b_map.pcx';
const BOARD_KEY_PREFIX = 'map-board/';
const PALETTE_SIZE = 256;
const LUMIN_R = 299;
const LUMIN_G = 587;
const LUMIN_B = 114;
const LUMIN_DIVISOR = 1000;
const SCALE_DIVISOR = 256;
const CHANNEL_MAX = 255;

type Shade = readonly [number, number, number];

const SHADES: Readonly<Record<Exclude<keyof MapBoardArt, 'normal'>, Shade>> = {
  ltRed: [400, 0, 0],
  dkRed: [200, 0, 0],
  ltGreen: [0, 400, 0],
  dkGreen: [0, 200, 0],
};

export const BOARD_KEYS: MapBoardArt = {
  normal: `${BOARD_KEY_PREFIX}normal`,
  ltRed: `${BOARD_KEY_PREFIX}ltRed`,
  dkRed: `${BOARD_KEY_PREFIX}dkRed`,
  ltGreen: `${BOARD_KEY_PREFIX}ltGreen`,
  dkGreen: `${BOARD_KEY_PREFIX}dkGreen`,
};

function plainPalette(palette: Uint8Array): Uint16Array {
  const out = new Uint16Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) out[i] = rgbToRgb565(palette[i * 3] ?? 0, palette[i * 3 + 1] ?? 0, palette[i * 3 + 2] ?? 0);
  return out;
}

export function monoShadedPalette(palette: Uint8Array, [rs, gs, bs]: Shade): Uint16Array {
  const out = new Uint16Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const r = palette[i * 3] ?? 0;
    const g = palette[i * 3 + 1] ?? 0;
    const b = palette[i * 3 + 2] ?? 0;
    const lumin = Math.floor((r * LUMIN_R + g * LUMIN_G + b * LUMIN_B) / LUMIN_DIVISOR);
    const channel = (scale: number) => Math.min(Math.floor((scale * lumin) / SCALE_DIVISOR), CHANNEL_MAX);
    out[i] = rgbToRgb565(channel(rs), channel(gs), channel(bs));
  }
  return out;
}

export function halfImage(pcx: Pcx, palette: Uint16Array): StiRgb {
  const width = Math.floor(pcx.width / 2);
  const height = Math.floor(pcx.height / 2);
  const pixels = new Uint16Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixels[y * width + x] = palette[pcx.pixels[2 * y * pcx.width + 2 * x] ?? 0] ?? 0;
  return { kind: 'rgb', width, height, flags: 0, pixels };
}

export function boardImages(bytes: Uint8Array): Readonly<Record<keyof MapBoardArt, StiRgb>> {
  const pcx = decodePcx(bytes);
  return {
    normal: halfImage(pcx, plainPalette(pcx.palette)),
    ltRed: halfImage(pcx, monoShadedPalette(pcx.palette, SHADES.ltRed)),
    dkRed: halfImage(pcx, monoShadedPalette(pcx.palette, SHADES.dkRed)),
    ltGreen: halfImage(pcx, monoShadedPalette(pcx.palette, SHADES.ltGreen)),
    dkGreen: halfImage(pcx, monoShadedPalette(pcx.palette, SHADES.dkGreen)),
  };
}
