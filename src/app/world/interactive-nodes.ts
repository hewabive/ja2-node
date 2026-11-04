// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc CalcRenderParameters, RenderTiles (the tiles the dynamic pass sweeps for the
// @src interactive tile check: the viewport grown by a tile width across and two tile heights up and down, rows down the
// @src screen, each left to right, a tile index out of a row wrapping to the next); src/game/TileEngine/Interactive_Tiles.cc
// @src LogMouseOverInteractiveTile (the struct nodes of a tile, head first), GetLevelNodeScreenRect (from the tile's
// @src corner and its raw height, ten pixels below where the picture is drawn), RefinePointCollisionOnStruct,
// @src CheckVideoObjectScreenCoordinateInData (the pixel left of the pointer, rows counted from the rectangle's top),
// @src RefineLogicOnStruct (openable structures; a door while IsDoorVisibleAtGridNo, a switch by the roof beyond its
// @src wall, any other by the roof over it; items on structures are not ported); src/game/Tactical/Structure_Wrap.cc
// @src IsDoorVisibleAtGridNo; src/game/TileEngine/WorldMan.cc IsRoofVisible, IsRoofVisible2.

import type { StructureDef } from '../../content/formats/jsd.ts';
import type { IndexedFrame } from '../../content/picture/picture.ts';
import {
  CELL_X_SIZE,
  CELL_Y_SIZE,
  DIRECTION_INCREMENT,
  Direction,
  newGridNo,
  WORLD_COLS,
  WORLD_MAX,
  WORLD_TILE_X,
  WORLD_TILE_Y,
} from '../../content/world/grid.ts';
import { type Level, levelTilesAt } from '../../content/world/level.ts';
import { has, ORIENT_LEFT, ORIENT_RIGHT, StructureFlags, type WorldStructures } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { idiv } from '../../core/int.ts';
import { animatedTile } from '../../render/world/dynamic-scene.ts';
import { type Camera, mapCenter, type Viewport } from '../../render/world/geometry.ts';
import { openableTileInState } from '../../render/world/static-scene.ts';
import type { TileSurfacePicture } from '../../render/world/world-sprites.ts';
import type { InteractiveNode, InteractiveNodeRef, InteractiveTile } from '../../ui/screens/tactical/environment.ts';

export interface InteractiveWorld {
  readonly level: Level;
  readonly tiles: readonly TileElement[];
  readonly surfaces: readonly (TileSurfacePicture | null)[];
  readonly structures: WorldStructures;
  readonly revealed: Uint8Array;
  readonly openStructures: ReadonlySet<number>;
  readonly basement: boolean;
}

export interface InteractiveScreen {
  readonly viewport: Viewport;
  readonly camera: Camera;
  readonly renderHeight: number;
  readonly animationStep: number;
}

export interface PixelRows {
  readonly width: number;
  readonly pixels: Uint8Array;
}

interface Sweep {
  readonly tileX: number;
  readonly tileY: number;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
}

interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const SWEEP_MARGIN_X = WORLD_TILE_X;
const SWEEP_MARGIN_Y = WORLD_TILE_Y * 2;
const SWEEP_ROW_STEP = WORLD_TILE_Y / 2;
const ODD_ROW_SHIFT = WORLD_TILE_X / 2;
const HALF_TILE_WIDTH = 2;
const HALF_TILE_HEIGHT = 1;
const TRANSPARENT = 0;
const PIXEL_BEFORE_POINTER = 1;
const INTERACTIVE = StructureFlags.OPENABLE;

export function pictureHasDataAt(picture: PixelRows, x: number, y: number): boolean {
  const index = y * picture.width + x - PIXEL_BEFORE_POINTER;
  return index >= 0 && index < picture.pixels.length && picture.pixels[index] !== TRANSPARENT;
}

function dynamicSweep(viewport: Viewport, camera: Camera): Sweep {
  const centre = mapCenter(viewport);
  const fromX = centre.x + SWEEP_MARGIN_X;
  const fromY = centre.y + SWEEP_MARGIN_Y;
  const cellX = Math.floor((fromX / HALF_TILE_WIDTH + fromY / HALF_TILE_HEIGHT) / 2);
  const cellY = Math.floor((fromY / HALF_TILE_HEIGHT - fromX / HALF_TILE_WIDTH) / 2);
  const worldX = camera.centerX - cellX + CELL_X_SIZE;
  const worldY = camera.centerY - cellY;
  const tileX = Math.floor(worldX / CELL_X_SIZE);
  const tileY = Math.floor(worldY / CELL_Y_SIZE);
  const restX = worldX - tileX * CELL_X_SIZE;
  const restY = worldY - tileY * CELL_Y_SIZE;
  return {
    tileX,
    tileY,
    startX: -SWEEP_MARGIN_X - (restX - restY) * HALF_TILE_WIDTH,
    startY: -SWEEP_MARGIN_Y - (restX + restY) * HALF_TILE_HEIGHT,
    endX: viewport.width + SWEEP_MARGIN_X,
    endY: viewport.height + SWEEP_MARGIN_Y,
  };
}

export function sweptTiles(viewport: Viewport, camera: Camera, visit: (g: number) => void): void {
  const sweep = dynamicSweep(viewport, camera);
  let anchorX = sweep.tileX;
  let anchorY = sweep.tileY;
  let rowY = sweep.startY;
  let odd = false;
  do {
    let x = anchorX;
    let y = anchorY;
    let screenX = sweep.startX + (odd ? ODD_ROW_SHIFT : 0);
    do {
      const g = y * WORLD_COLS + x;
      if (g >= 0 && g < WORLD_MAX) visit(g);
      screenX += WORLD_TILE_X;
      x++;
      y--;
    } while (screenX < sweep.endX);
    if (odd) anchorY++;
    else anchorX++;
    odd = !odd;
    rowY += SWEEP_ROW_STEP;
  } while (rowY < sweep.endY);
}

function nodeRect(screen: InteractiveScreen, g: number, picture: IndexedFrame, height: number): ScreenRect {
  const centre = mapCenter(screen.viewport);
  const dx = (g % WORLD_COLS) * CELL_X_SIZE - screen.camera.centerX;
  const dy = idiv(g, WORLD_COLS) * CELL_Y_SIZE - screen.camera.centerY;
  const left = centre.x + (dx - dy) * HALF_TILE_WIDTH + picture.offsetX - WORLD_TILE_X / 2;
  const top = centre.y + (dx + dy) * HALF_TILE_HEIGHT - height + screen.renderHeight + picture.offsetY;
  return { left, top, right: left + picture.width, bottom: top + picture.height };
}

function inRect(x: number, y: number, r: ScreenRect): boolean {
  return r.left <= x && x <= r.right && r.top <= y && y <= r.bottom;
}

function roofVisible(w: InteractiveWorld, g: number): boolean {
  return w.structures.find(g, StructureFlags.ROOF) !== null && w.revealed[g] !== 1;
}

function roofVisibleOrBasement(w: InteractiveWorld, g: number): boolean {
  if (!w.basement && w.structures.find(g, StructureFlags.ROOF) === null) return false;
  return w.revealed[g] !== 1;
}

function beside(g: number, direction: number): number {
  return newGridNo(g, DIRECTION_INCREMENT[direction] ?? 0);
}

function doorVisibleAt(w: InteractiveWorld, g: number): boolean {
  const door = w.structures.find(g, StructureFlags.ANYDOOR);
  if (!door) return true;
  const [first, second] = door.wallOrientation & ORIENT_LEFT ? [Direction.NORTH, Direction.SOUTH] : [Direction.WEST, Direction.EAST];
  return !(roofVisibleOrBasement(w, beside(g, first)) && roofVisibleOrBasement(w, beside(g, second)));
}

function switchSide(def: StructureDef, g: number): number | null {
  if (def.wallOrientation & ORIENT_LEFT) return beside(g, Direction.SOUTH);
  if (def.wallOrientation & ORIENT_RIGHT) return beside(g, Direction.EAST);
  return null;
}

function shownOnItsTile(w: InteractiveWorld, g: number, def: StructureDef): boolean {
  if (has(def.flags, StructureFlags.ANYDOOR)) return doorVisibleAt(w, g);
  let under = g;
  if (has(def.flags, StructureFlags.SWITCH)) {
    const side = switchSide(def, g);
    if (side === null) return true;
    under = side;
  }
  return w.basement || !roofVisible(w, under);
}

function shownTile(w: InteractiveWorld, g: number, mapTile: number): number {
  return openableTileInState(w.tiles, w.openStructures, g, mapTile);
}

export function interactiveNodesAt(w: InteractiveWorld, screen: InteractiveScreen, pointerX: number, pointerY: number): InteractiveNode[] {
  const x = Math.floor(pointerX);
  const y = Math.floor(pointerY);
  const structs = w.level.layers.structs;
  const found: InteractiveNode[] = [];
  sweptTiles(screen.viewport, screen.camera, (g) => {
    if (structs.offsets[g] === structs.offsets[g + 1]) return;
    levelTilesAt(structs, g).forEach((mapTile, index) => {
      const tile = shownTile(w, g, mapTile);
      const def = w.tiles[tile]?.structure;
      if (!def || !has(def.flags, INTERACTIVE)) return;
      const drawn = w.tiles[animatedTile(w.tiles, tile, screen.animationStep)];
      const picture = drawn ? w.surfaces[drawn.type]?.picture.frames[drawn.regionIndex] : undefined;
      if (!picture) return;
      const rect = nodeRect(screen, g, picture, w.level.heights[g] ?? 0);
      if (!inRect(x, y, rect) || !pictureHasDataAt(picture, x - rect.left, y - rect.top)) return;
      if (!shownOnItsTile(w, g, def)) return;
      found.push({
        gridNo: g,
        index,
        tile: mapTile,
        bottom: rect.bottom,
        door: has(def.flags, StructureFlags.ANYDOOR),
        open: has(def.flags, StructureFlags.OPEN),
      });
    });
  });
  return found;
}

export function interactiveTileOf(w: InteractiveWorld, node: InteractiveNodeRef): InteractiveTile | null {
  if (levelTilesAt(w.level.layers.structs, node.gridNo)[node.index] !== node.tile) return null;
  const def = w.tiles[shownTile(w, node.gridNo, node.tile)]?.structure;
  if (!def) return null;
  return {
    gridNo: node.gridNo,
    door: has(def.flags, StructureFlags.ANYDOOR),
    switch: has(def.flags, StructureFlags.SWITCH),
    open: has(def.flags, StructureFlags.OPEN),
  };
}
