import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { type Level, levelTilesAt } from '../../content/world/level.ts';
import { layerWith } from '../../content/world/synthetic.ts';
import { parseTileTables, tileIndex, tileTypeOf, typeIndex } from '../../content/world/tile-tables.ts';
import { applyBloodPools, applyTileChanges, tileChangesKey } from './tile-changes.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));

const WINDOW = 1000;
const WALL = 900;
const AT = 12880;

const DEBRIS = tileIndex(tables, 'DEBRISROCKS1');
const OLD_POOL = tileIndex(tables, 'HUMANBLOOD5');
const POOLS_PER_VARIANT = 4;

function level(): Level {
  const structs = layerWith((g) => (g === AT ? [WALL, WINDOW, 950] : []));
  const objects = layerWith((g) => (g === AT ? [DEBRIS, OLD_POOL] : []));
  const empty = layerWith(() => []);
  return {
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers: { land: empty, objects, structs, shadows: empty, roofs: empty, onRoof: empty, topmost: empty },
  } as Level;
}

function poolSize(tile: number): number {
  return (tile - tableStart(tileTypeOf(tables, tile))) % POOLS_PER_VARIANT;
}

function tableStart(type: number): number {
  return tables.types[type]?.start ?? -1;
}

describe('tile changes', () => {
  it('keeps the place of a swapped structure, adds plain additions at the head and drops removals', () => {
    const swapped = applyTileChanges(level(), [
      { kind: 'remove', gridNo: AT, level: 0, tile: WINDOW },
      { kind: 'add', gridNo: AT, level: 0, tile: WINDOW + 1 },
    ]);
    expect([...levelTilesAt(swapped.layers.structs, AT)]).toEqual([WALL, WINDOW + 1, 950]);
    const added = applyTileChanges(level(), [{ kind: 'add', gridNo: AT + 1, level: 1, tile: 77 }]);
    expect([...levelTilesAt(added.layers.onRoof, AT + 1)]).toEqual([77]);
    const removed = applyTileChanges(level(), [{ kind: 'remove', gridNo: AT, level: 1, tile: WALL }]);
    expect([...levelTilesAt(removed.layers.structs, AT)]).toEqual([WINDOW, 950]);
  });

  it('returns the same level when nothing changed and keys a change list by its content', () => {
    const l = level();
    expect(applyTileChanges(l, [])).toBe(l);
    expect(tileChangesKey([{ kind: 'add', gridNo: 5, level: 0, tile: 7 }])).toBe('a5.0.7');
  });
});

describe('blood pools (Smell.cc UpdateBloodGraphics)', () => {
  it('replaces the first blood object of a tile with the pool at the head of its objects, sized by strength', () => {
    const big = applyBloodPools(level(), tables, [{ gridNo: AT, strength: 7 }]);
    const [pool, ...rest] = levelTilesAt(big.layers.objects, AT);
    expect(rest).toEqual([DEBRIS]);
    expect(tileTypeOf(tables, pool ?? -1)).toBe(typeIndex(tables, 'HUMANBLOOD'));
    expect(poolSize(pool ?? -1)).toBe(0);
    const small = applyBloodPools(level(), tables, [{ gridNo: AT + 1, strength: 1, creature: true }]);
    const [creaturePool] = levelTilesAt(small.layers.objects, AT + 1);
    expect(tileTypeOf(tables, creaturePool ?? -1)).toBe(typeIndex(tables, 'CREATUREBLOOD'));
    expect(poolSize(creaturePool ?? -1)).toBe(POOLS_PER_VARIANT - 1);
  });

  it('takes away the blood object of a tile whose pool is gone and leaves the level alone without pools', () => {
    const l = level();
    expect([...levelTilesAt(applyBloodPools(l, tables, [{ gridNo: AT, strength: 0 }]).layers.objects, AT)]).toEqual([DEBRIS]);
    expect(applyBloodPools(l, tables, [])).toBe(l);
  });
});
