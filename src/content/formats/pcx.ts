// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/sgp/PCX.cc LoadPCXFileToImage, BlitPcxToBuffer

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';

const HEADER_BYTES = 128;
const PALETTE_BYTES = 768;
const ZSOFT_MANUFACTURER = 10;
const RLE_ENCODING = 1;
const RUN_MARKER = 0xc0;
const RUN_LENGTH_MASK = 0x3f;

export interface Pcx {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly palette: Uint8Array;
}

export function decodePcx(bytes: Uint8Array): Pcx {
  if (bytes.length < HEADER_BYTES + PALETTE_BYTES) throw new FormatError('PCX file too short');
  const r = new BinaryReader(bytes);
  const manufacturer = r.u8();
  r.u8();
  const encoding = r.u8();
  r.u8();
  const left = r.u16();
  const top = r.u16();
  const right = r.u16();
  const bottom = r.u16();
  if (manufacturer !== ZSOFT_MANUFACTURER || encoding !== RLE_ENCODING) throw new FormatError('PCX file has invalid header');
  const width = right - left + 1;
  const height = bottom - top + 1;
  const src = bytes.subarray(HEADER_BYTES, bytes.length - PALETTE_BYTES);
  const pixels = new Uint8Array(width * height);
  let pos = 0;
  let out = 0;
  while (out < pixels.length && pos < src.length) {
    const b = src[pos++] as number;
    if (b >= RUN_MARKER) {
      const run = Math.min(b & RUN_LENGTH_MASK, pixels.length - out);
      pixels.fill(src[pos++] ?? 0, out, out + run);
      out += run;
    } else {
      pixels[out++] = b;
    }
  }
  return { width, height, pixels, palette: bytes.slice(bytes.length - PALETTE_BYTES) };
}
