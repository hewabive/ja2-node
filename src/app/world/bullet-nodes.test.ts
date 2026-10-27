import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gridNo, WORLD_MAX } from '../../content/world/grid.ts';
import { parseTileTables, tileIndex } from '../../content/world/tile-tables.ts';
import { bulletNodes, bulletTiles } from './bullet-nodes.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));

describe('bullet nodes', () => {
  it('draws the bullet at its height and its shadow at the land height of the tile it is over', () => {
    const tiles = bulletTiles(tables);
    expect(tiles).toEqual({ bullet: tileIndex(tables, 'BULLETTILE1'), shadow: tileIndex(tables, 'BULLETTILE2') });
    if (!tiles) return;
    const heights = new Uint8Array(WORLD_MAX);
    const under = gridNo(80, 71);
    heights[under] = 12;
    const absolute = { x: 809, y: 710 };
    expect(bulletNodes([{ x: 809, y: 710, z: 45 }], tiles, heights)).toEqual([
      { gridNo: under, tile: tiles.bullet, absolute, relativeZ: 45, animation: false },
      { gridNo: under, tile: tiles.shadow, absolute, relativeZ: 12, animation: false },
    ]);
  });
});
