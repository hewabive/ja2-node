// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/HImage.cc Create16BPPPaletteShaded; src/game/Tactical/Faces.cc InitFace (the all-white palette of the portrait
// @src flash and the grey ramp i % 128 + 128).

const PALETTE_COLOURS = 256;
const CHANNEL_MAX = 255;
const SCALE_UNIT = 256;
const LUMINANCE_RED = 299;
const LUMINANCE_GREEN = 587;
const LUMINANCE_BLUE = 114;
const LUMINANCE_DIVISOR = 1000;

export type PaletteBase = 'image' | 'white' | 'grayRamp';

export interface PaletteScale {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly mono: boolean;
  readonly base?: PaletteBase;
}

const GRAY_RAMP_STEP = 128;

export function basePalette(palette: Uint8Array, base: PaletteBase): Uint8Array {
  if (base === 'image') return palette;
  const out = new Uint8Array(PALETTE_COLOURS * 3);
  for (let i = 0; i < PALETTE_COLOURS; i++) {
    const value = base === 'white' ? CHANNEL_MAX : (i % GRAY_RAMP_STEP) + GRAY_RAMP_STEP;
    out.fill(value, i * 3, i * 3 + 3);
  }
  return out;
}

function scaled(scale: number, value: number): number {
  return Math.min(Math.floor((scale * value) / SCALE_UNIT), CHANNEL_MAX);
}

export function shadedPalette(source: Uint8Array, scale: PaletteScale): Uint8Array {
  const palette = basePalette(source, scale.base ?? 'image');
  const out = new Uint8Array(PALETTE_COLOURS * 3);
  for (let i = 0; i < PALETTE_COLOURS; i++) {
    const r = palette[i * 3] ?? 0;
    const g = palette[i * 3 + 1] ?? 0;
    const b = palette[i * 3 + 2] ?? 0;
    const lumin = Math.floor((r * LUMINANCE_RED + g * LUMINANCE_GREEN + b * LUMINANCE_BLUE) / LUMINANCE_DIVISOR);
    out[i * 3] = scaled(scale.red, scale.mono ? lumin : r);
    out[i * 3 + 1] = scaled(scale.green, scale.mono ? lumin : g);
    out[i * 3 + 2] = scaled(scale.blue, scale.mono ? lumin : b);
  }
  return out;
}
