import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLD_COLS } from '../world/grid.ts';
import { parseTileTables } from '../world/tile-tables.ts';
import { MapFlags, parseMap, writeMap } from './map.ts';
import { parseDetailedPlacement } from './placement.ts';
import { parseStubMapSource, stubMapToMapDef } from './stub-map.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));

const SOURCE = `ja2-node.map/1
name: Test
tileset: 0
origin: 10 20
fill: land FIRSTTEXTURE 1
legend '.': land FIRSTTEXTURE 1
entry: north 2 0
entry: west 0 1
exit: 1 1 -> A10 z=1 at 40 50
soldier: ENEMY 1 2 NORTH ONGUARD AGGRESSIVE ELITE
soldier: ENEMY 2 2 NORTH ONGUARD AGGRESSIVE ADMINISTRATOR optional
soldier: CIV 3 2 EAST STATIONARY DEFENSIVE NONE profile=91
map:
....
....
....
`;

describe('stub map entries, exits and placements', () => {
  it('writes entry points, exit grids and priority flags that survive the map round trip', () => {
    const map = parseMap(writeMap(stubMapToMapDef(parseStubMapSource(SOURCE, tables))));
    const g = (x: number, y: number) => (20 + y) * WORLD_COLS + 10 + x;
    expect(map.info.northGridNo).toBe(g(2, 0));
    expect(map.info.westGridNo).toBe(g(0, 1));
    expect(map.info.southGridNo).toBe(-1);
    expect(map.flags & MapFlags.EXIT_GRIDS).not.toBe(0);
    expect(map.exitGrids).toEqual([{ mapIndex: g(1, 1), gridNo: 50 * WORLD_COLS + 40, sector: { x: 10, y: 1, z: 1 } }]);
    expect(map.placements.map((p) => [p.basic.soldierClass, p.basic.priorityExistence, p.basic.detailed])).toEqual([
      [2, true, false],
      [1, false, false],
      [0, true, true],
    ]);
  });

  it('writes a detailed placement with the profile for a profile= soldier', () => {
    const map = parseMap(writeMap(stubMapToMapDef(parseStubMapSource(SOURCE, tables))));
    const raw = map.placements[2]?.detailedRaw;
    if (!raw) throw new Error('no detailed placement');
    const detail = parseDetailedPlacement(raw);
    const g = 22 * WORLD_COLS + 13;
    expect(detail).toMatchObject({ isStatic: true, profile: 91, team: 4, direction: 2, insertionGridNo: g, orders: 0, attitude: 0 });
    expect(detail.stats.life).toBe(-1);
    expect(() => parseStubMapSource(SOURCE.replace('profile=91', 'profile=x'), tables)).toThrow(/unknown soldier flag/);
  });
});
