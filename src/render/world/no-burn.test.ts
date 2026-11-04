import { describe, expect, it } from 'vitest';
import { Orientation, type StructureDef } from '../../content/formats/jsd.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import type { Level } from '../../content/world/level.ts';
import { placeWorldStructures } from '../../content/world/placement.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { layerWith, syntheticStructure } from '../../content/world/synthetic.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { loadedNoBurn, noBurnAfterChanges } from './no-burn.ts';
import type { TileChange } from './tile-changes.ts';

const WALL = 1;
const CRATE = 2;
const CART = 3;
const WALL_REACHING_WEST = 4;
const WALL_REACHING_EAST = 5;

const DEFS: readonly (StructureDef | null)[] = [
  null,
  syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT),
  syntheticStructure(StructureFlags.GENERIC),
  syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, {
    tiles: [
      [0, 0],
      [0, -1],
    ],
  }),
  syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT, {
    tiles: [
      [0, 0],
      [-1, 0],
    ],
  }),
  syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT, {
    tiles: [
      [0, 0],
      [1, 0],
    ],
  }),
];
const TILES = DEFS.map((structure, index) => ({ index, structure, structureFile: null }) as unknown as TileElement);

const AT = 12880;

function levelWith(structs: ReadonlyMap<number, readonly number[]>): Level {
  const empty = layerWith(() => []);
  return {
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers: {
      land: empty,
      objects: empty,
      structs: layerWith((g) => structs.get(g) ?? []),
      shadows: empty,
      roofs: empty,
      onRoof: empty,
      topmost: empty,
    },
  } as Level;
}

function afterChanges(structs: ReadonlyMap<number, readonly number[]>, changes: readonly TileChange[]): Uint8Array {
  const placed = placeWorldStructures(levelWith(structs), TILES);
  return noBurnAfterChanges(loadedNoBurn(placed.level, TILES), placed.structures, TILES, changes);
}

const change = (kind: TileChange['kind'], tile: number, gridNo = AT): TileChange => ({ kind, gridNo, level: 0, tile });

describe('no-burn tiles (WorldMan.cc AddStructToTailCommon, AddStructToHead)', () => {
  it('flags a tile whose last loaded structure is a single tile with no wall standing on the tile', () => {
    const noBurn = loadedNoBurn(
      levelWith(
        new Map([
          [AT, [CRATE]],
          [AT + 2, [WALL, CRATE]],
          [AT + 4, [CRATE, WALL]],
          [AT + 6, [CART]],
          [AT + 8, [CART, CRATE]],
        ]),
      ),
      TILES,
    );
    expect([AT, AT + 2, AT + 4, AT + 6, AT + 8].map((g) => noBurn[g])).toEqual([1, 0, 0, 0, 1]);
  });

  it('counts at load only the wall pieces of structures loaded before the tile, so a wall based east of it does not count', () => {
    const fromWest = loadedNoBurn(
      levelWith(
        new Map([
          [AT - 1, [WALL_REACHING_EAST]],
          [AT, [CRATE]],
        ]),
      ),
      TILES,
    );
    const fromEast = loadedNoBurn(
      levelWith(
        new Map([
          [AT, [CRATE]],
          [AT + 1, [WALL_REACHING_WEST]],
        ]),
      ),
      TILES,
    );
    expect(fromWest[AT]).toBe(0);
    expect(fromEast[AT]).toBe(1);
  });

  it('inverts the wall test for a structure added at the head: it flags the tile only where a wall stands', () => {
    const map = new Map([
      [AT, [WALL]],
      [AT + 2, []],
    ]);
    const noBurn = afterChanges(map, [change('add', CRATE), change('add', CRATE, AT + 2)]);
    expect(noBurn[AT]).toBe(1);
    expect(noBurn[AT + 2]).toBe(0);
  });

  it('gives a structure appended at the tail the load rule', () => {
    const map = new Map([[AT, [WALL]]]);
    const noBurn = afterChanges(map, [change('append', CRATE), change('append', CRATE, AT + 2), change('append', CART, AT + 4)]);
    expect([noBurn[AT], noBurn[AT + 2], noBurn[AT + 4]]).toEqual([0, 1, 0]);
  });

  it('keeps the flag through removals and partner swaps', () => {
    const map = new Map([
      [AT, [CRATE]],
      [AT + 2, [CRATE, WALL]],
    ]);
    const noBurn = afterChanges(map, [change('remove', CRATE), change('remove', WALL, AT + 2), change('swap', CRATE, AT + 2)]);
    expect(noBurn[AT]).toBe(1);
    expect(noBurn[AT + 2]).toBe(0);
  });

  it('sees the wall pieces of structures based on other tiles, as they stand when the structure is added', () => {
    const map = new Map([[AT + 1, [WALL_REACHING_WEST]]]);
    expect(afterChanges(map, [change('add', CRATE)])[AT]).toBe(1);
    expect(afterChanges(map, [change('remove', WALL_REACHING_WEST, AT + 1), change('add', CRATE)])[AT]).toBe(0);
    expect(afterChanges(map, [change('add', CRATE), change('remove', WALL_REACHING_WEST, AT + 1)])[AT]).toBe(1);
  });

  it('leaves the flag alone for structures added on the roof level and for tiles without a structure', () => {
    const noBurn = afterChanges(new Map([[AT, [CRATE]]]), [{ kind: 'add', gridNo: AT, level: 1, tile: WALL }, change('add', 0)]);
    expect(noBurn[AT]).toBe(1);
  });
});
