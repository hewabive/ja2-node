import type { SheetLayout } from '../../content/anim/soldier-sprite.ts';
import type { IndexedPicture } from '../../content/picture/picture.ts';
import { SHADE_LEVEL_COUNT, shadedDisplayPalette } from '../../content/world/shading.ts';
import { type AtlasRegion, TextureAtlas } from '../atlas.ts';
import { PaletteTexture } from '../palettes.ts';

export interface SoldierSheet {
  readonly picture: IndexedPicture;
  readonly layout: SheetLayout;
}

export interface LoadedSheet {
  readonly regions: readonly AtlasRegion[];
  readonly picture: IndexedPicture;
  readonly layout: SheetLayout;
}

export interface MercDrawSpec {
  readonly region: AtlasRegion;
  readonly paletteRowBase: number;
}

const MAX_PALETTE_ROWS = 2048;

export class SoldierSprites {
  readonly atlas: TextureAtlas;
  readonly palettes: PaletteTexture;
  readonly #sheets = new Map<string, LoadedSheet>();
  readonly #paletteRows = new Map<string, number>();
  #specs: MercDrawSpec[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.atlas = new TextureAtlas(gl, 'index');
    this.palettes = new PaletteTexture(gl, MAX_PALETTE_ROWS);
  }

  sheet(id: string): LoadedSheet | undefined {
    return this.#sheets.get(id);
  }

  addSheet(id: string, sheet: SoldierSheet): LoadedSheet {
    const existing = this.#sheets.get(id);
    if (existing) return existing;
    const loaded = { ...sheet, regions: sheet.picture.frames.map((f) => this.atlas.add(f.width, f.height, f.pixels)) };
    this.#sheets.set(id, loaded);
    return loaded;
  }

  paletteRowBase(key: string, palette: () => Uint8Array): number {
    const cached = this.#paletteRows.get(key);
    if (cached !== undefined) return cached;
    const rgb = palette();
    let first = -1;
    for (let shade = 0; shade < SHADE_LEVEL_COUNT; shade++) {
      const row = this.palettes.add(shadedDisplayPalette(rgb, shade));
      if (shade === 0) first = row;
    }
    this.#paletteRows.set(key, first);
    return first;
  }

  beginFrame(): void {
    this.#specs = [];
  }

  addSpec(spec: MercDrawSpec): number {
    this.#specs.push(spec);
    return this.#specs.length - 1;
  }

  spec(key: number): MercDrawSpec | undefined {
    return this.#specs[key];
  }

  dispose(): void {
    this.atlas.clear();
    this.palettes.clear();
    this.#sheets.clear();
    this.#paletteRows.clear();
  }
}
