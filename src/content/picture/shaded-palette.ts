// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/HImage.cc Create16BPPPaletteShaded. See docs/28 §3.11.

const PALETTE_COLOURS = 256;
const CHANNEL_MAX = 255;
const SCALE_UNIT = 256;
const LUMINANCE_RED = 299;
const LUMINANCE_GREEN = 587;
const LUMINANCE_BLUE = 114;
const LUMINANCE_DIVISOR = 1000;

export interface PaletteScale {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly mono: boolean;
}

function scaled(scale: number, value: number): number {
  return Math.min(Math.floor((scale * value) / SCALE_UNIT), CHANNEL_MAX);
}

export function shadedPalette(palette: Uint8Array, scale: PaletteScale): Uint8Array {
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
