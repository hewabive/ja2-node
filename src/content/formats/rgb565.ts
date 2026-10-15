// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src rust/stracciatella/src/file_formats/stci/color.rs (From<StciRgb565> for StciRgb888)

export function rgb565ToRgba(pixels: Uint16Array, out = new Uint8Array(pixels.length * 4)): Uint8Array {
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i] as number;
    const r = (v & 0xf800) >> 8;
    const g = (v & 0x07e0) >> 3;
    const b = (v & 0x001f) << 3;
    const o = i * 4;
    out[o] = Math.trunc((255 * r) / 0xf8);
    out[o + 1] = Math.trunc((255 * g) / 0xfc);
    out[o + 2] = Math.trunc((255 * b) / 0xf8);
    out[o + 3] = 255;
  }
  return out;
}

export function rgbToRgb565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}
