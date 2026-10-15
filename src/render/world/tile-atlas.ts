import { SHADE_LEVEL_COUNT, shadedDisplayPalette } from '../../content/world/shading.ts';
import type { LoadedTileSurface } from '../../content/world/tileset-loader.ts';
import { type AtlasRegion, TextureAtlas } from '../atlas.ts';
import { PaletteTexture } from '../palettes.ts';

export interface SurfaceSprites {
  readonly firstPaletteRow: number;
  readonly regions: readonly AtlasRegion[];
}

export class TileAtlas {
  readonly atlas: TextureAtlas;
  readonly palettes: PaletteTexture;
  readonly surfaces: readonly (SurfaceSprites | null)[];

  constructor(gl: WebGL2RenderingContext, surfaces: readonly (LoadedTileSurface | null)[]) {
    this.atlas = new TextureAtlas(gl, 'index');
    this.palettes = new PaletteTexture(gl, Math.max(1, surfaces.length * SHADE_LEVEL_COUNT));
    this.surfaces = surfaces.map((s) => {
      if (!s) return null;
      let firstPaletteRow = -1;
      for (let shade = 0; shade < SHADE_LEVEL_COUNT; shade++) {
        const row = this.palettes.add(shadedDisplayPalette(s.picture.palette, shade));
        if (shade === 0) firstPaletteRow = row;
      }
      return { firstPaletteRow, regions: s.picture.frames.map((f) => this.atlas.add(f.width, f.height, f.pixels)) };
    });
  }

  dispose(): void {
    this.atlas.clear();
  }
}
