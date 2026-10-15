import { FormatError } from '../binary/errors.ts';
import { decodePng, PngColorType } from '../formats/png.ts';
import type { IndexedFrame, IndexedPicture } from './picture.ts';

export const STUB_SPRITE_FORMAT = 'ja2-node.sprite/1';
export const STUB_SPRITE_SUFFIX = '.sprite.json';

export interface StubSpriteFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
}

export interface StubSpriteManifest {
  readonly format: typeof STUB_SPRITE_FORMAT;
  readonly image: string;
  readonly frames: readonly StubSpriteFrame[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function parseStubSpriteManifest(json: unknown): StubSpriteManifest {
  if (typeof json !== 'object' || json === null) throw new FormatError('sprite manifest must be an object');
  const m = json as Record<string, unknown>;
  if (m.format !== STUB_SPRITE_FORMAT) throw new FormatError(`unknown sprite format ${String(m.format)}`);
  if (typeof m.image !== 'string' || m.image.includes('/') || m.image.includes('\\')) {
    throw new FormatError('sprite image must be a file name next to the manifest');
  }
  if (!Array.isArray(m.frames) || m.frames.length === 0) throw new FormatError('sprite needs at least one frame');
  const frames = m.frames.map((f: unknown, i: number): StubSpriteFrame => {
    const r = f as Record<string, unknown>;
    if (![r.x, r.y, r.w, r.h, r.ox, r.oy].every(isInt)) throw new FormatError(`frame ${i}: x, y, w, h, ox, oy must be integers`);
    return { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number, ox: r.ox as number, oy: r.oy as number };
  });
  const manifest: StubSpriteManifest = { format: STUB_SPRITE_FORMAT, image: m.image, frames };
  return typeof m.meta === 'object' && m.meta !== null ? { ...manifest, meta: m.meta as Record<string, unknown> } : manifest;
}

export function pictureFromStubSprite(manifest: StubSpriteManifest, png: Uint8Array): IndexedPicture {
  const img = decodePng(png);
  if (img.colorType !== PngColorType.INDEXED || !img.palette) throw new FormatError(`${manifest.image}: stub sprites must be indexed PNG`);
  const palette = new Uint8Array(768);
  palette.set(img.palette.subarray(0, 768));
  const frames: IndexedFrame[] = manifest.frames.map((f, i) => {
    if (f.x < 0 || f.y < 0 || f.w < 0 || f.h < 0 || f.x + f.w > img.width || f.y + f.h > img.height) {
      throw new FormatError(`frame ${i} lies outside ${manifest.image}`);
    }
    const pixels = new Uint8Array(f.w * f.h);
    for (let y = 0; y < f.h; y++) {
      const src = (f.y + y) * img.width + f.x;
      pixels.set(img.data.subarray(src, src + f.w), y * f.w);
    }
    return { width: f.w, height: f.h, offsetX: f.ox, offsetY: f.oy, pixels };
  });
  return { kind: 'indexed', palette, frames };
}
