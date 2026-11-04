import { describe, expect, it } from 'vitest';
import type { StructureDef } from '../../content/formats/jsd.ts';
import type { StiIndexed } from '../../content/formats/sti.ts';
import { gridNo, WORLD_MAX } from '../../content/world/grid.ts';
import type { LevelLayer } from '../../content/world/level.ts';
import { RestrictedScroll } from '../../content/world/render-bounds.ts';
import { shadedPalette565 } from '../../content/world/shading.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { NodeFlags } from '../../render/world/reveal.ts';
import type { LoadedWorld } from '../world/world-loader.ts';
import { OVERHEAD_WIDTH, OverheadPicture, type OverheadScene, OverheadTiles, restrictedEdges } from './overhead-map.ts';

const MAP_CENTRE = gridNo(80, 80);
const RAISED_LAND = 80;
const RENDER_HEIGHT = 40;
const CENTRE_PIXEL = { x: 320, y: 160 };
const ROOF_LIFT = 10;
const TWO_TILES_EAST = { x: 16, y: 0 };
const FOUR_TILES_EAST = { x: 32, y: 0 };
const SIX_TILES_EAST = { x: 48, y: 0 };
const NORMAL_SHADE = 4;
const LAND_SHADE = 7;
const ROOF_SHADE = 2;

const Tile = { LAND: 0, CLOSED_DOOR: 1, OPEN_DOOR: 2, ROOF: 3, CEILING: 4, SHADOW: 5 } as const;

function flatWorld(renderHeight = 0): { readonly world: LoadedWorld; readonly heights: Uint8Array } {
  const heights = new Uint8Array(WORLD_MAX);
  const world = { level: { heights }, prepared: { renderHeight } } as unknown as LoadedWorld;
  return { world, heights };
}

function layerOf(entries: Readonly<Record<number, readonly number[]>>): LevelLayer {
  const offsets = new Uint32Array(WORLD_MAX + 1);
  const tiles: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    tiles.push(...(entries[g] ?? []));
    offsets[g + 1] = tiles.length;
  }
  return { offsets, tiles: Uint16Array.from(tiles) };
}

function palette(colour: (index: number) => readonly [number, number, number]): Uint8Array {
  const out = new Uint8Array(768);
  for (let i = 0; i < 256; i++) out.set(colour(i), i * 3);
  return out;
}

const FULL_SIZE_PALETTE = palette((i) => [i * 7, 255 - i * 9, i * 3]);
const SMALL_PALETTE = palette((i) => [255 - i, i, 128]);
const CLOSED_DOOR: StructureDef = { flags: StructureFlags.OPENABLE, partnerDelta: 1 } as StructureDef;

function element(index: number, structure: StructureDef | null = null): TileElement {
  return { index, type: 0, regionIndex: index, flags: 0, structure } as unknown as TileElement;
}

const TILES: readonly TileElement[] = [
  element(Tile.LAND),
  element(Tile.CLOSED_DOOR, CLOSED_DOOR),
  element(Tile.OPEN_DOOR),
  element(Tile.ROOF),
  element(Tile.CEILING),
  element(Tile.SHADOW),
];

const SMALL_TILES: StiIndexed = {
  kind: 'indexed',
  width: 1,
  height: 1,
  flags: 0,
  palette: SMALL_PALETTE,
  subImages: TILES.map((t) => ({ offsetX: 0, offsetY: 0, width: 1, height: 1, pixels: Uint8Array.of(t.index + 1) })),
  appData: null,
  anomalies: 0,
};

function paintedWorld(restrictedScrollId: number = RestrictedScroll.NONE): LoadedWorld {
  return {
    mapPath: 'maps/test.dat',
    map: { info: { restrictedScrollId }, lights: null },
    level: { heights: new Uint8Array(WORLD_MAX) },
    tiles: TILES,
    surfaces: [{ picture: { palette: FULL_SIZE_PALETTE } }],
    prepared: { renderHeight: 0 },
  } as unknown as LoadedWorld;
}

interface SceneParts {
  readonly land?: Readonly<Record<number, readonly number[]>>;
  readonly structs?: Readonly<Record<number, readonly number[]>>;
  readonly roofs?: Readonly<Record<number, readonly number[]>>;
  readonly mapShadows?: Readonly<Record<number, readonly number[]>>;
  readonly keptShadows?: Readonly<Record<number, readonly number[]>>;
  readonly hiddenRoofs?: ReadonlySet<number>;
  readonly ceilings?: ReadonlySet<number>;
  readonly openStructures?: ReadonlySet<number>;
}

function scene(parts: SceneParts): OverheadScene {
  const empty = layerOf({});
  const landStart = new Int8Array(WORLD_MAX).fill(-1);
  for (const g of Object.keys(parts.land ?? {})) landStart[Number(g)] = 0;
  return {
    level: {
      tilesetId: 0,
      heights: new Uint8Array(WORLD_MAX),
      rooms: new Uint8Array(WORLD_MAX),
      layers: {
        land: layerOf(parts.land ?? {}),
        objects: empty,
        structs: layerOf(parts.structs ?? {}),
        shadows: layerOf(parts.mapShadows ?? {}),
        roofs: layerOf(parts.roofs ?? {}),
        onRoof: empty,
      },
    },
    prepared: { landStart, shadows: layerOf(parts.keptShadows ?? {}) },
    reveal: {
      nodeFlags: (layer, g) => (layer === 'roofs' && parts.hiddenRoofs?.has(g) ? NodeFlags.HIDDEN : 0),
      ceilings: (g) => (parts.ceilings?.has(g) ? [Tile.CEILING] : []),
    },
    openStructures: parts.openStructures ?? new Set(),
    shade: { land: new Uint8Array(WORLD_MAX).fill(LAND_SHADE), roof: new Uint8Array(WORLD_MAX).fill(ROOF_SHADE) },
  };
}

function compose(parts: SceneParts, world: LoadedWorld = paintedWorld()): Uint16Array {
  let pixels: Uint16Array = new Uint16Array(0);
  OverheadPicture.compose('overhead', world, new OverheadTiles(world, [SMALL_TILES]), scene(parts), {
    addRgb: (_key, _width, _height, composed) => {
      pixels = composed;
    },
  });
  return pixels;
}

function pixelAt(pixels: Uint16Array, at: { readonly x: number; readonly y: number }): number {
  return pixels[at.y * OVERHEAD_WIDTH + at.x] ?? -1;
}

function shifted(by: { readonly x: number; readonly y: number }, dy = 0): { x: number; y: number } {
  return { x: CENTRE_PIXEL.x + by.x, y: CENTRE_PIXEL.y + by.y + dy };
}

function fullSizeColour(tile: number, shade: number): number {
  return shadedPalette565(FULL_SIZE_PALETTE, shade)[tile + 1] ?? -1;
}

describe('the overhead map projection', () => {
  it('places a cell at its absolute screen point over five, five pixels in', () => {
    const picture = new OverheadPicture('overhead', flatWorld().world);
    expect(picture.pointOf(MAP_CENTRE)).toEqual({ x: 321, y: 158 });
    expect(picture.pointOf(gridNo(81, 80))).toEqual({ x: 325, y: 160 });
    expect(picture.pointOf(gridNo(80, 81))).toEqual({ x: 317, y: 160 });
  });

  it('lifts a cell by its land height and lowers it by the render height', () => {
    const { world, heights } = flatWorld(RENDER_HEIGHT);
    heights[MAP_CENTRE] = RAISED_LAND;
    expect(new OverheadPicture('overhead', world).pointOf(MAP_CENTRE)).toEqual({ x: 321, y: 158 - 16 + 8 });
  });

  it('finds the cell under the pointer eight rows above it', () => {
    const picture = new OverheadPicture('overhead', flatWorld().world);
    expect(picture.gridNoAt(321, 163)).toBe(MAP_CENTRE);
    expect(picture.gridNoAt(325, 165)).toBe(gridNo(81, 80));
    expect(picture.gridNoAt(700, 0)).toBeNull();
  });

  it("finds a soldier's cell under the pointer without the eight rows, as GetOverheadMouseGridNoForFullSoldiersGridNo", () => {
    const picture = new OverheadPicture('overhead', flatWorld().world);
    expect(picture.soldierGridNoAt(321, 155)).toBe(MAP_CENTRE);
    expect(picture.gridNoAt(321, 155)).toBe(gridNo(78, 78));
  });
});

describe('the overhead map picture (RenderOverheadMap)', () => {
  it("draws each node at its tile's shade through the full-size surface's shade tables, as CopyOverheadDBShadetablesFromTileset shares them", () => {
    const pixels = compose({ land: { [MAP_CENTRE]: [Tile.LAND] }, roofs: { [MAP_CENTRE]: [Tile.ROOF] } });
    expect(pixelAt(pixels, CENTRE_PIXEL)).toBe(fullSizeColour(Tile.LAND, LAND_SHADE));
    expect(pixelAt(pixels, shifted({ x: 0, y: 0 }, -ROOF_LIFT))).toBe(fullSizeColour(Tile.ROOF, ROOF_SHADE));
    expect(pixelAt(pixels, CENTRE_PIXEL)).not.toBe(shadedPalette565(SMALL_PALETTE, NORMAL_SHADE)[Tile.LAND + 1]);
  });

  it('leaves out the roofs a room reveal hides and draws a slanted roof ceiling at the head of the roofs', () => {
    const shown = gridNo(82, 78);
    const hidden = gridNo(84, 76);
    const ceiling = gridNo(86, 74);
    const pixels = compose({
      roofs: { [shown]: [Tile.ROOF], [hidden]: [Tile.ROOF] },
      hiddenRoofs: new Set([hidden]),
      ceilings: new Set([ceiling]),
    });
    expect(pixelAt(pixels, shifted(TWO_TILES_EAST, -ROOF_LIFT))).toBe(fullSizeColour(Tile.ROOF, ROOF_SHADE));
    expect(pixelAt(pixels, shifted(FOUR_TILES_EAST, -ROOF_LIFT))).toBe(0);
    expect(pixelAt(pixels, shifted(SIX_TILES_EAST, -ROOF_LIFT))).toBe(fullSizeColour(Tile.CEILING, ROOF_SHADE));
  });

  it('draws an open door as its partner tile, as the swapped structure is', () => {
    const closed = compose({ structs: { [MAP_CENTRE]: [Tile.CLOSED_DOOR] } });
    const open = compose({ structs: { [MAP_CENTRE]: [Tile.CLOSED_DOOR] }, openStructures: new Set([MAP_CENTRE]) });
    expect(pixelAt(closed, CENTRE_PIXEL)).toBe(fullSizeColour(Tile.CLOSED_DOOR, LAND_SHADE));
    expect(pixelAt(open, CENTRE_PIXEL)).toBe(fullSizeColour(Tile.OPEN_DOOR, LAND_SHADE));
  });

  it("darkens with the shadow list the map load keeps (OptimizeMapForShadows), not the map file's", () => {
    const land = { [MAP_CENTRE]: [Tile.LAND], [gridNo(82, 78)]: [Tile.LAND] };
    const pixels = compose({
      land,
      mapShadows: { [MAP_CENTRE]: [Tile.SHADOW] },
      keptShadows: { [gridNo(82, 78)]: [Tile.SHADOW] },
    });
    expect(pixelAt(pixels, CENTRE_PIXEL)).toBe(fullSizeColour(Tile.LAND, LAND_SHADE));
    expect(pixelAt(pixels, shifted(TWO_TILES_EAST))).toBeLessThan(fullSizeColour(Tile.LAND, LAND_SHADE));
  });

  it("blacks out a basement's edges, the east one 8 pixels short of the west one's mirror: NORMAL_MAP_SCREEN_WIDTH is 3160, 20 below the full map's width", () => {
    expect(restrictedEdges(RestrictedScroll.NONE)).toEqual([]);
    expect(restrictedEdges(RestrictedScroll.BASEMENT)).toEqual([
      { x1: 0, y1: 0, x2: 640, y2: 94 },
      { x1: 0, y1: 0, x2: 188, y2: 320 },
      { x1: 0, y1: 212, x2: 640, y2: 320 },
      { x1: 444, y1: 0, x2: 640, y2: 320 },
    ]);
    const land = { [MAP_CENTRE]: [Tile.LAND], [gridNo(95, 65)]: [Tile.LAND], [gridNo(96, 64)]: [Tile.LAND] };
    const pixels = compose({ land }, paintedWorld(RestrictedScroll.BASEMENT));
    expect(pixelAt(pixels, CENTRE_PIXEL)).toBe(fullSizeColour(Tile.LAND, LAND_SHADE));
    expect(pixelAt(pixels, { x: 440, y: 160 })).toBe(fullSizeColour(Tile.LAND, LAND_SHADE));
    expect(pixelAt(pixels, { x: 448, y: 160 })).toBe(0);
  });
});
