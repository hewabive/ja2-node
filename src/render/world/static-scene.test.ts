import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyTileLayer, LAYER_NAMES, type MapDef, tileLayerFromLists } from '../../content/formats/map.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { buildLevel, levelTilesAt } from '../../content/world/level.ts';
import { placeWorldStructures } from '../../content/world/placement.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { buildTileDatabase, type TileElement, TileFlags, type TileSurface } from '../../content/world/tile-database.ts';
import { parseTileTables, tileIndex, typeIndex } from '../../content/world/tile-tables.ts';
import { type Camera, screenToGridNo, tileOrigin, type Viewport, worldOrigin } from './geometry.ts';
import { DrawState, FLOATS_PER_INSTANCE, InstanceFlags, ShadeKey } from './instances.ts';
import { prepareLevelRenderData } from './level-render-data.ts';
import { computeReveal, NO_REVEAL } from './reveal.ts';
import {
  openableTileInState,
  STATIC_SEGMENT_STATES,
  StaticScene,
  StaticSegment,
  type StaticState,
  type StaticWorld,
} from './static-scene.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));
const surfaces: TileSurface[] = tables.types.map((t) => ({
  type: t.index,
  path: `t${t.index}.sti`,
  frames: Array.from({ length: t.count }, () => ({ offsetX: 0, offsetY: 0, width: 40 })),
  auxData: null,
  structures: null,
}));
const baseTiles = buildTileDatabase(tables, surfaces);
const viewport: Viewport = { width: 640, height: 360 };
const camera: Camera = { centerX: 805, centerY: 805 };
const T = (name: string, sub = 1) => ({ type: typeIndex(tables, name), subIndex: sub });
const g = (x: number, y: number) => y * WORLD_COLS + x;
const DEFAULT_STATE: StaticState = { reveal: NO_REVEAL, openStructures: new Set(), treeTops: true, wireframes: true, roofLevel: false };

type Cells = Partial<Record<(typeof LAYER_NAMES)[number], [number, { type: number; subIndex: number }[]][]>>;

function worldWith(cells: Cells, tiles: TileElement[] = baseTiles, width = 40): StaticWorld {
  const layers = Object.fromEntries(
    LAYER_NAMES.map((name) => {
      const lists = Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[]);
      for (const [at, list] of cells[name] ?? []) lists[at] = list;
      return [name, cells[name] ? tileLayerFromLists(lists) : emptyTileLayer()];
    }),
  ) as unknown as MapDef['layers'];
  const map = {
    minorVersion: 25,
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers,
  } as unknown as MapDef;
  const level = buildLevel(map, tables, tiles);
  const info = { northGridNo: -1, eastGridNo: -1, southGridNo: -1, westGridNo: -1 } as MapDef['info'];
  return {
    level,
    tiles,
    prepared: prepareLevelRenderData(level, tiles, tables, info, false),
    topY: 860,
    sprite: (tile) => ({ layer: 0, x: 0, y: tile, width, height: 20, offsetX: 0, offsetY: 0, paletteBase: 16 * (tiles[tile]?.type ?? 0) }),
  };
}

interface Decoded {
  readonly tile: number;
  readonly x: number;
  readonly y: number;
  readonly srcX: number;
  readonly width: number;
  readonly z: number;
  readonly shadeKey: number;
  readonly flags: number;
}

function segment(scene: StaticScene, seg: StaticSegment): Decoded[] {
  const a = scene.assemble();
  const out: Decoded[] = [];
  for (let i = a.segmentStart[seg] ?? 0; i < (a.segmentStart[seg + 1] ?? 0); i++) {
    const o = i * FLOATS_PER_INSTANCE;
    const d = a.data;
    out.push({
      tile: d[o + 5] as number,
      x: d[o] as number,
      y: d[o + 1] as number,
      srcX: d[o + 4] as number,
      width: d[o + 2] as number,
      z: d[o + 8] as number,
      shadeKey: d[o + 9] as number,
      flags: d[o + 10] as number,
    });
  }
  return out;
}

const names = (list: readonly Decoded[]) => list.map((i) => tables.tileNames[i.tile]);

function withRoomRevealed(world: StaticWorld, at: number): StaticWorld & { readonly reveal: StaticState['reveal'] } {
  const room = 3;
  const rooms = new Uint8Array(WORLD_MAX);
  rooms[at] = room;
  const level = { ...world.level, rooms };
  const placed = placeWorldStructures(level, world.tiles);
  const reveal = computeReveal({ level, tiles: world.tiles, tables, structures: placed.structures, basement: false }, new Set([room]));
  return { ...world, level, reveal };
}

describe('projection and picking', () => {
  it('picks the tile whose diamond is under the cursor', () => {
    for (const [x, y] of [
      [80, 80],
      [81, 79],
      [75, 90],
      [90, 70],
    ] as const) {
      const o = tileOrigin(x, y, viewport, camera);
      expect(screenToGridNo(o.x + 20, o.y + 10, viewport, camera)).toBe(g(x, y));
      expect(screenToGridNo(o.x + 20, o.y + 1, viewport, camera)).toBe(g(x, y));
    }
    expect(tileOrigin(80, 80, viewport, camera)).toEqual({ x: 300, y: 160 });
  });
});

describe('static scene order and depth', () => {
  it('draws land from the topmost full tile to the head, skipping covered land', () => {
    const scene = new StaticScene(
      worldWith({ land: [[g(80, 80), [T('FIRSTTEXTURE', 15), T('FIRSTTEXTURE', 1), T('FIRSTTEXTURE', 20)]]] }),
      DEFAULT_STATE,
    );
    expect(names(segment(scene, StaticSegment.LAND))).toEqual(['FIRSTTEXTURE1', 'FIRSTTEXTURE20']);
    expect(segment(scene, StaticSegment.LAND)[0]?.shadeKey).toBe(g(80, 80));
  });

  it('draws no land on a tile none of whose land pieces is full', () => {
    const scene = new StaticScene(worldWith({ land: [[g(80, 80), [T('FIRSTTEXTURE', 20)]]] }), DEFAULT_STATE);
    expect(segment(scene, StaticSegment.LAND)).toEqual([]);
  });

  it('keeps rows in X+Y order and uses the original z per layer, in world coordinates', () => {
    const scene = new StaticScene(
      worldWith({
        structs: [
          [g(81, 80), [T('FIRSTWALL', 1)]],
          [g(80, 80), [T('FIRSTWALL', 1)]],
        ],
        roofs: [[g(80, 80), [T('FIRSTROOF', 1)]]],
        objects: [[g(80, 80), [T('FIRSTOSTRUCT', 1)]]],
      }),
      DEFAULT_STATE,
    );
    const [wallA, wallB] = segment(scene, StaticSegment.STRUCTS);
    expect(wallA?.z).toBe(8 * (10 * 160 - 835) + 4);
    expect(wallB?.z).toBe(8 * (10 * 161 - 835) + 4);
    const [roof] = segment(scene, StaticSegment.ROOFS);
    expect(roof?.z).toBe(8 * (10 * 160 - 835 + 50) + 5);
    expect(roof?.y).toBe(worldOrigin(80, 80).y - 50);
    expect(roof?.shadeKey).toBe(ShadeKey.ROOF_BASE + g(80, 80));
    expect(segment(scene, StaticSegment.OBJECTS)[0]).toMatchObject({ z: 1 });
  });

  it('wraps a negative z at the top edge to the nearest depth and clamps shadows there to 0, which their strict test never passes', () => {
    const topEdgeRow = 80;
    const scene = new StaticScene(worldWith({ structs: [[g(40, topEdgeRow - 40), [T('FIRSTOSTRUCT', 1)]]] }), DEFAULT_STATE);
    const wy = 10 * topEdgeRow - 835;
    expect(wy).toBeLessThan(0);
    expect(segment(scene, StaticSegment.STRUCTS)[0]?.z).toBe(65536 + 8 * wy + 4);
    expect(segment(scene, StaticSegment.SHADOWS)[0]?.z).toBe(0);
    expect(STATIC_SEGMENT_STATES[StaticSegment.SHADOWS]).toBe(DrawState.SHADOW_WRITE);
  });

  it('splits multi-tile structures into strips: walls compare with <=, others with <', () => {
    const ostruct = typeIndex(tables, 'FIRSTOSTRUCT');
    const wall = typeIndex(tables, 'FIRSTWALL');
    const strip = { zChanges: [1, 0, -1], initialZChange: -1, firstStripWidth: 10 };
    const tiles = baseTiles.map((t) =>
      (t.type === ostruct || t.type === wall) && t.regionIndex === 0 ? { ...t, flags: t.flags | TileFlags.MULTI_Z, zStrip: strip } : t,
    );
    const scene = new StaticScene(
      worldWith(
        {
          structs: [
            [g(80, 80), [T('FIRSTOSTRUCT', 1)]],
            [g(90, 90), [T('FIRSTWALL', 1)]],
          ],
        },
        tiles,
        70,
      ),
      DEFAULT_STATE,
    );
    const base = 8 * (10 * 160 - 835) + 4;
    const strict = segment(scene, StaticSegment.STRICT_STRIPS);
    expect(strict.map((s) => [s.srcX, s.width, s.z])).toEqual([
      [0, 10, base - 80],
      [10, 20, base],
      [30, 20, base],
      [50, 20, base - 80],
    ]);
    expect(names(segment(scene, StaticSegment.STRUCTS))).toEqual(['FIRSTWALL1', 'FIRSTWALL1', 'FIRSTWALL1', 'FIRSTWALL1']);
  });

  it('adds buddy shadows and sends tree tops and open doors through their substitutes', () => {
    const scene = new StaticScene(
      worldWith({ land: [[g(80, 80), [T('FIRSTTEXTURE', 1)]]], structs: [[g(80, 80), [T('FIRSTOSTRUCT', 1)]]] }),
      DEFAULT_STATE,
    );
    expect(names(segment(scene, StaticSegment.SHADOWS))).toEqual(['FIRSTSHADOW1']);
    const trees = new StaticScene(worldWith({ structs: [[g(80, 80), [T('FIRSTFULLSTRUCT', 1)]]] }), { ...DEFAULT_STATE, treeTops: false });
    expect(names(segment(trees, StaticSegment.STRUCTS))).toEqual(['FIRSTFULLSTRUCT3']);
  });

  it('hides revealed room roofs and draws revealed obstacles in the obscured pass', () => {
    const tiles = baseTiles;
    const world = worldWith({ roofs: [[g(80, 80), [T('FIRSTROOF', 1)]]], structs: [[g(80, 80), [T('FIRSTOSTRUCT', 1)]]] }, tiles);
    const rooms = new Uint8Array(WORLD_MAX);
    rooms[g(80, 80)] = 3;
    const level = { ...world.level, rooms };
    const placed = placeWorldStructures(level, tiles);
    const reveal = computeReveal({ level, tiles, tables, structures: placed.structures, basement: false }, new Set([3]));
    expect(reveal.revealed[g(80, 80)]).toBe(1);
    const scene = new StaticScene({ ...world, level }, { ...DEFAULT_STATE, reveal });
    expect(segment(scene, StaticSegment.ROOFS)).toEqual([]);
    expect(segment(new StaticScene({ ...world, level }, { ...DEFAULT_STATE, reveal, roofLevel: true }), StaticSegment.ROOFS)).toHaveLength(
      1,
    );
  });

  it('drops every shadow of a tree hemmed in by structures, counting the map edge as one', () => {
    const footprint = (flags: number) => ({ flags, tiles: [{ posRelToBase: 0 }] }) as unknown as TileElement['structure'];
    const footprints = new Map([
      [tileIndex(tables, 'FIRSTFULLSTRUCT1'), footprint(StructureFlags.TREE)],
      [tileIndex(tables, 'FIRSTOSTRUCT1'), footprint(StructureFlags.GENERIC)],
    ]);
    const tiles = baseTiles.map((t, i) => ({ ...t, structure: footprints.get(i) ?? t.structure }));
    const treeHemmedInSouthAndEast = (x: number, y: number): [number, { type: number; subIndex: number }[]][] => [
      [g(x, y), [T('FIRSTFULLSTRUCT', 1)]],
      [g(x, y + 1), [T('FIRSTOSTRUCT', 1)]],
      [g(x + 1, y + 1), [T('FIRSTOSTRUCT', 1)]],
      [g(x + 1, y), [T('FIRSTOSTRUCT', 1)]],
    ];
    const atWestEdge = g(0, 80);
    const inland = g(40, 80);
    const world = worldWith(
      {
        structs: [...treeHemmedInSouthAndEast(0, 80), ...treeHemmedInSouthAndEast(40, 80)],
        shadows: [
          [atWestEdge, [T('FIRSTSHADOW', 2)]],
          [inland, [T('FIRSTSHADOW', 2)]],
        ],
      },
      tiles,
    );
    const shadowNames = (at: number) => [...levelTilesAt(world.prepared.shadows, at)].map((t) => tables.tileNames[t]);
    expect(shadowNames(inland)).toEqual(['FIRSTFULLSHADOW1', 'FIRSTSHADOW2']);
    expect(shadowNames(atWestEdge)).toEqual([]);
  });

  it('shows the hidden roofs of a revealed room again at the roof level, but not its hidden A-frame walls', () => {
    const aframe = T('FIRSTWALL', 32);
    expect((baseTiles[tileIndex(tables, 'FIRSTWALL32')]?.flags ?? 0) & TileFlags.AFRAME).toBe(TileFlags.AFRAME);
    const world = withRoomRevealed(worldWith({ roofs: [[g(80, 80), [T('FIRSTROOF', 1), aframe]]] }), g(80, 80));
    const groundLevel = new StaticScene(world, { ...DEFAULT_STATE, reveal: world.reveal });
    expect(segment(groundLevel, StaticSegment.ROOFS)).toEqual([]);
    const roofLevel = new StaticScene(world, { ...DEFAULT_STATE, reveal: world.reveal, roofLevel: true });
    expect(names(segment(roofLevel, StaticSegment.ROOFS))).toEqual(['FIRSTROOF1']);
  });

  it('keeps the on-roof objects of a revealed room in view, as nothing in the original hides them', () => {
    const world = withRoomRevealed(
      worldWith({ roofs: [[g(80, 80), [T('FIRSTROOF', 1)]]], onRoof: [[g(80, 80), [T('FIRSTONROOF', 1)]]] }),
      g(80, 80),
    );
    const scene = new StaticScene(world, { ...DEFAULT_STATE, reveal: world.reveal });
    expect(segment(scene, StaticSegment.ROOFS)).toEqual([]);
    expect(names(segment(scene, StaticSegment.ON_ROOF))).toEqual(['FIRSTONROOF1']);
  });

  it('rebuilds only the rows of changed doors', () => {
    const world = worldWith({ structs: [[g(80, 80), [T('FIRSTWALL', 1)]]] });
    const scene = new StaticScene(world, DEFAULT_STATE);
    const before = scene.assemble();
    scene.setState(DEFAULT_STATE, [160]);
    expect(scene.assemble().count).toBe(before.count);
    expect(segment(scene, StaticSegment.OBSCURED_DITHER).every((i) => i.flags === InstanceFlags.DITHER)).toBe(true);
  });
});

describe('openable tiles', () => {
  const DOOR_FRAMES = 4;
  const CLOSED = 10;
  const OPEN = CLOSED + DOOR_FRAMES;
  const AT = g(80, 80);
  const doorTile = (flags: number, partnerDelta: number) => ({ structure: { flags, partnerDelta } }) as unknown as TileElement;
  const tiles: TileElement[] = [];
  tiles[CLOSED] = doorTile(StructureFlags.DOOR, DOOR_FRAMES);
  tiles[OPEN] = doorTile(StructureFlags.DOOR | StructureFlags.OPEN, -DOOR_FRAMES);

  it('draws a door in the state of the view, whichever state the map holds it in', () => {
    const open = new Set([AT]);
    const closed = new Set<number>();
    expect(openableTileInState(tiles, open, AT, CLOSED)).toBe(OPEN);
    expect(openableTileInState(tiles, open, AT, OPEN)).toBe(OPEN);
    expect(openableTileInState(tiles, closed, AT, OPEN)).toBe(CLOSED);
    expect(openableTileInState(tiles, closed, AT, CLOSED)).toBe(CLOSED);
  });

  it('draws a crate or a switch the same way, and leaves other structures alone', () => {
    const CRATE = 30;
    const WALL = 40;
    tiles[CRATE] = doorTile(StructureFlags.OPENABLE, 1);
    tiles[CRATE + 1] = doorTile(StructureFlags.OPENABLE | StructureFlags.OPEN, -1);
    tiles[WALL] = doorTile(StructureFlags.WALL, 1);
    expect(openableTileInState(tiles, new Set([AT]), AT, CRATE)).toBe(CRATE + 1);
    expect(openableTileInState(tiles, new Set(), AT, CRATE + 1)).toBe(CRATE);
    expect(openableTileInState(tiles, new Set([AT]), AT, WALL)).toBe(WALL);
  });
});
