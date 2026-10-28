// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Overhead_Map.cc InitNewOverheadDB (the small tiles from the tileset's t/ folder, grass.sti of
// @src the default tileset when one is missing, sub-image 0 for the regions a small file lacks), RenderOverheadMap (the
// @src three passes over the 640 × 320 area in 8 × 2 steps with the odd rows shifted by 4: land from its start node,
// @src then objects, shadows and structures with IGNORE_WORLD_HEIGHT using the modified height, then roofs lifted by
// @src WALL_HEIGHT / 5), GetOverheadScreenXYFromGridNo, InternalGetOverheadMouseGridNo (the -8 row adjustment and the
// @src land height correction); src/game/TileEngine/Isometric_Utils.cc GetMapPosFromAbsoluteScreenXY; src/sgp/Shading.cc
// @src BuildShadeTable (the shadow blit). Restricted maps keep the unrestricted origin.

import { decodeSti, type StiIndexed } from '../../content/formats/sti.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { NORMAL_SHADE, SHADOW_FACTOR, shadedPalette565 } from '../../content/world/shading.ts';
import { TileFlags } from '../../content/world/tile-database.ts';
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
const ABS_LEFT_X = 1580;
const ABS_TOP_Y = 860;
const CELL = 10;
const FALLBACK_SMALL = 'tilesets/0/t/grass.sti';

interface SmallTile {
  readonly sti: StiIndexed;
  readonly colours: Uint16Array;
}

export interface OverheadPictureSink {
  addRgb(key: string, width: number, height: number, pixels: Uint16Array): void;
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
  return Math.max(0, (Math.trunc(height / CLIFF_STEP) - 1) * CLIFF_STEP);
}

export async function loadSmallTiles(world: LoadedWorld, available: ReadonlySet<string>, read: ReadVfsFile): Promise<(SmallTile | null)[]> {
  const light = mapLightColour(world.map);
  const cache = new Map<string, Promise<SmallTile | null>>();
  const load = (path: string): Promise<SmallTile | null> => {
    const known = cache.get(path);
    if (known) return known;
    const next = (async () => {
      const chosen = available.has(path) ? path : available.has(FALLBACK_SMALL) ? FALLBACK_SMALL : null;
      if (!chosen) return null;
      const sti = decodeSti(await read(chosen));
      if (sti.kind !== 'indexed') return null;
      return { sti, colours: shadedPalette565(sti.palette, NORMAL_SHADE, light) };
    })();
    cache.set(path, next);
    return next;
  };
  return Promise.all(world.surfaces.map((surface) => (surface ? load(smallPathOf(surface.path)) : Promise.resolve(null))));
}

export class OverheadPicture implements OverheadMapView {
  readonly key: string;
  readonly #world: LoadedWorld;

  constructor(key: string, world: LoadedWorld) {
    this.key = key;
    this.#world = world;
  }

  static compose(key: string, world: LoadedWorld, small: readonly (SmallTile | null)[], sink: OverheadPictureSink): OverheadPicture {
    const pixels = new Uint16Array(OVERHEAD_WIDTH * OVERHEAD_HEIGHT);
    const painter = new Painter(world, small, pixels);
    painter.pass((g, x, y) => painter.land(g, x, y));
    painter.pass((g, x, y) => painter.middle(g, x, y));
    painter.pass((g, x, y) => painter.roofs(g, x, y));
    sink.addRgb(key, OVERHEAD_WIDTH, OVERHEAD_HEIGHT, pixels);
    return new OverheadPicture(key, world);
  }

  render(list: DrawList, x: number, y: number): void {
    list.image(this.key, 0, x, y);
  }

  pointOf(gridNo: number): ScreenPoint {
    const at = absoluteOfGridNo(gridNo);
    const height = this.#world.level.heights[gridNo] ?? 0;
    return {
      x: Math.trunc(at.x / SCALE) + EDGE,
      y: Math.trunc(at.y / SCALE) + EDGE - Math.trunc(height / SCALE) + Math.trunc(this.#world.prepared.renderHeight / SCALE),
    };
  }

  gridNoAt(x: number, y: number): number | null {
    const worldX = (x - EDGE) * SCALE;
    let worldY = (y + MOUSE_ROW_ADJUST) * SCALE;
    const first = gridNoFromAbsolute(worldX, worldY);
    if (first === null) return null;
    worldY += (this.#world.level.heights[first] ?? 0) - this.#world.prepared.renderHeight;
    return gridNoFromAbsolute(worldX, worldY);
  }
}

function absoluteOfGridNo(gridNo: number): ScreenPoint {
  const cellX = (gridNo % WORLD_COLS) * CELL;
  const cellY = Math.floor(gridNo / WORLD_COLS) * CELL;
  return { x: 2 * (cellX - cellY) + ABS_LEFT_X, y: cellX + cellY - ABS_TOP_Y };
}

function gridNoFromAbsolute(x: number, y: number): number | null {
  const dx = x - ABS_LEFT_X;
  const dy = y + ABS_TOP_Y;
  const cellX = Math.trunc((dx + 2 * dy) / 4);
  const cellY = Math.trunc((2 * dy - dx) / 4);
  if (cellX < 0 || cellY < 0) return null;
  const g = Math.trunc(cellY / CELL) * WORLD_COLS + Math.trunc(cellX / CELL);
  return g >= 0 && g < WORLD_MAX && Math.trunc(cellX / CELL) < WORLD_COLS ? g : null;
}

class Painter {
  readonly #world: LoadedWorld;
  readonly #small: readonly (SmallTile | null)[];
  readonly #pixels: Uint16Array;
  readonly #renderLift: number;

  constructor(world: LoadedWorld, small: readonly (SmallTile | null)[], pixels: Uint16Array) {
    this.#world = world;
    this.#small = small;
    this.#pixels = pixels;
    this.#renderLift = Math.trunc(world.prepared.renderHeight / SCALE);
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
    const tiles = levelTilesAt(this.#world.level.layers.land, g);
    const top = y - Math.trunc(this.#height(g) / SCALE) + this.#renderLift;
    for (let i = this.#world.prepared.landStart[g] ?? -1; i >= 0; i--) this.#blit(tiles[i] ?? 0, x, top, false);
  }

  middle(g: number, x: number, y: number): void {
    const height = Math.trunc(this.#height(g) / SCALE);
    const modified = Math.trunc(modifiedHeight(this.#height(g)) / SCALE);
    const layers = this.#world.level.layers;
    for (const tile of levelTilesAt(layers.objects, g))
      this.#blit(tile, x, y - this.#lift(tile, height, modified) + this.#renderLift, false);
    for (const tile of levelTilesAt(layers.shadows, g)) this.#blit(tile, x, y - height + this.#renderLift, true);
    for (const tile of levelTilesAt(layers.structs, g))
      this.#blit(tile, x, y - this.#lift(tile, height, modified) + this.#renderLift, false);
  }

  roofs(g: number, x: number, y: number): void {
    const top = y - Math.trunc(this.#height(g) / SCALE) - Math.trunc(WALL_HEIGHT / SCALE) + this.#renderLift;
    for (const tile of levelTilesAt(this.#world.level.layers.roofs, g)) this.#blit(tile, x, top, false);
  }

  #lift(tile: number, height: number, modified: number): number {
    return (this.#world.tiles[tile]?.flags ?? 0) & TileFlags.IGNORE_WORLD_HEIGHT ? modified : height;
  }

  #blit(tile: number, x: number, y: number, shadow: boolean): void {
    const element = this.#world.tiles[tile];
    const small = element ? this.#small[element.type] : null;
    if (!element || !small) return;
    const frame = small.sti.subImages[element.regionIndex] ?? small.sti.subImages[0];
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
        pixels[at] = shadow ? darken(pixels[at] ?? 0) : (small.colours[index] ?? 0);
      }
    }
  }
}
