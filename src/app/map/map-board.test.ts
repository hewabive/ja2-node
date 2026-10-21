import { describe, expect, it } from 'vitest';
import { encodePcx, type Pcx } from '../../content/formats/pcx.ts';
import { rgbToRgb565 } from '../../content/formats/rgb565.ts';
import { BOARD_KEYS, boardImages, halfImage, monoShadedPalette } from './map-board.ts';

const PALETTE_BYTES = 768;
const GREYISH = 1;
const WHITE = 2;

function palette(): Uint8Array {
  const p = new Uint8Array(PALETTE_BYTES);
  p.set([100, 150, 200], GREYISH * 3);
  p.set([255, 255, 255], WHITE * 3);
  for (let i = 3; i < 16; i++) p.set([i * 10, i * 5, i * 2], i * 3);
  return p;
}

function identity(): Uint16Array {
  return Uint16Array.from({ length: 256 }, (_v, i) => i);
}

describe('the half-scale map board', () => {
  it('takes every second pixel of every second row, like BltVideoSurfaceHalf', () => {
    const pcx: Pcx = { width: 4, height: 4, pixels: Uint8Array.from({ length: 16 }, (_v, i) => i), palette: palette() };
    const half = halfImage(pcx, identity());
    expect([half.width, half.height]).toEqual([2, 2]);
    expect([...half.pixels]).toEqual([0, 2, 8, 10]);
  });

  it('drops the odd last column and row', () => {
    const pcx: Pcx = { width: 5, height: 3, pixels: Uint8Array.from({ length: 15 }, (_v, i) => i), palette: palette() };
    const half = halfImage(pcx, identity());
    expect([half.width, half.height]).toEqual([2, 1]);
    expect([...half.pixels]).toEqual([0, 2]);
  });

  it('shades by luminance like Create16BPPPaletteShaded in mono mode', () => {
    const lumin = Math.floor((100 * 299 + 150 * 587 + 200 * 114) / 1000);
    expect(lumin).toBe(140);
    const ltRed = monoShadedPalette(palette(), [400, 0, 0]);
    expect(ltRed[GREYISH]).toBe(rgbToRgb565(Math.floor((400 * lumin) / 256), 0, 0));
    expect(ltRed[WHITE]).toBe(rgbToRgb565(255, 0, 0));
    const dkGreen = monoShadedPalette(palette(), [0, 200, 0]);
    expect(dkGreen[GREYISH]).toBe(rgbToRgb565(0, Math.floor((200 * lumin) / 256), 0));
    expect(dkGreen[WHITE]).toBe(rgbToRgb565(0, Math.floor((200 * 255) / 256), 0));
  });

  it('builds the normal board and its four shades from b_map.pcx', () => {
    const pixels = Uint8Array.from([GREYISH, WHITE, WHITE, GREYISH, 0, 0, 0, 0]);
    const images = boardImages(encodePcx(4, 2, pixels, palette()));
    expect(Object.keys(images).sort()).toEqual(Object.keys(BOARD_KEYS).sort());
    for (const image of Object.values(images)) expect([image.kind, image.width, image.height]).toEqual(['rgb', 2, 1]);
    expect([...images.normal.pixels]).toEqual([rgbToRgb565(100, 150, 200), rgbToRgb565(255, 255, 255)]);
    expect(images.ltRed.pixels[1]).toBe(rgbToRgb565(255, 0, 0));
    expect(images.dkRed.pixels[1]).toBe(rgbToRgb565(199, 0, 0));
    expect(images.ltGreen.pixels[1]).toBe(rgbToRgb565(0, 255, 0));
    expect(images.dkGreen.pixels[1]).toBe(rgbToRgb565(0, 199, 0));
    expect(new Set(Object.values(BOARD_KEYS)).size).toBe(5);
  });
});
