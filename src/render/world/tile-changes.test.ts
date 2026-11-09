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
      { kind: 'swap', gridNo: AT, level: 0, tile: WINDOW + 1 },
    ]);
    expect([...levelTilesAt(swapped.layers.structs, AT)]).toEqual([WALL, WINDOW + 1, 950]);
    const replaced = applyTileChanges(level(), [
      { kind: 'remove', gridNo: AT, level: 0, tile: WINDOW },
      { kind: 'add', gridNo: AT, level: 0, tile: WINDOW + 1 },
    ]);
    expect([...levelTilesAt(replaced.layers.structs, AT)]).toEqual([WINDOW + 1, WALL, 950]);
    const added = applyTileChanges(level(), [{ kind: 'add', gridNo: AT + 1, level: 1, tile: 77 }]);
    expect([...levelTilesAt(added.layers.onRoof, AT + 1)]).toEqual([77]);
    const removed = applyTileChanges(level(), [{ kind: 'remove', gridNo: AT, level: 1, tile: WALL }]);
    expect([...levelTilesAt(removed.layers.structs, AT)]).toEqual([WINDOW, 950]);
  });

  it('appends the pieces of the landed helicopter at the tail of the structure layer, in their order', () => {
    const landed = applyTileChanges(level(), [
      { kind: 'append', gridNo: AT, level: 0, tile: 399 },
      { kind: 'append', gridNo: AT, level: 0, tile: 400 },
      { kind: 'append', gridNo: AT - 800, level: 0, tile: 401 },
    ]);
    expect([...levelTilesAt(landed.layers.structs, AT)]).toEqual([WALL, WINDOW, 950, 399, 400]);
    expect([...levelTilesAt(landed.layers.structs, AT - 800)]).toEqual([401]);
  });

  it("puts a destroyed structure's debris at the head of the tile's object layer, later debris first, and leaves the structures alone", () => {
    const first = tileIndex(tables, 'FIRSTEXPLDEBRIS4');
    const second = tileIndex(tables, 'SECONDEXPLDEBRIS2');
    const wrecked = applyTileChanges(level(), [
      { kind: 'object', gridNo: AT, level: 0, tile: first },
      { kind: 'object', gridNo: AT, level: 0, tile: second },
    ]);
    expect([...levelTilesAt(wrecked.layers.objects, AT)]).toEqual([second, first, DEBRIS, OLD_POOL]);
    expect([...levelTilesAt(wrecked.layers.structs, AT)]).toEqual([WALL, WINDOW, 950]);
    expect(tileChangesKey([{ kind: 'object', gridNo: 5, level: 0, tile: 7 }])).toBe('o5.0.7');
  });

  it("puts a pit's texture at the tail of the tile's object layer, after the map's objects (WorldMan.cc AddObjectToTail)", () => {
    const pit = tileIndex(tables, 'REGWATERTEXTURE5');
    const opened = applyTileChanges(level(), [{ kind: 'appendObject', gridNo: AT, level: 0, tile: pit }]);
    expect([...levelTilesAt(opened.layers.objects, AT)]).toEqual([DEBRIS, OLD_POOL, pit]);
    expect(tileChangesKey([{ kind: 'appendObject', gridNo: 5, level: 0, tile: 7 }])).not.toBe('o5.0.7');
  });

  it('returns the same level when nothing changed and keys a change list by its content', () => {
    const l = level();
    expect(applyTileChanges(l, [])).toBe(l);
    expect(tileChangesKey([{ kind: 'add', gridNo: 5, level: 0, tile: 7 }])).toBe('a5.0.7');
    expect(tileChangesKey([{ kind: 'append', gridNo: 5, level: 0, tile: 7 }])).not.toBe('a5.0.7');
    expect(tileChangesKey([{ kind: 'swap', gridNo: 5, level: 0, tile: 7 }])).not.toBe('a5.0.7');
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

  it('leaves the level alone without pools', () => {
    const l = level();
    expect(applyBloodPools(l, tables, [])).toBe(l);
  });
});
