import type { IndexedPicture } from '../../content/picture/picture.ts';
import { SHADE_LEVEL_COUNT, shadedDisplayPalette } from '../../content/world/shading.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { ArrayAtlas, type ArrayRegion } from '../array-atlas.ts';
import { PaletteRows } from '../palette-rows.ts';
import type { SoldierSprite } from './dynamic-scene.ts';
import { type LightColour, NO_LIGHT_COLOUR, soldierPaletteRows } from './soldier-palettes.ts';
import type { TileSprite } from './static-scene.ts';

export interface TileSurfacePicture {
  readonly picture: IndexedPicture;
}

interface SurfaceSprites {
  readonly paletteBase: number;
  readonly regions: readonly ArrayRegion[];
  readonly picture: IndexedPicture;
}

export interface LoadedSoldierSheet {
  readonly regions: readonly ArrayRegion[];
  readonly picture: IndexedPicture;
}

export class WorldSprites {
  readonly atlas: ArrayAtlas;
  readonly palettes: PaletteRows;
  readonly #tiles: readonly TileElement[];
  readonly #surfaces: readonly (SurfaceSprites | null)[];
  readonly #tileSprites: (TileSprite | null | undefined)[];
  readonly #sheets = new Map<string, LoadedSoldierSheet>();
  readonly #soldierPalettes = new Map<string, number>();
  readonly #light: LightColour;

  constructor(
    gl: WebGL2RenderingContext,
    tiles: readonly TileElement[],
    surfaces: readonly (TileSurfacePicture | null)[],
    light: LightColour = NO_LIGHT_COLOUR,
  ) {
    this.atlas = new ArrayAtlas(gl);
    this.palettes = new PaletteRows(gl);
    this.#tiles = tiles;
    this.#light = light;
    this.#tileSprites = new Array<TileSprite | null | undefined>(tiles.length);
    this.#surfaces = surfaces.map((s) => {
      if (!s) return null;
      let paletteBase = -1;
      for (let shade = 0; shade < SHADE_LEVEL_COUNT; shade++) {
        const row = this.palettes.add(shadedDisplayPalette(s.picture.palette, shade, light));
        if (shade === 0) paletteBase = row;
      }
      return { paletteBase, picture: s.picture, regions: s.picture.frames.map((f) => this.atlas.add(f.width, f.height, f.pixels)) };
    });
  }

  tileSprite(tile: number): TileSprite | null {
    const cached = this.#tileSprites[tile];
    if (cached !== undefined) return cached;
    const sprite = this.#resolveTile(tile);
    this.#tileSprites[tile] = sprite;
    return sprite;
  }

  #resolveTile(tile: number): TileSprite | null {
    const te = this.#tiles[tile];
    const surface = te ? this.#surfaces[te.type] : null;
    if (!te || !surface) return null;
    const region = surface.regions[te.regionIndex];
    const frame = surface.picture.frames[te.regionIndex];
    if (!region || !frame) return null;
    return { ...region, offsetX: frame.offsetX, offsetY: frame.offsetY, paletteBase: surface.paletteBase };
  }

  sheet(id: string): LoadedSoldierSheet | undefined {
    return this.#sheets.get(id);
  }

  addSheet(id: string, picture: IndexedPicture): LoadedSoldierSheet {
    const existing = this.#sheets.get(id);
    if (existing) return existing;
    const loaded = { picture, regions: picture.frames.map((f) => this.atlas.add(f.width, f.height, f.pixels)) };
    this.#sheets.set(id, loaded);
    return loaded;
  }

  soldierFrame(sheet: LoadedSoldierSheet, index: number): SoldierSprite | null {
    const region = sheet.regions[index];
    const frame = sheet.picture.frames[index];
    return region && frame ? { ...region, offsetX: frame.offsetX, offsetY: frame.offsetY, pixels: frame.pixels } : null;
  }

  soldierPaletteBase(key: string, palette: () => Uint8Array): number {
    const cached = this.#soldierPalettes.get(key);
    if (cached !== undefined) return cached;
    let first = -1;
    for (const row of soldierPaletteRows(palette(), this.#light)) {
      const index = this.palettes.add(row);
      if (first < 0) first = index;
    }
    this.#soldierPalettes.set(key, first);
    return first;
  }

  dispose(): void {
    this.atlas.dispose();
    this.palettes.dispose();
    this.#sheets.clear();
    this.#soldierPalettes.clear();
  }
}
