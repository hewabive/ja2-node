import { decodePcx } from '../../content/formats/pcx.ts';
import { rgbToRgb565 } from '../../content/formats/rgb565.ts';
import { decodeSti, type Sti, type StiIndexed, type StiRgb } from '../../content/formats/sti.ts';
import type { IndexedPicture } from '../../content/picture/picture.ts';
import { type GlyphTable, parseGlyphTable } from '../../content/text/glyph-table.ts';
import type { UiRenderer } from '../../render/ui-draw/ui-renderer.ts';
import type { ImageCatalog, ImageInfo } from '../../ui/assets.ts';
import type { AssetKey, FontId } from '../../ui/draw-list.ts';
import { type BitmapFont, bitmapFontFromSti, fontPath } from '../../ui/text/bitmap-font.ts';
import { type FontFiles, FontSet } from '../../ui/text/fonts.ts';
import { type AssetCache, type AssetDecoder, loadDecodedAsset } from '../assets/asset-cache.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import { type PreloadProgress, preloadAssets } from '../assets/preload.ts';

const AUX_ANIMATED_TILE = 0x02;
const PCX_EXTENSION = '.pcx';
const BYTES_PER_RGB_PIXEL = 2;

function stiBytes(sti: Sti): number {
  if (sti.kind === 'rgb') return sti.pixels.byteLength;
  return sti.subImages.reduce((sum, s) => sum + s.pixels.byteLength, sti.palette.byteLength);
}

export const STI_DECODER: AssetDecoder<Sti> = { name: 'sti', decode: (bytes) => decodeSti(bytes), size: stiBytes };

export function pcxAsRgbSti(bytes: Uint8Array): StiRgb {
  const pcx = decodePcx(bytes);
  const pixels = new Uint16Array(pcx.width * pcx.height);
  for (let i = 0; i < pixels.length; i++) {
    const at = (pcx.pixels[i] ?? 0) * 3;
    pixels[i] = rgbToRgb565(pcx.palette[at] ?? 0, pcx.palette[at + 1] ?? 0, pcx.palette[at + 2] ?? 0);
  }
  return { kind: 'rgb', width: pcx.width, height: pcx.height, flags: 0, pixels };
}

export const PCX_DECODER: AssetDecoder<StiRgb> = {
  name: 'pcx-rgb',
  decode: (bytes) => pcxAsRgbSti(bytes),
  size: (sti) => sti.width * sti.height * BYTES_PER_RGB_PIXEL,
};

export function imageInfo(sti: Sti): ImageInfo {
  if (sti.kind === 'rgb')
    return { kind: 'rgb', frames: [{ width: sti.width, height: sti.height, offsetX: 0, offsetY: 0 }], animatedFrames: 0 };
  const aux = sti.appData?.[0];
  return {
    kind: 'indexed',
    frames: sti.subImages.map((s) => ({ width: s.width, height: s.height, offsetX: s.offsetX, offsetY: s.offsetY })),
    animatedFrames: aux && aux.flags & AUX_ANIMATED_TILE ? aux.numberOfFrames : 0,
  };
}

export function pictureAsSti(picture: IndexedPicture, palette: Uint8Array): StiIndexed {
  const width = Math.max(0, ...picture.frames.map((f) => f.width));
  const height = Math.max(0, ...picture.frames.map((f) => f.height));
  return { kind: 'indexed', width, height, flags: 0, palette, subImages: picture.frames, appData: null, anomalies: 0 };
}

export class UiAssets implements ImageCatalog {
  readonly #renderer: UiRenderer;
  readonly #source: AssetSource;
  readonly #cache: AssetCache;
  readonly #images = new Map<AssetKey, ImageInfo>();
  readonly #fonts = new Map<FontId, BitmapFont>();
  readonly #failed = new Set<AssetKey>();

  constructor(renderer: UiRenderer, source: AssetSource, cache: AssetCache) {
    this.#renderer = renderer;
    this.#source = source;
    this.#cache = cache;
  }

  get source(): AssetSource {
    return this.#source;
  }

  get images(): ReadonlySet<AssetKey> {
    return new Set(this.#images.keys());
  }

  get fonts(): ReadonlyMap<FontId, BitmapFont> {
    return this.#fonts;
  }

  get missing(): readonly AssetKey[] {
    return [...this.#failed];
  }

  info(key: AssetKey): ImageInfo | undefined {
    return this.#images.get(key);
  }

  async text(path: string): Promise<string | null> {
    const bytes = await this.#source.readOptional(path);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  async json(path: string): Promise<unknown> {
    const text = await this.text(path);
    if (text === null) throw new Error(`missing ${path}`);
    return JSON.parse(text);
  }

  async glyphTable(path: string): Promise<GlyphTable> {
    return parseGlyphTable(await this.json(path));
  }

  async image(key: AssetKey): Promise<boolean> {
    if (this.#images.has(key)) return true;
    if (this.#source.resolve(key) === undefined) {
      this.#failed.add(key);
      return false;
    }
    const sti = key.toLowerCase().endsWith(PCX_EXTENSION)
      ? await loadDecodedAsset(this.#source, this.#cache, key, PCX_DECODER)
      : await loadDecodedAsset(this.#source, this.#cache, key, STI_DECODER);
    this.#renderer.addImage(key, sti);
    this.#images.set(key, imageInfo(sti));
    return true;
  }

  addPicture(key: AssetKey, picture: IndexedPicture, palette: Uint8Array): void {
    if (this.#images.has(key)) return;
    const sti = pictureAsSti(picture, palette);
    this.#renderer.addImage(key, sti);
    this.#images.set(key, imageInfo(sti));
  }

  addRgb(key: AssetKey, width: number, height: number, pixels: Uint16Array): void {
    if (this.#images.has(key)) return;
    const sti: StiRgb = { kind: 'rgb', width, height, flags: 0, pixels };
    this.#renderer.addImage(key, sti);
    this.#images.set(key, imageInfo(sti));
  }

  async font(id: FontId, table: GlyphTable): Promise<BitmapFont | null> {
    const known = this.#fonts.get(id);
    if (known) return known;
    const path = fontPath(id);
    if (this.#source.resolve(path) === undefined) return null;
    const sti = await loadDecodedAsset(this.#source, this.#cache, path, STI_DECODER);
    this.#renderer.addFont(id, sti);
    const font = bitmapFontFromSti(id, sti, table);
    this.#fonts.set(id, font);
    return font;
  }

  fontSet(files: FontFiles): FontSet {
    return new FontSet(files, this.#fonts);
  }

  async preload(
    images: readonly AssetKey[],
    fonts: readonly FontId[],
    glyphTablePath: string,
    onProgress?: (progress: PreloadProgress) => void,
  ): Promise<void> {
    const paths = [...images, ...fonts.map(fontPath)];
    await preloadAssets(this.#source, paths, { cache: this.#cache, ...(onProgress ? { onProgress } : {}) });
    const table = await this.glyphTable(glyphTablePath);
    await Promise.all([...images.map((key) => this.image(key)), ...fonts.map((id) => this.font(id, table))]);
  }
}
