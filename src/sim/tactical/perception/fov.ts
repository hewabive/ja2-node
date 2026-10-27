// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/FOV.cc RevealRoofsAndItems (with UpdateBloodGraphics), BuildSightDir, ViewPath, ViewPath2; TileEngine/Structure.cc
// @src GetBlockingStructureInfo, GetTallestStructureHeight; TileEngine/Render_Fun.cc InAHiddenRoom, RemoveRoomRoof.
// See docs/08 §5.

import { DIRECTION_INCREMENT, Direction, newGridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { isDoorTravelCost, TravelCost } from '../../../content/world/movement-costs.ts';
import {
  has,
  ORIENT_LEFT,
  STRUCTURE_ON_GROUND,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  structureHeight,
} from '../../../content/world/structures.ts';
import { adjustMaxSightRangeForEnvEffects, lightTrueLevel } from '../lighting/lighting.ts';
import { doorTravelCost } from '../points.ts';
import { updateBloodGraphics } from '../smell.ts';
import { OKLIFE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { setItemsVisibilityOn, Visibility } from '../world-items.ts';

const GASSED_VIEW_RANGE = 1;
const DLEFT = 0;
const DRIGHT = 1;
const UP = 2;
const LEFT = 3;
const RIGHT = 4;
const NOVIEW = 5;
const NO_NEXT = 99;
const NORMAL_VIEW_RANGE = 13;
const NO_ROOM = 0;
const MAX_ROOMS = 256;

const Blocking = {
  NOTHING: 0,
  REDUCE_RANGE: 1,
  NEXT_TILE: 10,
  TOPLEFT_WINDOW: 30,
  TOPRIGHT_WINDOW: 40,
  TOPLEFT_DOOR: 50,
  TOPRIGHT_DOOR: 60,
  FULL: 70,
  TOPLEFT_OPEN_WINDOW: 90,
  TOPRIGHT_OPEN_WINDOW: 100,
} as const;

const PASS_THROUGH_BLOCKING: ReadonlySet<number> = new Set([
  Blocking.NOTHING,
  Blocking.TOPLEFT_DOOR,
  Blocking.TOPRIGHT_DOOR,
  Blocking.TOPLEFT_WINDOW,
  Blocking.TOPRIGHT_WINDOW,
  Blocking.TOPRIGHT_OPEN_WINDOW,
  Blocking.TOPLEFT_OPEN_WINDOW,
]);

const U = UP;
const L = DLEFT;
const R = DRIGHT;
const N = NOVIEW;
const VIEW_PATH: readonly (readonly number[])[] = [
  [N, U, U, U, U, U, U, U, U, U, U, U, U],
  [U, U, U, U, R, U, U, U, U, U, U, U, U],
  [U, U, U, U, L, U, U, U, U, U, U, U, U],
  [U, U, L, U, L, U, U, U, U, U, U, U, U],
  [U, U, R, U, R, U, U, U, U, U, U, U, U],
  [U, U, R, R, R, U, U, U, U, U, U, U, U],
  [U, U, L, L, L, U, U, U, U, U, U, U, U],
  [U, RIGHT, U, R, R, R, U, U, U, U, U, U, U],
  [U, LEFT, U, L, L, L, U, U, U, U, U, U, U],
  [L, L, L, L, L, U, U, U, U, U, U, U, U],
  [R, R, R, R, R, U, U, U, U, U, U, U, U],
  [RIGHT, R, R, R, R, R, U, U, U, U, U, U, U],
  [LEFT, L, L, L, L, L, U, U, U, U, U, U, U],
  [L, LEFT, LEFT, U, N, N, N, N, N, N, N, N, N],
  [LEFT, LEFT, LEFT, U, LEFT, N, N, N, N, N, N, N, N],
  [R, RIGHT, RIGHT, U, N, N, N, N, N, N, N, N, N],
  [RIGHT, RIGHT, RIGHT, U, RIGHT, N, N, N, N, N, N, N, N],
];
const VIEW_PATH_2: readonly (readonly number[])[] = [
  [N, U, U, U, U, U, U, N, N, N, N, N, N],
  [U, U, L, U, U, U, L, R, N, N, N, N, N],
  [U, U, L, U, U, U, R, L, N, N, N, N, N],
  [U, U, L, U, U, L, L, U, N, N, N, N, N],
  [U, U, R, U, U, R, R, U, N, N, N, N, N],
  [U, L, U, U, L, L, L, U, U, U, U, U, U],
  [U, R, U, U, R, R, R, U, U, U, U, U, U],
  [L, L, U, U, L, L, L, U, U, U, U, U, U],
  [R, R, U, U, R, R, R, U, U, U, U, U, U],
  [L, L, U, L, L, L, L, U, U, U, U, U, U],
  [R, R, U, R, R, R, R, U, U, U, U, U, U],
  [L, L, L, L, L, L, L, U, U, U, U, U, U],
  [R, R, R, R, R, R, R, U, U, U, U, U, U],
  [L, LEFT, L, N, N, N, N, N, N, N, N, N, N],
  [R, RIGHT, R, N, N, N, N, N, N, N, N, N, N],
  [LEFT, LEFT, L, N, N, N, N, N, N, N, N, N, N],
  [RIGHT, RIGHT, R, N, N, N, N, N, N, N, N, N, N],
];

const { NORTH, NORTHEAST, EAST, SOUTHEAST, SOUTH, SOUTHWEST, WEST, NORTHWEST } = Direction;
const SIGHT_DIRS: readonly (readonly number[])[] = [
  [NORTHWEST, NORTHEAST, NORTH, WEST, EAST],
  [NORTH, EAST, NORTHEAST, NORTHWEST, SOUTHEAST],
  [NORTHEAST, SOUTHEAST, EAST, NORTH, SOUTH],
  [EAST, SOUTH, SOUTHEAST, NORTHEAST, SOUTHWEST],
  [SOUTHEAST, SOUTHWEST, SOUTH, EAST, WEST],
  [SOUTH, WEST, SOUTHWEST, SOUTHEAST, NORTHWEST],
  [SOUTHWEST, NORTHWEST, WEST, SOUTH, NORTH],
  [WEST, NORTH, NORTHWEST, SOUTHWEST, NORTHEAST],
];

export interface FogOfWar {
  readonly roomHidden: Uint8Array;
  readonly revealed: Uint8Array;
  readonly markers: Uint8Array;
  markerValue: number;
}

export const RevealedFlags = { GROUND: 0x01, ROOF: 0x02 } as const;

export function createFogOfWar(): FogOfWar {
  return {
    roomHidden: new Uint8Array(MAX_ROOMS).fill(1),
    revealed: new Uint8Array(WORLD_MAX),
    markers: new Uint8Array(WORLD_MAX),
    markerValue: 254,
  };
}

function tallestGroundStructure(t: TacticalState, g: number): number {
  let tallest = 0;
  for (const s of t.world.structures.at(g)) {
    if (s.cubeOffset !== STRUCTURE_ON_GROUND || has(s.flags, StructureFlags.NORMAL_ROOF)) continue;
    tallest = Math.max(tallest, structureHeight(s));
  }
  return tallest;
}

function blockingStructureInfo(t: TacticalState, g: number, level: number): number {
  const desired = level === 0 ? STRUCTURE_ON_GROUND : STRUCTURE_ON_ROOF;
  const list = t.world.structures.at(g);
  if (list.length === 0) return Blocking.NOTHING;
  let okOnLevel = false;
  let minimum = false;
  for (const s of list) {
    if (s.cubeOffset !== desired) continue;
    okOnLevel = true;
    if (has(s.flags, StructureFlags.ROOF) && level === 1) okOnLevel = false;
    if (has(s.flags, StructureFlags.CORPSE | StructureFlags.PERSON)) okOnLevel = false;
    if (has(s.flags, StructureFlags.TREE | StructureFlags.ANYFENCE)) minimum = true;
    if (has(s.flags, StructureFlags.WALL)) okOnLevel = false;
    if (has(s.flags, StructureFlags.WALLNWINDOW)) {
      const open = has(s.flags, StructureFlags.OPEN);
      if (s.wallOrientation & ORIENT_LEFT) return open ? Blocking.TOPLEFT_OPEN_WINDOW : Blocking.TOPLEFT_WINDOW;
      return open ? Blocking.TOPRIGHT_OPEN_WINDOW : Blocking.TOPRIGHT_WINDOW;
    }
    if (has(s.flags, StructureFlags.ANYDOOR)) {
      if (!has(s.flags, StructureFlags.OPEN)) return Blocking.FULL;
      return s.wallOrientation & ORIENT_LEFT ? Blocking.TOPLEFT_DOOR : Blocking.TOPRIGHT_DOOR;
    }
  }
  if ((t.occupant[level > 0 ? 1 : 0][g] ?? -1) >= 0) okOnLevel = false;
  if (!okOnLevel) return Blocking.NOTHING;
  return minimum ? Blocking.REDUCE_RANGE : Blocking.NEXT_TILE;
}

function removeRoomRoof(t: TacticalState, room: number): void {
  const fog = t.fog;
  const rooms = t.world.level.rooms;
  for (let g = 0; g < WORLD_MAX; g++) if (rooms[g] === room) fog.revealed[g] = (fog.revealed[g] ?? 0) | RevealedFlags.GROUND;
  fog.roomHidden[room] = 0;
  t.events.push({ type: 'roomRevealed', room });
}

export function revealRoofsAndItems(t: TacticalState, s: Soldier, showLocators: boolean): void {
  if (s.team !== Team.OUR || !s.placed || s.life < OKLIFE) return;
  const fog = t.fog;
  fog.markerValue++;
  if (fog.markerValue === 255) {
    fog.markers.fill(0);
    fog.markerValue = 1;
  }
  const level = s.level;
  const range = t.explosives.gassed[s.id]
    ? GASSED_VIEW_RANGE
    : Math.trunc((adjustMaxSightRangeForEnvEffects(lightTrueLevel(t, s.gridNo, level), NORMAL_VIEW_RANGE) + NORMAL_VIEW_RANGE) / 2);
  const dirs = [...(SIGHT_DIRS[s.direction] ?? SIGHT_DIRS[0] ?? []), s.direction];
  const incs = [...dirs.slice(0, 5).map((d) => DIRECTION_INCREMENT[d] ?? 0), 0];
  const table = s.direction % 2 === 1 ? VIEW_PATH_2 : VIEW_PATH;
  let goneThroughDoor = 0;
  let throughWindow = 0;
  let throughWindowDirection = -1;
  const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
  for (const path of table) {
    let marker = s.gridNo;
    let tilesLeftToSee = 99;
    let revealItems = true;
    let stopRevealingItemsAfterThisTile = false;
    for (let k = 0; k < range; k++) {
      const previous = marker;
      if (stopRevealingItemsAfterThisTile) {
        revealItems = false;
        stopRevealingItemsAfterThisTile = false;
      }
      const markerDir = path[k] ?? NOVIEW;
      let nextDir = k < 12 ? (path[k + 1] ?? NO_NEXT) : NO_NEXT;
      let travelCostObstacle = false;
      if (throughWindow === 1) {
        throughWindow = dirs[markerDir] === throughWindowDirection ? 2 : 0;
      } else if (throughWindow === 2) throughWindow = 0;
      if (goneThroughDoor === 1) goneThroughDoor = 2;
      else if (goneThroughDoor === 2) goneThroughDoor = 0;
      if (nextDir === NOVIEW) nextDir = NO_NEXT;
      marker = newGridNo(marker, incs[markerDir] ?? 0);
      if (markerDir === NOVIEW && k !== 0) break;
      const dir = dirs[markerDir] ?? s.direction;
      let cost = t.world.costs.get(marker, dir, level);
      if (isDoorTravelCost(cost)) cost = doorTravelCost(ctx, s, marker, cost, true, false);
      if (cost >= TravelCost.BLOCKED) {
        const tallest = tallestGroundStructure(t, marker);
        if (cost === TravelCost.WALL || cost === TravelCost.DOOR || cost === TravelCost.EXITGRID) {
          travelCostObstacle = true;
          revealItems = false;
        } else if (tallest >= 3) {
          travelCostObstacle = true;
          stopRevealingItemsAfterThisTile = true;
        } else if (tallest !== 0) stopRevealingItemsAfterThisTile = true;
        if (dir % 2 === 1) {
          travelCostObstacle = true;
          revealItems = false;
        } else if (tallest >= 3) {
          travelCostObstacle = true;
          stopRevealingItemsAfterThisTile = true;
        } else if (tallest !== 0) stopRevealingItemsAfterThisTile = true;
      }
      if (fog.markers[marker] !== fog.markerValue) {
        fog.markers[marker] = fog.markerValue;
        if (marker === previous && k !== 0) continue;
        if (goneThroughDoor && k > 5) break;
        const blocking = blockingStructureInfo(t, marker, level);
        if (
          (blocking === Blocking.TOPLEFT_WINDOW || blocking === Blocking.TOPLEFT_OPEN_WINDOW) &&
          (dir === NORTH || dir === SOUTH) &&
          k <= 1
        ) {
          throughWindow = 1;
          throughWindowDirection = dir;
        }
        if (
          (blocking === Blocking.TOPRIGHT_WINDOW || blocking === Blocking.TOPRIGHT_OPEN_WINDOW) &&
          (dir === EAST || dir === WEST) &&
          k <= 1
        ) {
          throughWindow = 1;
          throughWindowDirection = dir;
        }
        if (blocking === Blocking.TOPLEFT_DOOR || blocking === Blocking.TOPRIGHT_DOOR) goneThroughDoor = 1;
        if (revealItems && setItemsVisibilityOn(t, marker, level, Visibility.INVISIBLE, showLocators) && showLocators && t.inCombat)
          t.perceptionHooks.haltFromItemSighting(s);
        tilesLeftToSee--;
        if (tilesLeftToSee <= 0) break;
        if (blocking === Blocking.FULL || (travelCostObstacle && !throughWindow)) break;
        if (level === 0) {
          fog.revealed[marker] = (fog.revealed[marker] ?? 0) | RevealedFlags.GROUND;
          const room = t.world.level.rooms[marker] ?? NO_ROOM;
          if (room !== NO_ROOM && fog.roomHidden[room]) removeRoomRoof(t, room);
        } else fog.revealed[marker] = (fog.revealed[marker] ?? 0) | RevealedFlags.ROOF;
        updateBloodGraphics(t, marker, level);
        if (!PASS_THROUGH_BLOCKING.has(blocking)) break;
      } else if (travelCostObstacle) break;
    }
  }
}

export function revealedRooms(t: TacticalState): number[] {
  const rooms: number[] = [];
  for (let r = 1; r < MAX_ROOMS; r++) if (!t.fog.roomHidden[r]) rooms.push(r);
  return rooms;
}
