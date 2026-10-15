import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { decodePng, encodePngIndexed, encodePngRgba, PngColorType } from './png.ts';

describe('PNG', () => {
  it('round-trips indexed images with palette and tRNS', () => {
    const idx = Uint8Array.from({ length: 12 }, (_, i) => i % 3);
    const pal = Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255, 0);
    const png = decodePng(encodePngIndexed(4, 3, idx, pal, { transparentIndex0: true }));
    expect(png.colorType).toBe(PngColorType.INDEXED);
    expect([png.width, png.height]).toEqual([4, 3]);
    expect(png.palette).toEqual(pal);
    expect([...(png.transparency ?? [])]).toEqual([0]);
    expect(png.data).toEqual(idx);
  });

  it('RGBA', () => {
    const rgba = Uint8Array.from({ length: 2 * 2 * 4 }, (_, i) => (i * 37) & 0xff);
    const png = decodePng(encodePngRgba(2, 2, rgba));
    expect(png.channels).toBe(4);
    expect(png.data).toEqual(rgba);
  });

  it('reverses filters 1–4', () => {
    const w = 3;
    const rows = [
      [0, 10, 20, 30],
      [1, 10, 5, 5],
      [2, 1, 1, 1],
      [3, 5, 5, 5],
      [4, 1, 2, 3],
    ];
    const raw = Uint8Array.from(rows.flat());
    const expected: number[][] = [];
    for (const [f, ...vals] of rows) {
      const prev = expected.at(-1) ?? [0, 0, 0];
      const cur: number[] = [];
      vals.forEach((v, x) => {
        const a = x > 0 ? (cur[x - 1] ?? 0) : 0;
        const b = prev[x] ?? 0;
        const c = x > 0 ? (prev[x - 1] ?? 0) : 0;
        const p = a + b - c;
        const paeth =
          Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
        const pred = [0, a, b, (a + b) >> 1, paeth][f ?? 0] ?? 0;
        cur.push((v + pred) & 0xff);
      });
      expected.push(cur);
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (b: Uint8Array) => {
      let c = 0xffffffff;
      for (const x of b) c = (crcTable[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Uint8Array) => {
      const body = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)).concat([...data]));
      const len = data.length;
      const c = crc(body);
      return [len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
    };
    const ihdr = Uint8Array.of(0, 0, 0, w, 0, 0, 0, 5, 8, 0, 0, 0, 0);
    const file = Uint8Array.from([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...chunk('IHDR', ihdr),
      ...chunk('IDAT', zlibSync(raw)),
      ...chunk('IEND', new Uint8Array(0)),
    ]);
    const png = decodePng(file);
    expect([...png.data]).toEqual(expected.flat());
  });

  it('detects corruption', () => {
    const png = encodePngRgba(1, 1, Uint8Array.of(1, 2, 3, 4));
    const bad = png.slice();
    bad[20] = (bad[20] ?? 0) ^ 0xff;
    expect(() => decodePng(bad)).toThrow(FormatError);
    expect(() => decodePng(Uint8Array.of(1, 2, 3))).toThrow(FormatError);
  });
});
