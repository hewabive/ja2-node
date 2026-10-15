import { SHADOW_FACTOR } from '../../content/world/shading.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import type { SpriteRenderer } from '../sprite-renderer.ts';
import type { DrawItem } from './scene.ts';
import type { TileAtlas } from './tile-atlas.ts';

export function drawScene(
  renderer: SpriteRenderer,
  atlas: TileAtlas,
  tiles: readonly TileElement[],
  items: readonly DrawItem[],
  scale: number,
): void {
  for (const item of items) {
    const te = tiles[item.tile];
    if (!te) continue;
    const surface = atlas.surfaces[te.type];
    const region = surface?.regions[te.regionIndex];
    if (!surface || !region) continue;
    renderer.draw(atlas.atlas, region, item.x * scale, item.y * scale, {
      scale,
      paletteRow: surface.firstPaletteRow + item.shade,
      z: item.z,
      depthMode: item.depthMode,
      srcX: item.srcX,
      srcWidth: item.srcWidth,
      ...(item.shadow ? { shadowFactor: SHADOW_FACTOR } : {}),
    });
  }
}
