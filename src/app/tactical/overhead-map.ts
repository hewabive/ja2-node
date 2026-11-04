// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Overhead_Map.cc InitNewOverheadDB (the small tiles from the tileset's t/ folder, grass.sti of
// @src the default tileset when one is missing, sub-image 0 for the regions a small file lacks),
// @src CopyOverheadDBShadetablesFromTileset (a small tile takes the shade tables of its full-size surface),
// @src RenderOverheadMap (the three passes over the 640 × 320 area in 8 × 2 steps with the odd rows shifted by 4: land
// @src from its start node, then objects, shadows and structures with IGNORE_WORLD_HEIGHT using the modified height, then
// @src roofs lifted by WALL_HEIGHT / 5 without the hidden ones; every node at its own shade; the edges of a restricted
// @src map blacked out from the map's corner), CalculateRestrictedMapCoords (the NORMAL_MAP_SCREEN_* constants),
// @src GetOverheadScreenXYFromGridNo, InternalGetOverheadMouseGridNo (the -8 row adjustment of GetOverheadMouseGridNo,
// @src none for GetOverheadMouseGridNoForFullSoldiersGridNo, and the land height correction, both through the absolute
// @src screen projection of render-bounds.ts); src/sgp/Shading.cc BuildShadeTable (the shadow blit). The persons, items
// @src and pointer keep the unrestricted origin, which gsStartRestrictedX/Y give back to a restricted map.
// @src Composed from the world as last drawn (the map's changes, the room reveals, the open doors, the shade field) at
// @src every entry, as GoIntoOverheadMap sets gfOverheadMapDirty (2026-11-04).

import { decodeSti, type StiIndexed, type StiSubImage } from '../../content/formats/sti.ts';
import { CELL_X_SIZE, CELL_Y_SIZE, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../content/world/grid.ts';
import { type Level, type LevelLayer, levelTilesAt } from '../../content/world/level.ts';
import { absoluteScreenXY, RestrictedScroll, renderBounds, worldXYFromAbsoluteScreenXY } from '../../content/world/render-bounds.ts';
import { SHADOW_FACTOR, shadedPalette565 } from '../../content/world/shading.ts';
import { type TileElement, TileFlags } from '../../content/world/tile-database.ts';
import { idiv } from '../../core/int.ts';
import { NodeFlags, type RevealState } from '../../render/world/reveal.ts';
import { openableTileInState } from '../../render/world/static-scene.ts';
import type { ShadeField } from '../../render/world/world-renderer.ts';
import type { DrawList } from '../../ui/draw-list.ts';
import type { OverheadMapView, ScreenPoint } from '../../ui/screens/tactical/environment.ts';
import type { ReadVfsFile } from '../net/vfs.ts';
import type { LoadedWorld } from '../world/world-loader.ts';
import { mapLightColour } from '../world/world-loader.ts';

export const OVERHEAD_WIDTH = 640;
export const OVERHEAD_HEIGHT = 320;
const SCALE = 5;
const STEP_X = 8;
const STEP_Y = 2;
const ODD_SHIFT = 4;
const START_ROW = WORLD_COLS / 2;
const WALL_HEIGHT = 50;
const CLIFF_STEP = 80;
const EDGE = 5;
const MOUSE_ROW_ADJUST = -8;
const SOLDIER_ROW_ADJUST = 0;
const FALLBACK_SMALL = 'tilesets/0/t/grass.sti';
const SHADE_TABLES = 16;
const NORMAL_MAP_SCREEN_WIDTH = 3160;
const NORMAL_MAP_SCREEN_HEIGHT = 1540;
const NORMAL_MAP_SCREEN_X = 1580;
const NORMAL_MAP_SCREEN_BY = 2400;
const NORMAL_MAP_SCREEN_TY = 860;

export interface OverheadPictureSink {
  addRgb(key: string, width: number, height: number, pixels: Uint16Array): void;
}

export interface OverheadScene {
  readonly level: Level;
  readonly prepared: { readonly landStart: Int8Array; readonly shadows: LevelLayer };
  readonly reveal: Pick<RevealState, 'nodeFlags' | 'ceilings'>;
  readonly openStructures: ReadonlySet<number>;
  readonly shade: Pick<ShadeField, 'land' | 'roof'>;
}

interface Rect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function smallPathOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return `${path.slice(0, slash)}/t/${path.slice(slash + 1)}`;
}

function darken(c: number): number {
  const r = Math.trunc(((c >> 11) & 31) * SHADOW_FACTOR);
  const g = Math.trunc(((c >> 5) & 63) * SHADOW_FACTOR);
  const b = Math.trunc((c & 31) * SHADOW_FACTOR);
  return (r << 11) | (g << 5) | b;
}

function modifiedHeight(height: number): number {
  return Math.max(0, (idiv(height, CLIFF_STEP) - 1) * CLIFF_STEP);
}

export class OverheadTiles {
  readonly #small: readonly (StiIndexed | null)[];
  readonly #world: LoadedWorld;
  readonly #shades = new Map<number, Uint16Array>();

  constructor(world: LoadedWorld, small: readonly (StiIndexed | null)[]) {
    this.#world = world;
    this.#small = small;
  }

  frameOf(element: TileElement): StiSubImage | null {
    const small = this.#small[element.type];
    return small?.subImages[element.regionIndex] ?? small?.subImages[0] ?? null;
  }

  colours(type: number, shade: number): Uint16Array | null {
    const key = type * SHADE_TABLES + shade;
    const known = this.#shades.get(key);
    if (known) return known;
    const surface = this.#world.surfaces[type];
    if (!surface) return null;
    const colours = shadedPalette565(surface.picture.palette, shade, mapLightColour(this.#world.map));
    this.#shades.set(key, colours);
    return colours;
  }
}

export async function loadOverheadTiles(world: LoadedWorld, available: ReadonlySet<string>, read: ReadVfsFile): Promise<OverheadTiles> {
  const cache = new Map<string, Promise<StiIndexed | null>>();
  const load = (path: string): Promise<StiIndexed | null> => {
    const known = cache.get(path);
    if (known) return known;
    const next = (async () => {
      const chosen = available.has(path) ? path : available.has(FALLBACK_SMALL) ? FALLBACK_SMALL : null;
      if (!chosen) return null;
      const sti = decodeSti(await read(chosen));
      return sti.kind === 'indexed' ? sti : null;
    })();
    cache.set(path, next);
    return next;
  };
  const small = await Promise.all(world.surfaces.map((surface) => (surface ? load(smallPathOf(surface.path)) : Promise.resolve(null))));
  return new OverheadTiles(world, small);
}

export function restrictedEdges(restrictedScrollId: number): readonly Rect[] {
  if (restrictedScrollId === RestrictedScroll.NONE) return [];
  const b = renderBounds(restrictedScrollId);
  return [
    { x1: 0, y1: 0, x2: OVERHEAD_WIDTH, y2: idiv(Math.abs(NORMAL_MAP_SCREEN_TY - b.topY), SCALE) },
    { x1: 0, y1: 0, x2: idiv(Math.abs(-NORMAL_MAP_SCREEN_X - b.leftX), SCALE), y2: OVERHEAD_HEIGHT },
    {
      x1: 0,
      y1: idiv(NORMAL_MAP_SCREEN_HEIGHT - Math.abs(NORMAL_MAP_SCREEN_BY - b.bottomY), SCALE),
      x2: OVERHEAD_WIDTH,
      y2: OVERHEAD_HEIGHT,
    },
    {
      x1: idiv(NORMAL_MAP_SCREEN_WIDTH - Math.abs(NORMAL_MAP_SCREEN_X - b.rightX), SCALE),
      y1: 0,
      x2: OVERHEAD_WIDTH,
      y2: OVERHEAD_HEIGHT,
    },
  ];
}

function blackOut(pixels: Uint16Array, rect: Rect): void {
  for (let y = Math.max(0, rect.y1); y < Math.min(OVERHEAD_HEIGHT, rect.y2); y++) {
    pixels.fill(0, y * OVERHEAD_WIDTH + Math.max(0, rect.x1), y * OVERHEAD_WIDTH + Math.min(OVERHEAD_WIDTH, rect.x2));
  }
}

export class OverheadPicture implements OverheadMapView {
  readonly key: string;
  readonly #world: LoadedWorld;

  constructor(key: string, world: LoadedWorld) {
    this.key = key;
    this.#world = world;
  }

  static compose(key: string, world: LoadedWorld, tiles: OverheadTiles, scene: OverheadScene, sink: OverheadPictureSink): OverheadPicture {
    const pixels = new Uint16Array(OVERHEAD_WIDTH * OVERHEAD_HEIGHT);
    const painter = new Painter(world, tiles, scene, pixels);
    painter.pass((g, x, y) => painter.land(g, x, y));
    painter.pass((g, x, y) => painter.middle(g, x, y));
    painter.pass((g, x, y) => painter.roofs(g, x, y));
    for (const edge of restrictedEdges(world.map.info.restrictedScrollId)) blackOut(pixels, edge);
    sink.addRgb(key, OVERHEAD_WIDTH, OVERHEAD_HEIGHT, pixels);
    return new OverheadPicture(key, world);
  }

  render(list: DrawList, x: number, y: number): void {
    list.image(this.key, 0, x, y);
  }

  pointOf(gridNo: number): ScreenPoint {
    const at = absoluteScreenXY(RestrictedScroll.NONE, gridNo);
    const height = this.#world.level.heights[gridNo] ?? 0;
    return {
      x: idiv(at.x, SCALE) + EDGE,
      y: idiv(at.y, SCALE) + EDGE - idiv(height, SCALE) + idiv(this.#world.prepared.renderHeight, SCALE),
    };
  }

  gridNoAt(x: number, y: number): number | null {
    return this.#gridNoAt(x, y, MOUSE_ROW_ADJUST);
  }

  soldierGridNoAt(x: number, y: number): number | null {
    return this.#gridNoAt(x, y, SOLDIER_ROW_ADJUST);
  }

  #gridNoAt(x: number, y: number, rowAdjust: number): number | null {
    const worldX = (x - EDGE) * SCALE;
    let worldY = (y + rowAdjust) * SCALE;
    const first = gridNoFromAbsolute(worldX, worldY);
    if (first === null) return null;
    worldY += (this.#world.level.heights[first] ?? 0) - this.#world.prepared.renderHeight;
    return gridNoFromAbsolute(worldX, worldY);
  }
}

function gridNoFromAbsolute(x: number, y: number): number | null {
  const world = worldXYFromAbsoluteScreenXY(RestrictedScroll.NONE, x, y);
  const col = idiv(world.x, CELL_Y_SIZE);
  const row = idiv(world.y, CELL_X_SIZE);
  return col >= 0 && col < WORLD_COLS && row >= 0 && row < WORLD_ROWS ? row * WORLD_COLS + col : null;
}

class Painter {
  readonly #world: LoadedWorld;
  readonly #tiles: OverheadTiles;
  readonly #scene: OverheadScene;
  readonly #pixels: Uint16Array;
  readonly #renderLift: number;

  constructor(world: LoadedWorld, tiles: OverheadTiles, scene: OverheadScene, pixels: Uint16Array) {
    this.#world = world;
    this.#tiles = tiles;
    this.#scene = scene;
    this.#pixels = pixels;
    this.#renderLift = idiv(world.prepared.renderHeight, SCALE);
  }

  pass(paint: (g: number, x: number, y: number) => void): void {
    let anchorCol = 0;
    let anchorRow = START_ROW;
    let anchorY = 0;
    let odd = false;
    do {
      let col = anchorCol;
      let row = anchorRow;
      let x = odd ? ODD_SHIFT : 0;
      do {
        const g = row * WORLD_COLS + col;
        if (g >= 0 && g < WORLD_MAX) paint(g, x, anchorY);
        x += STEP_X;
        col++;
        row--;
      } while (x < OVERHEAD_WIDTH);
      if (odd) anchorRow++;
      else anchorCol++;
      odd = !odd;
      anchorY += STEP_Y;
    } while (anchorY < OVERHEAD_HEIGHT);
  }

  #height(g: number): number {
    return this.#world.level.heights[g] ?? 0;
  }

  land(g: number, x: number, y: number): void {
    const scene = this.#scene;
    const tiles = levelTilesAt(scene.level.layers.land, g);
    const top = y - idiv(this.#height(g), SCALE) + this.#renderLift;
    const shade = scene.shade.land[g] ?? 0;
    for (let i = scene.prepared.landStart[g] ?? -1; i >= 0; i--) this.#blit(tiles[i] ?? 0, x, top, shade);
  }

  middle(g: number, x: number, y: number): void {
    const scene = this.#scene;
    const height = idiv(this.#height(g), SCALE);
    const modified = idiv(modifiedHeight(this.#height(g)), SCALE);
    const layers = scene.level.layers;
    const shade = scene.shade.land[g] ?? 0;
    for (const tile of levelTilesAt(layers.objects, g))
      this.#blit(tile, x, y - this.#lift(tile, height, modified) + this.#renderLift, shade);
    for (const tile of levelTilesAt(scene.prepared.shadows, g)) this.#shadow(tile, x, y - height + this.#renderLift);
    for (const mapTile of levelTilesAt(layers.structs, g)) {
      const tile = openableTileInState(this.#world.tiles, scene.openStructures, g, mapTile);
      this.#blit(tile, x, y - this.#lift(tile, height, modified) + this.#renderLift, shade);
    }
  }

  roofs(g: number, x: number, y: number): void {
    const scene = this.#scene;
    const top = y - idiv(this.#height(g), SCALE) - idiv(WALL_HEIGHT, SCALE) + this.#renderLift;
    const shade = scene.shade.roof[g] ?? 0;
    for (const tile of scene.reveal.ceilings(g)) this.#blit(tile, x, top, shade);
    levelTilesAt(scene.level.layers.roofs, g).forEach((tile, index) => {
      if (scene.reveal.nodeFlags('roofs', g, index) & NodeFlags.HIDDEN) return;
      this.#blit(tile, x, top, shade);
    });
  }

  #lift(tile: number, height: number, modified: number): number {
    return (this.#world.tiles[tile]?.flags ?? 0) & TileFlags.IGNORE_WORLD_HEIGHT ? modified : height;
  }

  #blit(tile: number, x: number, y: number, shade: number): void {
    const element = this.#world.tiles[tile];
    const colours = element ? this.#tiles.colours(element.type, shade) : null;
    if (!element || !colours) return;
    this.#paint(element, x, y, (index) => colours[index] ?? 0);
  }

  #shadow(tile: number, x: number, y: number): void {
    const element = this.#world.tiles[tile];
    if (!element) return;
    const pixels = this.#pixels;
    this.#paint(element, x, y, (_index, at) => darken(pixels[at] ?? 0));
  }

  #paint(element: TileElement, x: number, y: number, colour: (index: number, at: number) => number): void {
    const frame = this.#tiles.frameOf(element);
    if (!frame) return;
    const left = x + frame.offsetX;
    const top = y + frame.offsetY;
    const pixels = this.#pixels;
    for (let row = 0; row < frame.height; row++) {
      const py = top + row;
      if (py < 0 || py >= OVERHEAD_HEIGHT) continue;
      for (let col = 0; col < frame.width; col++) {
        const px = left + col;
        if (px < 0 || px >= OVERHEAD_WIDTH) continue;
        const index = frame.pixels[row * frame.width + col] ?? 0;
        if (index === 0) continue;
        const at = py * OVERHEAD_WIDTH + px;
        pixels[at] = colour(index, at);
      }
    }
  }
}
