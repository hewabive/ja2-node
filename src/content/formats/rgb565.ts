export function rgb565ToRgba(pixels: Uint16Array, out = new Uint8Array(pixels.length * 4)): Uint8Array {
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i] as number;
    const r = (v >> 11) & 0x1f;
    const g = (v >> 5) & 0x3f;
    const b = v & 0x1f;
    const o = i * 4;
    out[o] = (r << 3) | (r >> 2);
    out[o + 1] = (g << 2) | (g >> 4);
    out[o + 2] = (b << 3) | (b >> 2);
    out[o + 3] = 255;
  }
  return out;
}

export function rgbToRgb565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}
