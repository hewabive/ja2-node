import { SHADOW_FACTOR } from '../../content/world/shading.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { IndexFilter, type SpriteRenderer } from '../sprite-renderer.ts';
import type { DrawItem } from './scene.ts';
import type { SoldierSprites } from './soldier-sprites.ts';
import type { TileAtlas } from './tile-atlas.ts';

function drawMerc(renderer: SpriteRenderer, sprites: SoldierSprites, item: DrawItem, scale: number): void {
  const merc = item.merc;
  const spec = merc ? sprites.spec(merc.key) : undefined;
  if (!merc || !spec) return;
  renderer.draw(sprites.atlas, spec.region, item.x * scale, item.y * scale, {
    scale,
    paletteRow: spec.paletteRowBase + item.shade,
    palettes: sprites.palettes,
    z: item.z,
    depthMode: item.depthMode,
    indexFilter: merc.part === 'shadow' ? IndexFilter.ONLY_SHADOW : IndexFilter.EXCEPT_SHADOW,
    ...(merc.part === 'shadow' ? { shadowFactor: SHADOW_FACTOR } : {}),
    ...(merc.part === 'obscured' ? { checkerScale: scale } : {}),
  });
}

export function drawScene(
  renderer: SpriteRenderer,
  atlas: TileAtlas,
  tiles: readonly TileElement[],
  items: readonly DrawItem[],
  scale: number,
  sprites: SoldierSprites | null = null,
): void {
  for (const item of items) {
    if (item.merc) {
      if (sprites) drawMerc(renderer, sprites, item, scale);
      continue;
    }
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
