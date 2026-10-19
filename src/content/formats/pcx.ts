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

const PCX_VERSION = 5;
const BITS_PER_PIXEL = 8;
const PLANES = 1;
const PALETTE_MARKER = 0x0c;
const COLOR_PALETTE_INFO = 1;
const MAX_RUN = 0x3f;

export function encodePcx(width: number, height: number, pixels: Uint8Array, palette: Uint8Array): Uint8Array {
  if (pixels.length !== width * height) throw new RangeError('pixel count does not match size');
  if (palette.length !== PALETTE_BYTES) throw new RangeError('palette must have 256 RGB colours');
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  header[0] = ZSOFT_MANUFACTURER;
  header[1] = PCX_VERSION;
  header[2] = RLE_ENCODING;
  header[3] = BITS_PER_PIXEL;
  view.setUint16(8, width - 1, true);
  view.setUint16(10, height - 1, true);
  header[65] = PLANES;
  view.setUint16(66, width, true);
  view.setUint16(68, COLOR_PALETTE_INFO, true);
  const body: number[] = [];
  let i = 0;
  while (i < pixels.length) {
    const value = pixels[i] as number;
    let run = 1;
    while (run < MAX_RUN && i + run < pixels.length && pixels[i + run] === value) run++;
    if (run > 1 || value >= RUN_MARKER) body.push(RUN_MARKER | run, value);
    else body.push(value);
    i += run;
  }
  const out = new Uint8Array(HEADER_BYTES + body.length + 1 + PALETTE_BYTES);
  out.set(header, 0);
  out.set(body, HEADER_BYTES);
  out[HEADER_BYTES + body.length] = PALETTE_MARKER;
  out.set(palette, HEADER_BYTES + body.length + 1);
  return out;
}
