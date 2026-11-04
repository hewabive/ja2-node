import { describe, expect, it } from 'vitest';
import { Orientation, type StructureDef } from '../../content/formats/jsd.ts';
import type { IndexedFrame } from '../../content/picture/picture.ts';
import { gridNo, WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import type { LevelLayer } from '../../content/world/level.ts';
import { StructureFlags, type StructureInstance, type WorldStructures } from '../../content/world/structures.ts';
import { type TileElement, TileFlags } from '../../content/world/tile-database.ts';
import { type InteractiveScreen, type InteractiveWorld, interactiveNodesAt, interactiveTileOf, sweptTiles } from './interactive-nodes.ts';

const CRATE = 1;
const OPEN_CRATE = 2;
const WALL = 3;
const LEFT_DOOR = 4;
const RIGHT_DOOR = 5;
const LEFT_SWITCH = 6;
const FLAT_CRATE = 7;
const AT = gridNo(80, 80);
const NORTH = AT - WORLD_COLS;
const SOUTH = AT + WORLD_COLS;
const SCREEN: InteractiveScreen = {
  viewport: { width: 640, height: 360 },
  camera: { centerX: 805, centerY: 805 },
  renderHeight: 0,
  animationStep: 0,
};
const DRAWN_AT = { x: 300, y: 160 };
const RECT_AT = { x: 300, y: 170 };
const TILE_HEIGHT = 20;
const BIG = 100;
const POINTER_IN_EVERY_BIG_PICTURE = { x: 320, y: 150 };

function frame(width: number, height: number, pixels: readonly number[], offsetX = 0, offsetY = 0): IndexedFrame {
  return { width, height, offsetX, offsetY, pixels: Uint8Array.from(pixels) };
}

const ONE_PIXEL = frame(4, 2, [0, 0, 7, 0, 0, 0, 0, 0]);
const BIG_PICTURE = frame(BIG, BIG, Array(BIG * BIG).fill(1), -30, -60);

function tile(index: number, flags: number, def: Partial<StructureDef> = {}, tileFlags = 0): TileElement {
  return {
    index,
    type: index,
    regionIndex: 0,
    flags: tileFlags,
    structure: { flags, wallOrientation: Orientation.NONE, partnerDelta: 0, ...def },
  } as unknown as TileElement;
}

const TILES: TileElement[] = [];
TILES[CRATE] = tile(CRATE, StructureFlags.OPENABLE, { partnerDelta: 1 });
TILES[OPEN_CRATE] = tile(OPEN_CRATE, StructureFlags.OPENABLE | StructureFlags.OPEN, { partnerDelta: -1 });
TILES[WALL] = tile(WALL, StructureFlags.WALL);
TILES[LEFT_DOOR] = tile(LEFT_DOOR, StructureFlags.DOOR | StructureFlags.OPENABLE, { wallOrientation: Orientation.INSIDE_LEFT });
TILES[RIGHT_DOOR] = tile(RIGHT_DOOR, StructureFlags.DOOR | StructureFlags.OPENABLE, { wallOrientation: Orientation.INSIDE_RIGHT });
TILES[LEFT_SWITCH] = tile(LEFT_SWITCH, StructureFlags.SWITCH | StructureFlags.OPENABLE, { wallOrientation: Orientation.OUTSIDE_LEFT });
TILES[FLAT_CRATE] = tile(FLAT_CRATE, StructureFlags.OPENABLE, {}, TileFlags.IGNORE_WORLD_HEIGHT);

interface Setup {
  readonly structs: readonly (readonly [number, readonly number[]])[];
  readonly picture?: IndexedFrame;
  readonly roofs?: readonly number[];
  readonly doors?: readonly (readonly [number, number])[];
  readonly revealed?: readonly number[];
  readonly open?: readonly number[];
  readonly basement?: boolean;
  readonly heights?: readonly (readonly [number, number])[];
}

function structLayer(entries: Setup['structs']): LevelLayer {
  const lists = new Map(entries);
  const offsets = new Uint32Array(WORLD_MAX + 1);
  const tiles: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    offsets[g] = tiles.length;
    tiles.push(...(lists.get(g) ?? []));
  }
  offsets[WORLD_MAX] = tiles.length;
  return { offsets, tiles: Uint16Array.from(tiles) };
}

function structuresWith(roofs: ReadonlySet<number>, doors: ReadonlyMap<number, number>): WorldStructures {
  const find = (g: number, mask: number): StructureInstance | null => {
    if (mask === StructureFlags.ROOF) return roofs.has(g) ? ({ wallOrientation: 0 } as StructureInstance) : null;
    if (mask === StructureFlags.ANYDOOR) {
      const orientation = doors.get(g);
      return orientation === undefined ? null : ({ wallOrientation: orientation } as StructureInstance);
    }
    return null;
  };
  return { find } as unknown as WorldStructures;
}

function world(setup: Setup): InteractiveWorld {
  const picture = setup.picture ?? BIG_PICTURE;
  const heights = new Uint8Array(WORLD_MAX);
  for (const [g, h] of setup.heights ?? []) heights[g] = h;
  const revealed = new Uint8Array(WORLD_MAX);
  for (const g of setup.revealed ?? []) revealed[g] = 1;
  return {
    level: { tilesetId: 0, heights, rooms: new Uint8Array(WORLD_MAX), layers: { structs: structLayer(setup.structs) } } as never,
    tiles: TILES,
    surfaces: TILES.map(() => ({ picture: { kind: 'indexed', palette: new Uint8Array(0), frames: [picture] } })),
    structures: structuresWith(new Set(setup.roofs), new Map(setup.doors)),
    revealed,
    openStructures: new Set(setup.open),
    basement: setup.basement ?? false,
  };
}

const nodesAt = (w: InteractiveWorld, at: { x: number; y: number }) => interactiveNodesAt(w, SCREEN, at.x, at.y);
const gridNos = (w: InteractiveWorld, at = POINTER_IN_EVERY_BIG_PICTURE) => nodesAt(w, at).map((n) => n.gridNo);

describe('the openable structures under the pointer (LogMouseOverInteractiveTile)', () => {
  it('tests the picture one pixel left of the pointer, in a rectangle ten pixels below where the picture is drawn (GetLevelNodeScreenRect)', () => {
    const w = world({ structs: [[AT, [CRATE]]], picture: ONE_PIXEL });
    expect(nodesAt(w, { x: DRAWN_AT.x + 2, y: DRAWN_AT.y })).toEqual([]);
    expect(nodesAt(w, { x: RECT_AT.x + 2, y: RECT_AT.y })).toEqual([]);
    expect(nodesAt(w, { x: RECT_AT.x + 3, y: RECT_AT.y })).toEqual([
      { gridNo: AT, index: 0, tile: CRATE, bottom: RECT_AT.y + 2, door: false, open: false },
    ]);
  });

  it("raises the rectangle by the tile's height, also for a picture drawn without the world height", () => {
    const heights = [[AT, TILE_HEIGHT]] as const;
    const raised = { x: RECT_AT.x + 3, y: RECT_AT.y - TILE_HEIGHT };
    expect(nodesAt(world({ structs: [[AT, [CRATE]]], picture: ONE_PIXEL, heights }), raised)).toHaveLength(1);
    expect(nodesAt(world({ structs: [[AT, [FLAT_CRATE]]], picture: ONE_PIXEL, heights }), raised)).toHaveLength(1);
  });

  it('finds every openable picture under the pointer whatever tile it stands on, rows down the screen, each left to right', () => {
    const w = world({
      structs: [
        [gridNo(80, 81), [CRATE]],
        [gridNo(81, 79), [CRATE]],
        [AT, [WALL, CRATE]],
        [gridNo(79, 80), [CRATE]],
      ],
    });
    expect(nodesAt(w, POINTER_IN_EVERY_BIG_PICTURE).map((n) => [n.gridNo, n.index, n.bottom])).toEqual([
      [gridNo(79, 80), 0, 200],
      [AT, 1, 210],
      [gridNo(81, 79), 0, 210],
      [gridNo(80, 81), 0, 220],
    ]);
  });

  it('shows a container as it is drawn: open while the view holds it open', () => {
    const w = world({ structs: [[AT, [CRATE]]], open: [AT] });
    expect(nodesAt(w, POINTER_IN_EVERY_BIG_PICTURE)).toMatchObject([{ gridNo: AT, tile: CRATE, open: true }]);
  });

  it('passes over a door whose sides are both under roofs not yet revealed (IsDoorVisibleAtGridNo)', () => {
    const roofs = [NORTH, SOUTH, AT - 1, AT + 1];
    const leftDoor = { structs: [[AT, [LEFT_DOOR]]], doors: [[AT, Orientation.INSIDE_LEFT]], roofs } as const;
    expect(gridNos(world(leftDoor))).toEqual([]);
    expect(gridNos(world({ ...leftDoor, revealed: [SOUTH] }))).toEqual([AT]);
    expect(gridNos(world({ ...leftDoor, roofs: [NORTH, AT - 1, AT + 1] }))).toEqual([AT]);
    const rightDoor = { structs: [[AT, [RIGHT_DOOR]]], doors: [[AT, Orientation.INSIDE_RIGHT]], roofs } as const;
    expect(gridNos(world(rightDoor))).toEqual([]);
    expect(gridNos(world({ ...rightDoor, roofs: [NORTH, SOUTH, AT - 1] }))).toEqual([AT]);
    expect(gridNos(world({ ...rightDoor, roofs: [], basement: true }))).toEqual([]);
  });

  it('passes over an openable under a roof not yet revealed, and a switch by the roof beyond its wall (RefineLogicOnStruct)', () => {
    expect(gridNos(world({ structs: [[AT, [CRATE]]], roofs: [AT] }))).toEqual([]);
    expect(gridNos(world({ structs: [[AT, [CRATE]]], roofs: [AT], revealed: [AT] }))).toEqual([AT]);
    expect(gridNos(world({ structs: [[AT, [CRATE]]], roofs: [AT], basement: true }))).toEqual([AT]);
    expect(gridNos(world({ structs: [[AT, [LEFT_SWITCH]]], roofs: [SOUTH] }))).toEqual([]);
    expect(gridNos(world({ structs: [[AT, [LEFT_SWITCH]]], roofs: [AT] }))).toEqual([AT]);
  });
});

describe('the tiles the dynamic pass sweeps (CalcRenderParameters, RenderTiles)', () => {
  it('starts a tile left of and two rows above the viewport, rows down the screen to two rows below it, each left to right', () => {
    const swept: number[] = [];
    sweptTiles({ width: 80, height: 40 }, SCREEN.camera, (g) => swept.push(g));
    expect(swept.slice(0, 8)).toEqual([
      gridNo(76, 79),
      gridNo(77, 78),
      gridNo(78, 77),
      gridNo(79, 76),
      gridNo(77, 79),
      gridNo(78, 78),
      gridNo(79, 77),
      gridNo(80, 76),
    ]);
    expect(swept).toHaveLength(52);
  });
});

describe('the interactive tile found (InternalGetCurInteractiveTile)', () => {
  it('reads the node as it is now: a container opened since shows open, a node whose tile changed is gone', () => {
    const w = world({ structs: [[AT, [WALL, CRATE]]] });
    const node = { gridNo: AT, index: 1, tile: CRATE };
    expect(interactiveTileOf(w, node)).toEqual({ gridNo: AT, door: false, switch: false, open: false });
    expect(interactiveTileOf({ ...w, openStructures: new Set([AT]) }, node)).toEqual({
      gridNo: AT,
      door: false,
      switch: false,
      open: true,
    });
    expect(interactiveTileOf(w, { ...node, index: 0 })).toBeNull();
  });
});
