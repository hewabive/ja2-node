// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Bullets.cc UpdateBullets (BULLETTILE1 at the bullet's height and BULLETTILE2 at the land height
// @src of its tile, both struct nodes at an absolute position that ignore the tile height); src/game/TileEngine/Physics.cc
// @src PhysicsMoveObject (a thrown object's item tile as a physics struct node at its height, and the same tile in the
// @src shadow layer at the land height).

import { CELL_X_SIZE, CELL_Y_SIZE, WORLD_COLS } from '../../content/world/grid.ts';
import type { TileTables } from '../../content/world/tile-tables.ts';
import { idiv } from '../../core/int.ts';
import type { BulletView } from '../../protocol/view.ts';
import type { StructNode } from '../../render/world/dynamic-scene.ts';

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
  return idiv(b.y, CELL_Y_SIZE) * WORLD_COLS + idiv(b.x, CELL_X_SIZE);
}

export function thrownNodes(b: BulletView, tile: number, landHeights: Uint8Array): StructNode[] {
  const gridNo = bulletGridNo(b);
  const absolute = { x: b.x, y: b.y };
  return [
    { gridNo, tile, absolute, relativeZ: b.z, animation: true },
    { gridNo, tile, absolute, relativeZ: landHeights[gridNo] ?? 0, animation: false, inShadowLayer: true },
  ];
}

export function bulletNodes(bullets: readonly BulletView[], tiles: BulletTiles, landHeights: Uint8Array): StructNode[] {
  return bullets.flatMap((b) => {
    const gridNo = bulletGridNo(b);
    const absolute = { x: b.x, y: b.y };
    return [
      { gridNo, tile: tiles.bullet, absolute, relativeZ: b.z, animation: false },
      { gridNo, tile: tiles.shadow, absolute, relativeZ: landHeights[gridNo] ?? 0, animation: false },
    ];
  });
}
