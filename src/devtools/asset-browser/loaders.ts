import { decodePcx } from '../../content/formats/pcx.ts';
import { decodePng, PngColorType } from '../../content/formats/png.ts';
import { decodeSti, type Sti } from '../../content/formats/sti.ts';
import { decodeTga } from '../../content/formats/tga.ts';
import { pictureFromPcx, pictureFromTga } from '../../content/picture/from-pcx-tga.ts';
import { pictureFromSti } from '../../content/picture/from-sti.ts';
import type { Picture } from '../../content/picture/picture.ts';
import { parseStubSpriteManifest, pictureFromStubSprite, STUB_SPRITE_SUFFIX } from '../../content/picture/stub-sprite.ts';
import { vfsExtension } from '../../content/vfs/path.ts';
import { fetchFile } from './api.ts';

export type Asset =
  | { readonly kind: 'picture'; readonly picture: Picture; readonly format: string; readonly sti?: Sti }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'binary'; readonly bytes: Uint8Array };

const TEXT_EXT = new Set(['txt', 'json', 'ini', 'bat', 'xml', 'csv', 'md']);

function pictureFromPng(bytes: Uint8Array): Picture {
  const png = decodePng(bytes);
  if (png.colorType === PngColorType.INDEXED && png.palette) {
    const palette = new Uint8Array(768);
    palette.set(png.palette.subarray(0, 768));
    return { kind: 'indexed', palette, frames: [{ width: png.width, height: png.height, offsetX: 0, offsetY: 0, pixels: png.data }] };
  }
  const n = png.width * png.height;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = png.channels;
    const s = i * c;
    const gray = c <= 2;
    rgba[i * 4] = png.data[s] as number;
    rgba[i * 4 + 1] = png.data[gray ? s : s + 1] as number;
    rgba[i * 4 + 2] = png.data[gray ? s : s + 2] as number;
    rgba[i * 4 + 3] = c === 4 ? (png.data[s + 3] as number) : c === 2 ? (png.data[s + 1] as number) : 255;
  }
  return { kind: 'rgba', width: png.width, height: png.height, pixels: rgba };
}

export async function loadAsset(path: string): Promise<Asset> {
  const bytes = await fetchFile(path);
  if (path.endsWith(STUB_SPRITE_SUFFIX)) {
    const manifest = parseStubSpriteManifest(JSON.parse(new TextDecoder().decode(bytes)));
    const png = await fetchFile(path.replace(/[^/]+$/, manifest.image));
    return { kind: 'picture', picture: pictureFromStubSprite(manifest, png), format: `stub sprite (${manifest.image})` };
  }
  const ext = vfsExtension(path);
  if (ext === 'sti') {
    const sti = decodeSti(bytes);
    return { kind: 'picture', picture: pictureFromSti(sti), format: sti.kind === 'rgb' ? 'STI RGB565' : 'STI 8-bit, ETRLE', sti };
  }
  if (ext === 'png') return { kind: 'picture', picture: pictureFromPng(bytes), format: 'PNG' };
  if (ext === 'pcx') return { kind: 'picture', picture: pictureFromPcx(decodePcx(bytes)), format: 'PCX' };
  if (ext === 'tga') return { kind: 'picture', picture: pictureFromTga(decodeTga(bytes)), format: 'TGA' };
  if (TEXT_EXT.has(ext)) return { kind: 'text', text: new TextDecoder().decode(bytes) };
  return { kind: 'binary', bytes };
}

export function hexDump(bytes: Uint8Array, limit = 1024): string {
  const lines: string[] = [];
  for (let off = 0; off < Math.min(bytes.length, limit); off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, bytes.length));
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > limit) lines.push(`… ${bytes.length - limit} more bytes`);
  return lines.join('\n');
}
