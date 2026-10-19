import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { decodePcx, encodePcx } from './pcx.ts';
import { rgbToRgb565 } from './rgb565.ts';
import { decodeTga } from './tga.ts';

function pcx(width: number, height: number, rle: number[]): Uint8Array {
  const w = new BinaryWriter()
    .u8(10)
    .u8(5)
    .u8(1)
    .u8(8)
    .u16(0)
    .u16(0)
    .u16(width - 1)
    .u16(height - 1);
  w.zeros(128 - w.length).bytes(Uint8Array.from(rle));
  const palette = new Uint8Array(768).map((_, i) => i % 256);
  return w.bytes(palette).toBytes();
}

describe('PCX', () => {
  it('expands runs and literals and reads the trailing palette', () => {
    const img = decodePcx(pcx(3, 2, [0xc3, 7, 1, 2, 0xc1, 9]));
    expect([img.width, img.height]).toEqual([3, 2]);
    expect([...img.pixels]).toEqual([7, 7, 7, 1, 2, 9]);
    expect(img.palette.length).toBe(768);
  });

  it('clips runs that overflow the image and rejects foreign headers', () => {
    expect([...decodePcx(pcx(2, 1, [0xc5, 3])).pixels]).toEqual([3, 3]);
    const bad = pcx(1, 1, [0]);
    bad[0] = 0;
    expect(() => decodePcx(bad)).toThrow(FormatError);
  });
});

describe('TGA', () => {
  const header = (bpp: number) => new BinaryWriter().u8(0).u8(0).u8(2).zeros(9).u16(2).u16(2).u8(bpp).u8(0);

  it('reads bottom-up 24-bit images', () => {
    const w = header(24);
    for (const [r, g, b] of [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
    ]) {
      w.u8(b ?? 0)
        .u8(g ?? 0)
        .u8(r ?? 0);
    }
    const img = decodeTga(w.toBytes());
    expect([...img.rgba.subarray(0, 4)]).toEqual([7, 8, 9, 255]);
    expect([...img.rgba.subarray(12, 16)]).toEqual([4, 5, 6, 255]);
  });

  it('treats 16-bit pixels as RGB565 like Stracciatella', () => {
    const w = header(16);
    for (let i = 0; i < 4; i++) w.u16(rgbToRgb565(255, 0, 0));
    expect([...decodeTga(w.toBytes()).rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('rejects compressed images', () => {
    expect(() => decodeTga(Uint8Array.of(0, 0, 10, ...new Array(15).fill(0)))).toThrow(FormatError);
  });
});

describe('encodePcx', () => {
  it('round-trips through decodePcx, runs and values at or above 0xC0 included', () => {
    const palette = new Uint8Array(768).map((_, i) => i % 251);
    const pixels = Uint8Array.from({ length: 13 * 7 }, (_, i) => (i < 70 ? 5 : (i * 37) % 256));
    const decoded = decodePcx(encodePcx(13, 7, pixels, palette));
    expect([decoded.width, decoded.height]).toEqual([13, 7]);
    expect([...decoded.pixels]).toEqual([...pixels]);
    expect([...decoded.palette]).toEqual([...palette]);
  });
});
