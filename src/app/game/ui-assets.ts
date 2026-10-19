import { decodeSti } from '../../content/formats/sti.ts';
import { type GlyphTable, parseGlyphTable } from '../../content/text/glyph-table.ts';
import type { UiRenderer } from '../../render/ui-draw/ui-renderer.ts';
import type { AssetKey, FontId } from '../../ui/draw-list.ts';
import { type BitmapFont, bitmapFontFromSti, fontPath } from '../../ui/text/bitmap-font.ts';
import { fetchOptionalVfsFile } from '../net/vfs.ts';

export type ReadOptionalFile = (path: string) => Promise<Uint8Array | null>;

export class UiAssets {
  readonly #renderer: UiRenderer;
  readonly #read: ReadOptionalFile;
  readonly #images = new Set<AssetKey>();
  readonly #fonts = new Map<FontId, BitmapFont>();

  constructor(renderer: UiRenderer, read: ReadOptionalFile = fetchOptionalVfsFile) {
    this.#renderer = renderer;
    this.#read = read;
  }

  get images(): ReadonlySet<AssetKey> {
    return this.#images;
  }

  get fonts(): ReadonlyMap<FontId, BitmapFont> {
    return this.#fonts;
  }

  async glyphTable(path: string): Promise<GlyphTable> {
    const bytes = await this.#read(path);
    if (!bytes) throw new Error(`no glyph table at ${path}`);
    return parseGlyphTable(JSON.parse(new TextDecoder().decode(bytes)));
  }

  async image(key: AssetKey): Promise<boolean> {
    if (this.#images.has(key)) return true;
    const bytes = await this.#read(key);
    if (!bytes) return false;
    this.#renderer.addImage(key, decodeSti(bytes));
    this.#images.add(key);
    return true;
  }

  async font(id: FontId, table: GlyphTable): Promise<BitmapFont | null> {
    const known = this.#fonts.get(id);
    if (known) return known;
    const bytes = await this.#read(fontPath(id));
    if (!bytes) return null;
    const sti = decodeSti(bytes);
    this.#renderer.addFont(id, sti);
    const font = bitmapFontFromSti(id, sti, table);
    this.#fonts.set(id, font);
    return font;
  }

  async preload(images: readonly AssetKey[], fonts: readonly FontId[], glyphTablePath: string): Promise<void> {
    const table = await this.glyphTable(glyphTablePath);
    await Promise.all([...images.map((key) => this.image(key)), ...fonts.map((id) => this.font(id, table))]);
  }
}
