import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { pictureFromSti } from '../picture/from-sti.ts';
import { etrleDecode, etrleEncode } from './etrle.ts';
import { rgb565ToRgba, rgbToRgb565 } from './rgb565.ts';
import { decodeSti, encodeStiIndexed, encodeStiRgb, StciFlags } from './sti.ts';

function pattern(w: number, h: number, seed: number): Uint8Array {
  const p = new Uint8Array(w * h);
  for (let i = 0; i < p.length; i++) p[i] = (i * 7 + seed) % 5 === 0 ? 0 : (i * 13 + seed) % 256;
  return p;
}

describe('ETRLE', () => {
  it('round-trips frames including long runs', () => {
    const w = 300;
    const h = 3;
    const px = new Uint8Array(w * h);
    px.fill(9, 0, 200);
    px.fill(0, 200, 600);
    px.set(pattern(w, 1, 3), 600);
    const enc = etrleEncode(px, w, h);
    const dec = etrleDecode(enc, w, h);
    expect(dec.anomalies).toBe(0);
    expect(dec.pixels).toEqual(px);
  });

  it('accepts streams without row terminators (as Stracciatella writes them)', () => {
    const dec = etrleDecode(Uint8Array.of(0x81, 2, 5, 6, 0x81), 2, 2);
    expect(dec.anomalies).toBe(0);
    expect([...dec.pixels]).toEqual([0, 5, 6, 0]);
  });

  it('flags mid-row terminators and missing pixels', () => {
    const dec = etrleDecode(Uint8Array.of(1, 7, 0, 2, 8, 9), 2, 2);
    expect([...dec.pixels]).toEqual([7, 0, 8, 9]);
    expect(dec.anomalies).toBe(1);
    expect(etrleDecode(Uint8Array.of(1, 7), 2, 2).anomalies).toBe(1);
  });
});

describe('STI', () => {
  const palette = new Uint8Array(768).map((_, i) => (i * 5) & 0xff);

  it('round-trips 8-bit images with palette, offsets and aux data', () => {
    const subImages = [
      { offsetX: -10, offsetY: -20, width: 20, height: 30, pixels: pattern(20, 30, 1) },
      { offsetX: 3, offsetY: 4, width: 1, height: 1, pixels: Uint8Array.of(42) },
      { offsetX: 0, offsetY: 0, width: 0, height: 0, pixels: new Uint8Array(0) },
    ];
    const appData = subImages.map((_, i) => ({
      wallOrientation: i,
      numberOfTiles: 1,
      tileLocationIndex: 100 + i,
      currentFrame: 0,
      numberOfFrames: 3,
      flags: 0x02,
    }));
    const sti = decodeSti(encodeStiIndexed({ palette, subImages, appData }));
    expect(sti.kind).toBe('indexed');
    if (sti.kind !== 'indexed') return;
    expect(sti.flags).toBe(StciFlags.INDEXED | StciFlags.ETRLE_COMPRESSED);
    expect(sti.palette).toEqual(palette);
    expect(sti.anomalies).toBe(0);
    expect(sti.subImages).toEqual(subImages);
    expect(sti.appData).toEqual(appData);
    const pic = pictureFromSti(sti);
    expect(pic.kind === 'indexed' && pic.frames[0]?.offsetY).toBe(-20);
  });

  it('round-trips 16-bit RGB565 images', () => {
    const px = Uint16Array.from([rgbToRgb565(255, 0, 0), rgbToRgb565(0, 255, 0), rgbToRgb565(0, 0, 255), 0xffff]);
    const sti = decodeSti(encodeStiRgb(2, 2, px));
    expect(sti.kind).toBe('rgb');
    if (sti.kind !== 'rgb') return;
    expect([sti.width, sti.height]).toEqual([2, 2]);
    expect(sti.pixels).toEqual(px);
    expect([...rgb565ToRgba(sti.pixels)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  });

  it('rejects foreign and broken files', () => {
    expect(() => decodeSti(new TextEncoder().encode('PNG...'))).toThrow(FormatError);
    const good = encodeStiIndexed({ palette, subImages: [{ offsetX: 0, offsetY: 0, width: 4, height: 4, pixels: pattern(4, 4, 2) }] });
    expect(() => decodeSti(good.subarray(0, 40))).toThrow(FormatError);
    const zlib = good.slice();
    zlib[16] = (zlib[16] ?? 0) | StciFlags.ZLIB_COMPRESSED;
    expect(() => decodeSti(zlib)).toThrow(/zlib/);
  });
});
