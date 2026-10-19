import type { Sti, StiIndexed } from '../../content/formats/sti.ts';
import { shadedPalette } from '../../content/picture/shaded-palette.ts';
import type { AssetKey, FontId, PaletteShade } from '../../ui/draw-list.ts';
import { type AtlasRegion, TextureAtlas } from '../atlas.ts';
import { PaletteTexture } from '../palettes.ts';

export interface UiFrame {
  readonly region: AtlasRegion;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface IndexedUiImage {
  readonly kind: 'indexed';
  readonly palette: Uint8Array;
  readonly frames: readonly UiFrame[];
  readonly rows: Map<string, number>;
}

export interface RgbUiImage {
  readonly kind: 'rgb';
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

export type UiImage = IndexedUiImage | RgbUiImage;

export interface UiFont {
  readonly palette: Uint8Array;
  readonly glyphs: readonly UiFrame[];
}

const BASE_ROW = 'base';

function shadeKey(shade: PaletteShade | null): string {
  return shade ? `${shade.red},${shade.green},${shade.blue},${shade.mono ? 1 : 0}` : BASE_ROW;
}

export class UiTextures {
  readonly atlas: TextureAtlas;
  readonly palettes: PaletteTexture;
  readonly #gl: WebGL2RenderingContext;
  readonly #images = new Map<AssetKey, UiImage>();
  readonly #fonts = new Map<FontId, UiFont>();

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.atlas = new TextureAtlas(gl, 'index');
    this.palettes = new PaletteTexture(gl);
  }

  #frames(sti: StiIndexed): UiFrame[] {
    return sti.subImages.map((s) => ({ region: this.atlas.add(s.width, s.height, s.pixels), offsetX: s.offsetX, offsetY: s.offsetY }));
  }

  #rgbTexture(width: number, height: number, pixels: Uint16Array): WebGLTexture {
    const gl = this.#gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB565, width, height);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, pixels);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  addImage(key: AssetKey, sti: Sti): void {
    if (this.#images.has(key)) return;
    if (sti.kind === 'rgb') {
      this.#images.set(key, {
        kind: 'rgb',
        texture: this.#rgbTexture(sti.width, sti.height, sti.pixels),
        width: sti.width,
        height: sti.height,
      });
      return;
    }
    this.#images.set(key, { kind: 'indexed', palette: sti.palette, frames: this.#frames(sti), rows: new Map() });
  }

  addFont(id: FontId, sti: Sti): void {
    if (this.#fonts.has(id)) return;
    if (sti.kind !== 'indexed') throw new Error(`font ${id} is not an indexed STI`);
    this.#fonts.set(id, { palette: sti.palette, glyphs: this.#frames(sti) });
  }

  image(key: AssetKey): UiImage | undefined {
    return this.#images.get(key);
  }

  font(id: FontId): UiFont | undefined {
    return this.#fonts.get(id);
  }

  paletteRow(image: IndexedUiImage, shade: PaletteShade | null): number {
    const key = shadeKey(shade);
    let row = image.rows.get(key);
    if (row === undefined) {
      row = this.palettes.add(shade ? shadedPalette(image.palette, shade) : image.palette);
      image.rows.set(key, row);
    }
    return row;
  }

  clear(): void {
    for (const image of this.#images.values()) if (image.kind === 'rgb') this.#gl.deleteTexture(image.texture);
    this.#images.clear();
    this.#fonts.clear();
    this.atlas.clear();
    this.palettes.clear();
  }
}
