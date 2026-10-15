import { unzlibSync, zlibSync } from 'fflate';
import { FormatError } from '../binary/errors.ts';

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(chunks: readonly Uint8Array[]): number {
  let c = 0xffffffff;
  for (const bytes of chunks) {
    for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

function u32be(v: number): Uint8Array {
  return Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

function readU32be(b: Uint8Array, at: number): number {
  return (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0;
}

export const PngColorType = { GRAY: 0, RGB: 2, INDEXED: 3, GRAY_ALPHA: 4, RGBA: 6 } as const;

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export interface PngImage {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly palette: Uint8Array | null;
  readonly transparency: Uint8Array | null;
  readonly data: Uint8Array;
  readonly channels: number;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): PngImage {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new FormatError('not a PNG file');
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = readU32be(bytes, pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (data.length !== len) throw new FormatError(`PNG chunk ${type} truncated`);
    if (readU32be(bytes, pos + 8 + len) !== crc32([bytes.subarray(pos + 4, pos + 8), data])) {
      throw new FormatError(`PNG chunk ${type} has a bad CRC`);
    }
    pos += 12 + len;
    if (type === 'IHDR') {
      width = readU32be(data, 0);
      height = readU32be(data, 4);
      const depth = data[8];
      colorType = data[9] ?? -1;
      if (depth !== 8) throw new FormatError(`only 8-bit PNG is supported, got ${depth}`);
      if (data[12] !== 0) throw new FormatError('interlaced PNG is not supported');
      if (!(colorType in CHANNELS)) throw new FormatError(`bad PNG colour type ${colorType}`);
    } else if (type === 'PLTE') {
      palette = data.slice();
    } else if (type === 'tRNS') {
      transparency = data.slice();
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (colorType < 0) throw new FormatError('PNG without IHDR');
  const channels = CHANNELS[colorType] as number;
  const joined = new Uint8Array(idat.reduce((a, c) => a + c.length, 0));
  let at = 0;
  for (const c of idat) {
    joined.set(c, at);
    at += c.length;
  }
  const raw = unzlibSync(joined);
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new FormatError('PNG image data truncated');
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] as number;
      const a = x >= channels ? (out[dst + x - channels] as number) : 0;
      const b = y > 0 ? (out[dst - stride + x] as number) : 0;
      const c = x >= channels && y > 0 ? (out[dst - stride + x - channels] as number) : 0;
      let pred: number;
      switch (filter) {
        case 0:
          pred = 0;
          break;
        case 1:
          pred = a;
          break;
        case 2:
          pred = b;
          break;
        case 3:
          pred = (a + b) >> 1;
          break;
        case 4:
          pred = paeth(a, b, c);
          break;
        default:
          throw new FormatError(`bad PNG filter ${filter}`);
      }
      out[dst + x] = (v + pred) & 0xff;
    }
  }
  return { width, height, colorType, palette, transparency, data: out, channels };
}

function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const t = ascii(type);
  return [u32be(data.length), t, data, u32be(crc32([t, data]))];
}

function encode(width: number, height: number, colorType: number, data: Uint8Array, extra: Uint8Array[][]): Uint8Array {
  const channels = CHANNELS[colorType] as number;
  const stride = width * channels;
  if (data.length !== stride * height) throw new RangeError('pixel data does not match PNG size');
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [
    [SIGNATURE],
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ].flat();
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function encodePngIndexed(
  width: number,
  height: number,
  indices: Uint8Array,
  palette: Uint8Array,
  options: { transparentIndex0?: boolean } = {},
): Uint8Array {
  if (palette.length % 3 !== 0 || palette.length === 0 || palette.length > 768) throw new RangeError('bad PNG palette');
  const extra = [chunk('PLTE', palette)];
  if (options.transparentIndex0) extra.push(chunk('tRNS', Uint8Array.of(0)));
  return encode(width, height, PngColorType.INDEXED, indices, extra);
}

export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  return encode(width, height, PngColorType.RGBA, rgba, []);
}
