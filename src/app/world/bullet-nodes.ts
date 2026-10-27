// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Bullets.cc UpdateBullets (BULLETTILE1 at the bullet's height and BULLETTILE2 at the land height
// @src of its tile, both struct nodes at an absolute position that ignore the tile height).

import { CELL_X_SIZE, CELL_Y_SIZE, WORLD_COLS } from '../../content/world/grid.ts';
import type { TileTables } from '../../content/world/tile-tables.ts';
import type { BulletView } from '../../protocol/view.ts';
import type { AbsoluteNode } from '../../render/world/dynamic-scene.ts';

export interface BulletTiles {
  readonly bullet: number;
  readonly shadow: number;
}

export function bulletTiles(tables: TileTables): BulletTiles | null {
  const bullet = tables.tileIndexByName.get('BULLETTILE1');
  const shadow = tables.tileIndexByName.get('BULLETTILE2');
  return bullet === undefined || shadow === undefined ? null : { bullet, shadow };
}

export function bulletGridNo(b: BulletView): number {
  return Math.trunc(b.y / CELL_Y_SIZE) * WORLD_COLS + Math.trunc(b.x / CELL_X_SIZE);
}

export function bulletNodes(bullets: readonly BulletView[], tiles: BulletTiles, landHeights: Uint8Array): AbsoluteNode[] {
  return bullets.flatMap((b) => {
    const gridNo = bulletGridNo(b);
    return [
      { gridNo, tile: tiles.bullet, x: b.x, y: b.y, z: b.z },
      { gridNo, tile: tiles.shadow, x: b.x, y: b.y, z: landHeights[gridNo] ?? 0 },
    ];
  });
}
