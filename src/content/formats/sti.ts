// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src rust/stracciatella/src/file_formats/stci/{mod,indexed,rgb,color}.rs, src/sgp/STCI.cc

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { etrleDecode, etrleEncode } from './etrle.ts';

export const STCI_HEADER_BYTES = 64;
export const STCI_SUB_IMAGE_HEADER_BYTES = 16;
export const STCI_APP_DATA_BYTES = 16;

export const StciFlags = {
  TRANSPARENT: 0x01,
  ALPHA: 0x02,
  RGB: 0x04,
  INDEXED: 0x08,
  ZLIB_COMPRESSED: 0x10,
  ETRLE_COMPRESSED: 0x20,
} as const;

const KNOWN_FLAGS = 0x3f;

export interface StiAppData {
  readonly wallOrientation: number;
  readonly numberOfTiles: number;
  readonly tileLocationIndex: number;
  readonly currentFrame: number;
  readonly numberOfFrames: number;
  readonly flags: number;
}

export interface StiSubImage {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface StiIndexed {
  readonly kind: 'indexed';
  readonly width: number;
  readonly height: number;
  readonly flags: number;
  readonly palette: Uint8Array;
  readonly subImages: readonly StiSubImage[];
  readonly appData: readonly StiAppData[] | null;
  readonly anomalies: number;
}

export interface StiRgb {
  readonly kind: 'rgb';
  readonly width: number;
  readonly height: number;
  readonly flags: number;
  readonly pixels: Uint16Array;
}

export type Sti = StiIndexed | StiRgb;

export function isSti(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x53 && bytes[1] === 0x54 && bytes[2] === 0x43 && bytes[3] === 0x49;
}

export function decodeSti(bytes: Uint8Array, decodePixels = true): Sti {
  if (!isSti(bytes)) throw new FormatError('not an STCI file');
  if (bytes.length < STCI_HEADER_BYTES) throw new FormatError('STCI header truncated');
  const r = new BinaryReader(bytes, 4);
  const _originalSize = r.u32();
  const storedSize = r.u32();
  const transparentValue = r.u32();
  const flags = r.u32();
  const height = r.u16();
  const width = r.u16();
  if ((flags & ~KNOWN_FLAGS) !== 0) throw new FormatError(`unknown STCI flags 0x${flags.toString(16)}`);
  if (flags & StciFlags.ZLIB_COMPRESSED) throw new FormatError('zlib-compressed STCI is not supported');
  const indexed = (flags & StciFlags.INDEXED) !== 0;
  const rgb = (flags & StciFlags.RGB) !== 0;
  if (indexed === rgb) throw new FormatError('STCI must be either INDEXED or RGB');

  if (rgb) {
    const masks = [r.u32(), r.u32(), r.u32(), r.u32()];
    const depths = [r.u8(), r.u8(), r.u8(), r.u8()];
    const depth = r.u8();
    if (depth !== 16) throw new FormatError(`only 16-bit RGB STCI is supported, got ${depth}`);
    if (depths.join() !== '5,6,5,0' || masks.slice(0, 3).join() !== `${0xf800},${0x7e0},${0x1f}`) {
      throw new FormatError(`only RGB565 STCI is supported, got depths ${depths.join()}`);
    }
    if (flags & StciFlags.ETRLE_COMPRESSED) throw new FormatError('ETRLE-compressed RGB STCI is not supported');
    const n = width * height;
    const pr = new BinaryReader(bytes, STCI_HEADER_BYTES);
    const pixels = new Uint16Array(n);
    for (let i = 0; i < n; i++) pixels[i] = pr.u16();
    return { kind: 'rgb', width, height, flags, pixels };
  }

  const numColors = r.u32();
  const numImages = r.u16();
  const depths = [r.u8(), r.u8(), r.u8()];
  r.skip(11);
  const depth = r.u8();
  r.skip(3);
  const appDataSize = r.u32();
  if (numColors !== 256) throw new FormatError(`expected 256 palette colours, got ${numColors}`);
  if (depths.join() !== '8,8,8') throw new FormatError(`expected RGB888 palette, got ${depths.join()}`);
  if (depth !== 8) throw new FormatError(`only 8-bit indexed STCI is supported, got ${depth}`);
  if (transparentValue !== 0) throw new FormatError(`transparent value must be 0, got ${transparentValue}`);
  if (!(flags & StciFlags.ETRLE_COMPRESSED)) throw new FormatError('indexed STCI must be ETRLE-compressed');

  const body = new BinaryReader(bytes, STCI_HEADER_BYTES);
  const palette = body.bytesView(256 * 3).slice();
  const headers: { dataOffset: number; dataLength: number; ox: number; oy: number; h: number; w: number }[] = [];
  for (let i = 0; i < numImages; i++) {
    headers.push({ dataOffset: body.u32(), dataLength: body.u32(), ox: body.i16(), oy: body.i16(), h: body.u16(), w: body.u16() });
  }
  const dataStart = body.pos;
  let anomalies = 0;
  const subImages: StiSubImage[] = headers.map((h, i) => {
    const start = dataStart + h.dataOffset;
    const end = start + h.dataLength;
    if (end > bytes.length) throw new FormatError(`sub image ${i} data points outside the file`);
    if (!decodePixels) return { offsetX: h.ox, offsetY: h.oy, width: h.w, height: h.h, pixels: new Uint8Array(0) };
    const decoded = etrleDecode(bytes.subarray(start, end), h.w, h.h);
    anomalies += decoded.anomalies;
    return { offsetX: h.ox, offsetY: h.oy, width: h.w, height: h.h, pixels: decoded.pixels };
  });

  let appData: StiAppData[] | null = null;
  if (appDataSize > 0) {
    const ar = new BinaryReader(bytes, dataStart + storedSize);
    if (appDataSize < numImages * STCI_APP_DATA_BYTES || ar.remaining < numImages * STCI_APP_DATA_BYTES) {
      throw new FormatError(`app data too short: ${appDataSize} bytes for ${numImages} images`);
    }
    appData = [];
    for (let i = 0; i < numImages; i++) {
      const wallOrientation = ar.u8();
      const numberOfTiles = ar.u8();
      const tileLocationIndex = ar.u16();
      ar.skip(3);
      const currentFrame = ar.u8();
      const numberOfFrames = ar.u8();
      const appFlags = ar.u8();
      ar.skip(6);
      appData.push({ wallOrientation, numberOfTiles, tileLocationIndex, currentFrame, numberOfFrames, flags: appFlags });
    }
  }
  return { kind: 'indexed', width, height, flags, palette, subImages, appData, anomalies };
}

export interface StiIndexedInput {
  readonly palette: Uint8Array;
  readonly subImages: readonly Omit<StiSubImage, never>[];
  readonly appData?: readonly StiAppData[];
}

export function encodeStiIndexed(input: StiIndexedInput): Uint8Array {
  if (input.palette.length !== 768) throw new RangeError('palette must have 256 RGB colours');
  if (input.subImages.length === 0 || input.subImages.length > 0xffff) throw new RangeError('bad sub image count');
  if (input.appData && input.appData.length !== input.subImages.length) {
    throw new RangeError('app data must have one record per sub image');
  }
  const encoded = input.subImages.map((s) => etrleEncode(s.pixels, s.width, s.height));
  const original = input.subImages.reduce((a, s) => a + s.width * s.height, 0);
  const stored = encoded.reduce((a, e) => a + e.length, 0);
  const appDataSize = input.appData ? input.appData.length * STCI_APP_DATA_BYTES : 0;
  const w = new BinaryWriter();
  w.bytes(Uint8Array.of(0x53, 0x54, 0x43, 0x49))
    .u32(original)
    .u32(stored)
    .u32(0)
    .u32(StciFlags.INDEXED | StciFlags.ETRLE_COMPRESSED)
    .u16(0)
    .u16(0)
    .u32(256)
    .u16(input.subImages.length)
    .u8(8)
    .u8(8)
    .u8(8)
    .zeros(11)
    .u8(8)
    .zeros(3)
    .u32(appDataSize)
    .zeros(12)
    .bytes(input.palette);
  let offset = 0;
  input.subImages.forEach((s, i) => {
    const len = encoded[i]?.length ?? 0;
    w.u32(offset).u32(len).i16(s.offsetX).i16(s.offsetY).u16(s.height).u16(s.width);
    offset += len;
  });
  for (const e of encoded) w.bytes(e);
  for (const a of input.appData ?? []) {
    w.u8(a.wallOrientation).u8(a.numberOfTiles).u16(a.tileLocationIndex).zeros(3);
    w.u8(a.currentFrame).u8(a.numberOfFrames).u8(a.flags).zeros(6);
  }
  return w.toBytes();
}

export function encodeStiRgb(width: number, height: number, pixels: Uint16Array): Uint8Array {
  if (pixels.length !== width * height) throw new RangeError('pixel count does not match size');
  const w = new BinaryWriter(STCI_HEADER_BYTES + pixels.length * 2);
  w.bytes(Uint8Array.of(0x53, 0x54, 0x43, 0x49))
    .u32(pixels.length * 2)
    .u32(pixels.length * 2)
    .u32(0)
    .u32(StciFlags.RGB)
    .u16(height)
    .u16(width)
    .u32(0xf800)
    .u32(0x7e0)
    .u32(0x1f)
    .u32(0)
    .u8(5)
    .u8(6)
    .u8(5)
    .u8(0)
    .u8(16)
    .zeros(3)
    .u32(0)
    .zeros(12);
  for (const p of pixels) w.u16(p);
  return w.toBytes();
}
