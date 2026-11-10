// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/FOV.cc RevealRoofsAndItems (with UpdateBloodGraphics; MercLooksForDoors 2026-11-01), BuildSightDir,
// @src ViewPath, ViewPath2; TileEngine/Structure.cc
// @src GetBlockingStructureInfo, GetTallestStructureHeight; TileEngine/Render_Fun.cc InAHiddenRoom, RemoveRoomRoof (with
// @src SetGridNoRevealedFlag and the spotted-something quote; without a soldier for the REVEAL_ROOM action item 2026-11-04);
// @src Tactical/Handle_Items.cc AllSoldiersLookforItems;
// @src TileEngine/SaveLoadMap.cc SetMapRevealedStatus (with ExamineSlantRoofFOVSlots 2026-11-04; the tiles its
// @src SetGridNoRevealedFlag flags for the picture 2026-11-09); RevealRoofsAndItems' OUR_MERCS_AUTO_MOVE (2026-11-06); the
// @src MAPELEMENT_REVEALED tiles for the picture's wire frames (2026-11-09); TileEngine/Render_Fun.cc
// @src SetRecalculateWireFrameFlagRadius and TileEngine/WorldDef.cc CalculateWorldWireFrameTiles(FALSE) (the tiles a
// @src recalculation flags and the MAPELEMENT_REVEALED tiles it reads then, for the picture, from RemoveRoomRoof and
// @src Explosion_Control.cc SpreadEffect, 2026-11-09).

import { DIRECTION_INCREMENT, Direction, newGridNo, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../../content/world/grid.ts';
import { isDoorTravelCost, TravelCost } from '../../../content/world/movement-costs.ts';
import {
  has,
  ORIENT_LEFT,
  STRUCTURE_ON_GROUND,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  structureHeight,
} from '../../../content/world/structures.ts';
import { idiv } from '../../../core/int.ts';
import { fogChanged } from '../change-counts.ts';
import { mercLooksForDoors } from '../doors/door-status.ts';
import { adjustMaxSightRangeForEnvEffects, lightTrueLevel, switchOnCaveLightAt } from '../lighting/lighting.ts';
import { BOXING_RING } from '../narrative/boxing-state.ts';
import { BOXING_SECTOR } from '../narrative/constants.ts';
import { lookForAndMayCommentOnSeeingCorpse } from '../narrative/corpse-comments.ts';
import { doorTravelCost } from '../points.ts';
import { updateBloodGraphics } from '../smell.ts';
import { Body, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { inCavesOrBasement, mercs, type TacticalState } from '../state.ts';
import { flatRoofAboveGridNo, setItemsVisibilityOn, Visibility } from '../world-items.ts';
import { noticeRevealedItems } from './item-locator.ts';
import { SlantRoofSlots } from './slant-roofs.ts';

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
const ROOM_SURROUNDING_BOXING_RING = 3;
const SPOTTED_SOMETHING_QUOTE = 11;
const SPOTTED_SOMETHING_QUOTES = 2;
const ROOM_REVEAL_WIREFRAME_RADIUS = 2;

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

const PASS_THROUGH_BLOCKING: readonly boolean[] = blockingTable([
  Blocking.NOTHING,
  Blocking.TOPLEFT_DOOR,
  Blocking.TOPRIGHT_DOOR,
  Blocking.TOPLEFT_WINDOW,
  Blocking.TOPRIGHT_WINDOW,
  Blocking.TOPRIGHT_OPEN_WINDOW,
  Blocking.TOPLEFT_OPEN_WINDOW,
]);

function blockingTable(passing: readonly number[]): boolean[] {
  const table = new Array<boolean>(Math.max(...Object.values(Blocking)) + 1).fill(false);
  for (const b of passing) table[b] = true;
  return table;
}

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

interface SightFan {
  readonly dirs: readonly number[];
  readonly incs: readonly number[];
}

function sightFan(direction: number): SightFan {
  const dirs = [...(SIGHT_DIRS[direction] ?? SIGHT_DIRS[0] ?? []), direction];
  return { dirs, incs: [...dirs.slice(0, 5).map((d) => DIRECTION_INCREMENT[d] ?? 0), 0] };
}

const SIGHT_FANS: readonly SightFan[] = SIGHT_DIRS.map((_, direction) => sightFan(direction));

export interface FogOfWar {
  readonly roomHidden: Uint8Array;
  readonly revealed: Uint8Array;
  readonly slantRoofCeilings: Uint8Array;
  readonly revealedAtLoad: Uint8Array;
}

export type TileRun = readonly [first: number, count: number];

export interface ViewMarkers {
  readonly tiles: Uint8Array;
  value: number;
}

export const RevealedFlags = { GROUND: 0x01, ROOF: 0x02 } as const;

const FIRST_MARKER_VALUE = 1;
const LAST_MARKER_VALUE = 254;
const MARKERS_WRAP_AT = 255;

export function createFogOfWar(): FogOfWar {
  return {
    roomHidden: new Uint8Array(MAX_ROOMS).fill(1),
    revealed: new Uint8Array(WORLD_MAX),
    slantRoofCeilings: new Uint8Array(WORLD_MAX),
    revealedAtLoad: new Uint8Array(WORLD_MAX),
  };
}

export function createViewMarkers(): ViewMarkers {
  return { tiles: new Uint8Array(WORLD_MAX), value: LAST_MARKER_VALUE };
}

function nextViewMarker(markers: ViewMarkers): number {
  markers.value++;
  if (markers.value === MARKERS_WRAP_AT) {
    markers.tiles.fill(0);
    markers.value = FIRST_MARKER_VALUE;
  }
  return markers.value;
}

export function groundRevealed(t: TacticalState, g: number): boolean {
  return ((t.fog.revealed[g] ?? 0) & RevealedFlags.GROUND) !== 0;
}

function inBoxingSector(t: TacticalState): boolean {
  return t.sector !== null && t.sector.x === BOXING_SECTOR.x && t.sector.y === BOXING_SECTOR.y && t.sector.z === 0;
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

function setRevealedFlags(t: TacticalState, g: number, flags: number): void {
  if ((t.fog.revealed[g] ?? 0) === flags) return;
  t.fog.revealed[g] = flags;
  fogChanged(t);
}

export function markGroundRevealed(t: TacticalState, g: number): void {
  setRevealedFlags(t, g, (t.fog.revealed[g] ?? 0) | RevealedFlags.GROUND);
}

function revealGround(t: TacticalState, g: number): void {
  markGroundRevealed(t, g);
  switchOnCaveLightAt(t, g);
}

function revealRoof(t: TacticalState, g: number): void {
  setRevealedFlags(t, g, (t.fog.revealed[g] ?? 0) | RevealedFlags.ROOF);
}

function setRoomRevealed(t: TacticalState, room: number): void {
  if (!t.fog.roomHidden[room]) return;
  t.fog.roomHidden[room] = 0;
  fogChanged(t);
}

function setGridNoRevealed(t: TacticalState, g: number): void {
  revealGround(t, g);
  setRoomRevealed(t, t.world.level.rooms[g] ?? NO_ROOM);
}

export function restoreFogOfWar(t: TacticalState, revealed: Uint8Array, roomHidden: Uint8Array): void {
  t.fog.revealed.set(revealed);
  t.fog.roomHidden.set(roomHidden);
  fogChanged(t);
}

export function setMapRevealedStatus(t: TacticalState, revealed: (g: number) => boolean): void {
  for (let g = 0; g < WORLD_MAX; g++) {
    if (revealed(g)) setGridNoRevealed(t, g);
    else setRevealedFlags(t, g, (t.fog.revealed[g] ?? 0) & ~RevealedFlags.GROUND);
  }
  markRevealedAtLoad(t);
  examineSlantRoofsOverRevealedTiles(t);
}

export function markRevealedAtLoad(t: TacticalState): void {
  for (let g = 0; g < WORLD_MAX; g++) t.fog.revealedAtLoad[g] = groundRevealed(t, g) ? 1 : 0;
  fogChanged(t);
}

function tileRuns(tiles: number, inRun: (g: number) => boolean): TileRun[] {
  const runs: [number, number][] = [];
  for (let g = 0; g < tiles; g++) {
    if (!inRun(g)) continue;
    const last = runs.at(-1);
    if (last && last[0] + last[1] === g) last[1]++;
    else runs.push([g, 1]);
  }
  return runs;
}

export function revealedAtLoadRuns(t: TacticalState): TileRun[] {
  return tileRuns(WORLD_MAX, (g) => t.fog.revealedAtLoad[g] === 1);
}

export function revealedTileRuns(t: TacticalState): TileRun[] {
  return tileRuns(WORLD_MAX, (g) => groundRevealed(t, g));
}

function flagWireframesAround(flagged: Set<number>, g: number, radius: number): void {
  const row = idiv(g, WORLD_COLS);
  const col = g % WORLD_COLS;
  for (let y = row - radius; y < row + radius + 2; y++) {
    if (y < 0 || y >= WORLD_ROWS) continue;
    for (let x = col - radius; x < col + radius + 2; x++) if (x >= 0 && x < WORLD_COLS) flagged.add(y * WORLD_COLS + x);
  }
}

const step = (g: number, direction: number) => newGridNo(g, DIRECTION_INCREMENT[direction] ?? 0);

function tilesAWireframeReads(g: number): readonly number[] {
  return [g, step(g, SOUTH), step(g, EAST), step(step(g, WEST), SOUTH), step(step(g, NORTH), EAST), step(step(g, EAST), SOUTH)];
}

export function recalculateWireframesAround(t: TacticalState, tiles: Iterable<number>, radius: number): void {
  const flagged = new Set<number>();
  for (const g of tiles) flagWireframesAround(flagged, g, radius);
  const read = new Set<number>();
  for (const g of flagged) for (const n of tilesAWireframeReads(g)) read.add(n);
  t.events.push({
    type: 'wireframesRecalculated',
    tiles: tileRuns(WORLD_MAX, (g) => flagged.has(g)),
    revealed: tileRuns(WORLD_MAX, (g) => read.has(g) && groundRevealed(t, g)),
  });
}

export function examineSlantRoofsOverRevealedTiles(t: TacticalState): void {
  t.fog.slantRoofCeilings.fill(0);
  fogChanged(t);
  const slots = new SlantRoofSlots();
  for (let g = 0; g < WORLD_MAX; g++) if (groundRevealed(t, g)) slots.addRoofsHiddenOver(t, g);
  slots.examine(t, (g) => groundRevealed(t, g));
}

export function switchOnRevealedCaveLights(t: TacticalState): void {
  for (let g = 0; g < WORLD_MAX; g++) if ((t.fog.revealed[g] ?? 0) & RevealedFlags.GROUND) switchOnCaveLightAt(t, g);
}

function sightRevealsGround(t: TacticalState, g: number, underground: boolean): boolean {
  if (!underground) return true;
  return (t.world.level.rooms[g] ?? NO_ROOM) !== NO_ROOM || !flatRoofAboveGridNo(t, g);
}

function removeRoomRoof(t: TacticalState, room: number, s: Soldier | null, slots: SlantRoofSlots): void {
  const rooms = t.world.level.rooms;
  const roomTiles: number[] = [];
  let saidItemSeenQuote = false;
  for (let g = 0; g < WORLD_MAX; g++) {
    if (rooms[g] !== room) continue;
    roomTiles.push(g);
    setGridNoRevealed(t, g);
    slots.addRoofsHiddenOver(t, g);
    if (!setItemsVisibilityOn(t, g, 0, Visibility.INVISIBLE, true) || saidItemSeenQuote) continue;
    saidItemSeenQuote = true;
    if (s) t.narrative.sayQuote(s, SPOTTED_SOMETHING_QUOTE + t.rng.int(SPOTTED_SOMETHING_QUOTES));
  }
  t.events.push({ type: 'roomRevealed', room });
  recalculateWireframesAround(t, roomTiles, ROOM_REVEAL_WIREFRAME_RADIUS);
}

function hiddenRoomAt(t: TacticalState, g: number): number {
  const room = t.world.level.rooms[g] ?? NO_ROOM;
  return room !== NO_ROOM && t.fog.roomHidden[room] ? room : NO_ROOM;
}

export function removeHiddenRoomRoofAt(t: TacticalState, g: number): void {
  const room = hiddenRoomAt(t, g);
  if (room === NO_ROOM) return;
  const slots = new SlantRoofSlots();
  removeRoomRoof(t, room, null, slots);
  slots.examine(t, (x) => groundRevealed(t, x));
}

function revealHiddenRoom(t: TacticalState, room: number, s: Soldier, slots: SlantRoofSlots): void {
  removeRoomRoof(t, room, s, slots);
  if (room === ROOM_SURROUNDING_BOXING_RING && inBoxingSector(t)) removeRoomRoof(t, BOXING_RING, s, slots);
}

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

function revealsNothing(s: Soldier): boolean {
  return s.team !== Team.OUR || isVehicle(s) || !s.placed || s.life < OKLIFE || s.blindedCounter > 0;
}

function ourMercsAutoMove(t: TacticalState): boolean {
  return t.pathEnv.autoBandage;
}

export function revealRoofsAndItems(t: TacticalState, s: Soldier, showLocators: boolean): void {
  if (revealsNothing(s)) return;
  const fog = t.fog;
  const markers = t.viewMarkers.tiles;
  const markerValue = nextViewMarker(t.viewMarkers);
  mercLooksForDoors(t, s);
  const level = s.level;
  const range = s.gassed
    ? GASSED_VIEW_RANGE
    : idiv(adjustMaxSightRangeForEnvEffects(lightTrueLevel(t, s.gridNo, level), NORMAL_VIEW_RANGE) + NORMAL_VIEW_RANGE, 2);
  const { dirs, incs } = SIGHT_FANS[s.direction] ?? sightFan(s.direction);
  const underground = inCavesOrBasement(t);
  const table = s.direction % 2 === 1 ? VIEW_PATH_2 : VIEW_PATH;
  let goneThroughDoor = 0;
  let throughWindow = 0;
  let throughWindowDirection = -1;
  let itemsQuoteSaid = false;
  const itemsToo = !ourMercsAutoMove(t);
  const slots = new SlantRoofSlots();
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
      if (markers[marker] !== markerValue) {
        markers[marker] = markerValue;
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
        if (itemsToo && revealItems) {
          lookForAndMayCommentOnSeeingCorpse(t, s, marker, level);
          if (setItemsVisibilityOn(t, marker, level, Visibility.INVISIBLE, showLocators) && showLocators)
            itemsQuoteSaid = noticeRevealedItems(t, s, marker, itemsQuoteSaid);
        }
        tilesLeftToSee--;
        if (tilesLeftToSee <= 0) break;
        if (blocking === Blocking.FULL || (travelCostObstacle && !throughWindow)) break;
        slots.addSeenTile(t, marker);
        if (level === 0) {
          if (sightRevealsGround(t, marker, underground)) revealGround(t, marker);
          const room = t.world.level.rooms[marker] ?? NO_ROOM;
          if (room !== NO_ROOM && fog.roomHidden[room]) revealHiddenRoom(t, room, s, slots);
        } else revealRoof(t, marker);
        updateBloodGraphics(t, marker, level);
        if (!PASS_THROUGH_BLOCKING[blocking]) break;
      } else if (travelCostObstacle) break;
    }
  }
  slots.examine(t, (g) => groundRevealed(t, g));
}

export function allSoldiersLookForItems(t: TacticalState): void {
  for (const s of mercs(t)) revealRoofsAndItems(t, s, true);
}

export function revealedRooms(t: TacticalState): number[] {
  const rooms: number[] = [];
  for (let r = 1; r < MAX_ROOMS; r++) if (!t.fog.roomHidden[r]) rooms.push(r);
  return rooms;
}
