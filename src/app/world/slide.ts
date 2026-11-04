// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Find.cc SoldierLocationRelativeToScreen (the direction from the render centre, the
// @src scroll flags against the screen centre, which leaves out the map's left and top edges the target's position
// @src includes, and the on-screen test without the top allowance), GridNoOnScreen; src/game/TileEngine/
// @src Isometric_Utils.cc GridNoOnVisibleWorldTile; src/game/Tactical/Soldier_Control.cc atan8.

import { CELL_X_SIZE, CELL_Y_SIZE, WORLD_COLS } from '../../content/world/grid.ts';
import { absoluteScreenXY, gridNoOnVisibleWorldTile } from '../../content/world/render-bounds.ts';
import { idiv } from '../../core/int.ts';
import type { Camera } from '../../render/world/geometry.ts';
import { atan8 } from '../../sim/tactical/perception/opp.ts';
import { ScrollFlag, type SlideView } from '../../ui/screens/tactical/environment.ts';
import { gridNoOnScreen, type ViewOnMap, visibleWorldBox } from './radar.ts';

const CENTER_WORLD_X = 800;
const CENTER_WORLD_Y = 800;
const MAP_CENTER_SCREEN_X = 0;
const MAP_CENTER_SCREEN_Y = 1625;
const HALF_TILE_WIDTH = 2;
const HALF_TILE_HEIGHT = 1;
const SCREEN_CENTRE_LIFT = 10;
const CENTRE_DEAD_ZONE = 20;
const IN_VIEW_BOTTOM_ALLOWANCE = 20;

function tileCentre(gridNo: number): { x: number; y: number } {
  return {
    x: (gridNo % WORLD_COLS) * CELL_X_SIZE + CELL_X_SIZE / 2,
    y: idiv(gridNo, WORLD_COLS) * CELL_Y_SIZE + CELL_Y_SIZE / 2,
  };
}

function inView(restrictedScrollId: number, gridNo: number, o: ViewOnMap): boolean {
  const box = visibleWorldBox(restrictedScrollId, o);
  const at = absoluteScreenXY(restrictedScrollId, gridNo);
  return at.x >= box.x1 && at.x <= box.x2 && at.y >= box.y1 && at.y <= box.y2 + IN_VIEW_BOTTOM_ALLOWANCE;
}

function screenCentre(camera: Camera): { x: number; y: number } {
  const dx = camera.centerX - CENTER_WORLD_X;
  const dy = camera.centerY - CENTER_WORLD_Y;
  return {
    x: (dx - dy) * HALF_TILE_WIDTH + MAP_CENTER_SCREEN_X,
    y: (dx + dy) * HALF_TILE_HEIGHT + MAP_CENTER_SCREEN_Y + SCREEN_CENTRE_LIFT,
  };
}

function centreFlags(restrictedScrollId: number, gridNo: number, camera: Camera): number {
  const at = absoluteScreenXY(restrictedScrollId, gridNo);
  const centre = screenCentre(camera);
  let flags = 0;
  if (at.x > centre.x + CENTRE_DEAD_ZONE) flags |= ScrollFlag.RIGHT;
  if (at.x < centre.x - CENTRE_DEAD_ZONE) flags |= ScrollFlag.LEFT;
  if (at.y > centre.y + CENTRE_DEAD_ZONE) flags |= ScrollFlag.DOWN;
  if (at.y < centre.y - CENTRE_DEAD_ZONE) flags |= ScrollFlag.UP;
  return flags;
}

export function slideView(restrictedScrollId: number, gridNo: number, o: ViewOnMap, underTopBar: boolean): SlideView {
  const target = tileCentre(gridNo);
  return {
    onScreen: gridNoOnScreen(restrictedScrollId, gridNo, o, underTopBar),
    inView: inView(restrictedScrollId, gridNo, o),
    visibleTile: gridNoOnVisibleWorldTile(restrictedScrollId, gridNo),
    direction: atan8(o.camera.centerX, o.camera.centerY, target.x, target.y),
    centreFlags: centreFlags(restrictedScrollId, gridNo, o.camera),
  };
}
