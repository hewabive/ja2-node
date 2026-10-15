// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/sgp/ImpTGA.cc ReadUncompRGBImage

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { rgb565ToRgba } from './rgb565.ts';

const UNCOMPRESSED_TRUE_COLOR = 2;

export interface Tga {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export function decodeTga(bytes: Uint8Array): Tga {
  const r = new BinaryReader(bytes);
  const idLength = r.u8();
  const hasColorMap = r.u8() !== 0;
  const imageType = r.u8();
  if (imageType !== UNCOMPRESSED_TRUE_COLOR) throw new FormatError(`unsupported TGA image type ${imageType}`);
  r.skip(2);
  const colorMapLength = r.u16();
  r.skip(5);
  const width = r.u16();
  const height = r.u16();
  const bitsPerPixel = r.u8();
  r.skip(1);
  r.skip(idLength);
  if (hasColorMap) r.skip(colorMapLength * (bitsPerPixel / 8));
  const rgba = new Uint8Array(width * height * 4);
  for (let row = height - 1; row >= 0; row--) {
    if (bitsPerPixel === 16) {
      const line = new Uint16Array(width);
      for (let x = 0; x < width; x++) line[x] = r.u16();
      rgba.set(rgb565ToRgba(line), row * width * 4);
    } else if (bitsPerPixel === 24) {
      for (let x = 0; x < width; x++) {
        const [b, g, red] = [r.u8(), r.u8(), r.u8()];
        rgba.set([red, g, b, 255], (row * width + x) * 4);
      }
    } else {
      throw new FormatError(`unsupported TGA colour depth ${bitsPerPixel}`);
    }
  }
  return { width, height, rgba };
}
