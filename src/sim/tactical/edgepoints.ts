// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Map_Edgepoints.cc GenerateMapEdgepoints, ValidateEdgepoints, ClassifyEdgepoints,
// @src InternallyClassifyEdgepoints, LoadMapEdgepoints, ChooseMapEdgepoint(s), BeginMapEdgepointSearch,
// @src SearchClosestMapEdgepoint, CalcMapEdgepointClassInsertionCode; Tactical/PathAI.cc GlobalReachableTest;
// @src TacticalAI/FindLocations.cc FindNearestEdgepointOnSpecifiedEdge; TileEngine/Isometric_Utils.cc GridNoOnEdgeOfMap.

import type { MapDef, MapEdgepoints as SavedEdgepoints } from '../../content/formats/map.ts';
import { DIRECTION_COUNT, DIRECTION_INCREMENT, Direction, pythSpacesAway, WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { Terrain } from '../../content/world/terrain.ts';
import type { RandomStream } from './combat/context.ts';
import { ABSMAX_TRAIL_TREE, findBestPath, NOWHERE, PathCopy, PathFlags, type PathSoldier } from './pathfinding.ts';
import { Team } from './soldier.ts';
import { sectorMapOf, type TacticalState } from './state.ts';

export const EdgeSide = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3 } as const;
export const SIDES = [EdgeSide.NORTH, EdgeSide.EAST, EdgeSide.SOUTH, EdgeSide.WEST] as const;

export const EdgeInsertion = { NORTH: 0, SOUTH: 1, EAST: 2, WEST: 3, PRIMARY_EDGEINDEX: 7, SECONDARY_EDGEINDEX: 8 } as const;

export interface EdgepointList {
  gridNos: number[];
  middle: number;
}

export interface MapEdgepoints {
  readonly primary: EdgepointList[];
  readonly secondary: EdgepointList[];
}

export interface EdgepointSector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const TOP_LEFT = 13286;
const TOP_RIGHT = 1043;
const BOTTOM_LEFT = 24878;
const BOTTOM_RIGHT = 12635;
const ROW_DOWN_RIGHT = 161;
const ROW_DOWN_LEFT = 159;
const MAP_VERSION_WITH_SECOND_LAYER = 17;
const MAP_VERSION_WITH_CURRENT_EDGEPOINTS = 22;
const EDGE_OF_MAP_SEARCH = 5;
const BRUTAL_SEARCH_RANGE = 250;
const BRUTAL_SECTOR: EdgepointSector = { x: 14, y: 9, z: 0 };
const CLASSIFY_PATH_LIMIT = 15;
const NO_BENCHMARK = 0xffff;
const MAX_RESERVED = 20;
const SURFACE_SPIRAL_LIMIT = 10;
const UNDERGROUND_SPIRAL_LIMIT = 30;

const INSERTION_SIDE: Readonly<Record<number, number>> = {
  [EdgeInsertion.NORTH]: EdgeSide.NORTH,
  [EdgeInsertion.EAST]: EdgeSide.EAST,
  [EdgeInsertion.SOUTH]: EdgeSide.SOUTH,
  [EdgeInsertion.WEST]: EdgeSide.WEST,
};

const DIRECTION_SIDE: Readonly<Record<number, number>> = {
  [Direction.NORTH]: EdgeSide.NORTH,
  [Direction.EAST]: EdgeSide.EAST,
  [Direction.SOUTH]: EdgeSide.SOUTH,
  [Direction.WEST]: EdgeSide.WEST,
};

function emptyList(): EdgepointList {
  return { gridNos: [], middle: 0 };
}

export function emptyEdgepoints(): MapEdgepoints {
  return { primary: SIDES.map(emptyList), secondary: SIDES.map(emptyList) };
}

function copyLists(lists: readonly { readonly gridNos: readonly number[]; readonly middle: number }[]): EdgepointList[] {
  return SIDES.map((side) => ({ gridNos: [...(lists[side]?.gridNos ?? [])], middle: lists[side]?.middle ?? 0 }));
}

export function savedMapEdgepoints(map: Pick<MapDef, 'edgepoints' | 'info'>): MapEdgepoints | null {
  const saved: SavedEdgepoints | null = map.edgepoints;
  if (!saved || map.info.mapVersion < MAP_VERSION_WITH_SECOND_LAYER || map.info.mapVersion < MAP_VERSION_WITH_CURRENT_EDGEPOINTS)
    return null;
  return { primary: copyLists(saved.primary), secondary: copyLists(saved.secondary ?? []) };
}

function fakeSoldier(gridNo: number, team: number): PathSoldier {
  return { id: -1, team, bodyType: 0, gridNo, level: 0, visible: -1, hasKeys: false, underAiControl: false, monsterOrAnimal: false };
}

export function globalReachableTest(t: TacticalState, start: number): Uint8Array {
  const flood = findBestPath(t.pathEnv, fakeSoldier(start, Team.ENEMY), NOWHERE, 0, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.THROUGH_PEOPLE,
    maxTrailTree: ABSMAX_TRAIL_TREE,
  });
  return flood.reachable ?? new Uint8Array(WORLD_MAX);
}

export function gridNoOnEdgeOfMap(t: TacticalState, g: number): boolean {
  for (let direction = Direction.NORTHEAST; direction < DIRECTION_COUNT; direction += 2) {
    const next = g + (DIRECTION_INCREMENT[direction] ?? 0);
    if (next < 0 || next >= WORLD_MAX) continue;
    if (t.world.costs.get(next, direction, 0) === TravelCost.OFF_MAP) return true;
  }
  return false;
}

function squareTiles(center: number, apothem: number): number[] {
  const cx = center % WORLD_COLS;
  const cy = Math.trunc(center / WORLD_COLS);
  const out: number[] = [];
  for (let y = Math.max(0, cy - apothem); y <= Math.min(WORLD_COLS - 1, cy + apothem); y++)
    for (let x = Math.max(0, cx - apothem); x <= Math.min(WORLD_COLS - 1, cx + apothem); x++) out.push(y * WORLD_COLS + x);
  return out;
}

interface EdgeWalk {
  readonly start: number;
  readonly end: number;
  readonly first: number;
  readonly second: number;
  readonly towardEnd: (g: number, end: number) => boolean;
}

const decreasing = (g: number, end: number) => g > end;
const increasing = (g: number, end: number) => g < end;

const EDGE_WALKS: Readonly<Record<number, readonly [EdgeWalk, EdgeWalk]>> = {
  [EdgeSide.NORTH]: [
    { start: TOP_LEFT, end: TOP_RIGHT, first: 1, second: -WORLD_COLS, towardEnd: decreasing },
    { start: TOP_LEFT + ROW_DOWN_RIGHT, end: TOP_RIGHT + ROW_DOWN_RIGHT, first: 1, second: -WORLD_COLS, towardEnd: decreasing },
  ],
  [EdgeSide.EAST]: [
    { start: TOP_RIGHT, end: BOTTOM_RIGHT, first: WORLD_COLS, second: 1, towardEnd: increasing },
    { start: TOP_RIGHT + ROW_DOWN_LEFT, end: BOTTOM_RIGHT + ROW_DOWN_LEFT, first: WORLD_COLS, second: 1, towardEnd: increasing },
  ],
  [EdgeSide.SOUTH]: [
    { start: BOTTOM_LEFT, end: BOTTOM_RIGHT, first: 1, second: -WORLD_COLS, towardEnd: decreasing },
    { start: BOTTOM_LEFT - ROW_DOWN_RIGHT, end: BOTTOM_RIGHT - ROW_DOWN_RIGHT, first: 1, second: -WORLD_COLS, towardEnd: decreasing },
  ],
  [EdgeSide.WEST]: [
    { start: TOP_LEFT, end: BOTTOM_LEFT, first: 1, second: WORLD_COLS, towardEnd: increasing },
    { start: TOP_LEFT - ROW_DOWN_LEFT, end: BOTTOM_LEFT - ROW_DOWN_LEFT, first: 1, second: WORLD_COLS, towardEnd: increasing },
  ],
};

function walkRow(walk: EdgeWalk, keep: (g: number) => boolean, out: number[]): void {
  let g = walk.start;
  if (keep(g)) out.push(g);
  while (walk.towardEnd(g, walk.end)) {
    g += walk.first;
    if (keep(g)) out.push(g);
    g += walk.second;
    if (keep(g)) out.push(g);
  }
}

function entryPoints(t: TacticalState): readonly number[] {
  const info = sectorMapOf(t).info;
  return [info.northGridNo, info.eastGridNo, info.southGridNo, info.westGridNo];
}

function collectEdges(t: TacticalState, reachable: Uint8Array, lists: EdgepointList[]): void {
  const rooms = sectorMapOf(t).rooms;
  const basement = sectorMapOf(t).ambient?.basement === true;
  const keep = (g: number) => (reachable[g] ?? 0) !== 0 && (!(rooms[g] ?? 0) || basement);
  const entries = entryPoints(t);
  for (const side of SIDES) {
    if (entries[side] === -1) continue;
    const list = lists[side] as EdgepointList;
    const [outer, inner] = EDGE_WALKS[side] as readonly [EdgeWalk, EdgeWalk];
    walkRow(outer, keep, list.gridNos);
    list.middle = list.gridNos.length;
    walkRow(inner, keep, list.gridNos);
  }
}

function verifyEdgepoint(t: TacticalState, g: number): boolean {
  const flood = findBestPath(t.pathEnv, fakeSoldier(g, Team.ENEMY), NOWHERE, 0, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.THROUGH_PEOPLE,
    distLimit: EDGE_OF_MAP_SEARCH,
  });
  const reachable = flood.reachable;
  if (!reachable) return false;
  return squareTiles(g, EDGE_OF_MAP_SEARCH).some((tile) => reachable[tile] === 1 && gridNoOnEdgeOfMap(t, tile));
}

function validateMapEdge(t: TacticalState, list: EdgepointList): void {
  let dst = 0;
  let middle = list.middle;
  const points = list.gridNos;
  for (let i = 0; i < points.length; i++) {
    if (verifyEdgepoint(t, points[i] as number)) {
      points[dst] = points[i] as number;
      if (middle === i) middle = dst;
      dst++;
    } else if (middle === i) middle++;
  }
  list.middle = middle;
  points.length = dst;
}

function edgepointsClose(t: TacticalState, a: number, b: number, sector: EdgepointSector): boolean {
  const brutal = sector.x === BRUTAL_SECTOR.x && sector.y === BRUTAL_SECTOR.y && sector.z === 0;
  const flood = findBestPath(t.pathEnv, fakeSoldier(a, Team.ENEMY), b, 0, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.THROUGH_PEOPLE,
    distLimit: brutal ? BRUTAL_SEARCH_RANGE : EDGE_OF_MAP_SEARCH,
  });
  return flood.reachedDestination === true;
}

function compactEdgepoints(list: EdgepointList): void {
  let n = 0;
  const points = list.gridNos;
  for (let i = 0; i < points.length; i++) {
    if (points[i] === -1) {
      if (i < list.middle) list.middle--;
    } else {
      points[n] = points[i] as number;
      n++;
    }
  }
  points.length = n;
}

function findBenchmarks(t: TacticalState, g: number, list: EdgepointList, sector: EdgepointSector): [number, number] {
  const e = list.gridNos;
  const m = list.middle;
  for (let i = 0; i < e.length; i++) {
    if (e[i] !== g) continue;
    if (i < m) {
      for (let j = m; j < e.length; j++) if (edgepointsClose(t, e[i] as number, e[j] as number, sector)) return [i, j];
      return [i, NO_BENCHMARK];
    }
    for (let j = 0; j < m; j++) if (edgepointsClose(t, e[i] as number, e[j] as number, sector)) return [j, i];
    return [NO_BENCHMARK, i];
  }
  return [NO_BENCHMARK, NO_BENCHMARK];
}

function internallyClassifyEdgepoints(
  t: TacticalState,
  g: number,
  primary: EdgepointList,
  secondary: EdgepointList,
  sector: EdgepointSector,
): void {
  const e = primary.gridNos;
  const m = primary.middle;
  const close = (i: number, j: number) => edgepointsClose(t, e[i] as number, e[j] as number, sector);
  const reject = (i: number, countMiddle: boolean) => {
    secondary.gridNos.push(e[i] as number);
    if (countMiddle) secondary.middle++;
    e[i] = -1;
  };
  const [first, second] = findBenchmarks(t, g, primary, sector);
  if (first !== NO_BENCHMARK) {
    for (let i = first; i > 0; i--) {
      if (close(i, i - 1)) continue;
      while (i) reject(--i, true);
      break;
    }
    for (let i = first; i < m - 1; i++) {
      if (close(i, i + 1)) continue;
      while (i < m - 1) reject(++i, true);
      break;
    }
  }
  if (second !== NO_BENCHMARK) {
    for (let i = second; i > m; i--) {
      if (close(i, i - 1)) continue;
      while (i > m) reject(--i, false);
      break;
    }
    for (let i = second; i < e.length - 1; i++) {
      if (close(i, i + 1)) continue;
      while (i < e.length - 1) reject(++i, false);
      break;
    }
  }
  compactEdgepoints(primary);
}

export function findNearestEdgepointOnSpecifiedEdge(edgepoints: MapEdgepoints, g: number, side: number): number {
  let closest = NOWHERE;
  let closestDistance = 0x7fff;
  for (const point of edgepoints.primary[side]?.gridNos ?? []) {
    const d = pythSpacesAway(g, point);
    if (d < closestDistance) {
      closestDistance = d;
      closest = point;
    }
  }
  return closest;
}

function classifyEdgepoints(t: TacticalState, edgepoints: MapEdgepoints, sector: EdgepointSector): void {
  const entries = entryPoints(t);
  for (const side of SIDES) {
    const entry = entries[side] as number;
    if (entry === -1) continue;
    const g = findNearestEdgepointOnSpecifiedEdge(edgepoints, entry, side);
    if (g === NOWHERE) continue;
    internallyClassifyEdgepoints(t, g, edgepoints.primary[side] as EdgepointList, edgepoints.secondary[side] as EdgepointList, sector);
  }
}

function firstEntryPoint(t: TacticalState, withCenter: boolean): number {
  const info = sectorMapOf(t).info;
  const candidates = [info.northGridNo, info.eastGridNo, info.southGridNo, info.westGridNo, ...(withCenter ? [info.centerGridNo] : [])];
  return candidates.find((g) => g !== -1) ?? -1;
}

export function generateMapEdgepoints(t: TacticalState, sector: EdgepointSector): MapEdgepoints {
  const edgepoints = emptyEdgepoints();
  const start = firstEntryPoint(t, true);
  if (start === -1) return edgepoints;
  const reachable = globalReachableTest(t, start);
  collectEdges(t, reachable, edgepoints.primary);
  const isolated = sectorMapOf(t).info.isolatedGridNo;
  if (isolated !== -1 && !reachable[isolated]) collectEdges(t, globalReachableTest(t, isolated), edgepoints.secondary);
  for (const list of [...edgepoints.primary, ...edgepoints.secondary]) validateMapEdge(t, list);
  if (isolated !== -1) classifyEdgepoints(t, edgepoints, sector);
  return edgepoints;
}

export function loadMapEdgepoints(t: TacticalState, sector: EdgepointSector): MapEdgepoints {
  return savedMapEdgepoints(sectorMapOf(t)) ?? generateMapEdgepoints(t, sector);
}

export function edgepointsOf(t: TacticalState): MapEdgepoints {
  if (!t.edgepoints) t.edgepoints = loadMapEdgepoints(t, { x: 0, y: 0, z: 0 });
  return t.edgepoints;
}

export function edgepointList(t: TacticalState, insertionCode: number, primary: boolean): readonly number[] | null {
  const side = INSERTION_SIDE[insertionCode];
  if (side === undefined) return null;
  const e = edgepointsOf(t);
  return (primary ? e.primary : e.secondary)[side]?.gridNos ?? null;
}

export function chooseMapEdgepoint(t: TacticalState, insertionCode: number, rolls: RandomStream): number {
  const list = edgepointList(t, insertionCode, true);
  if (!list || list.length === 0) return NOWHERE;
  return list[rolls.int(list.length)] ?? NOWHERE;
}

function deepWater(t: TacticalState, g: number): boolean {
  const terrain = t.world.terrain[g];
  return terrain === Terrain.MED_WATER || terrain === Terrain.DEEP_WATER;
}

export function chooseMapEdgepoints(t: TacticalState, insertionCode: number, wanted: number, rolls: RandomStream): number[] {
  const list = edgepointList(t, insertionCode, true);
  if (!list || list.length === 0) return [];
  const usable = list.filter((g) => !deepWater(t, g));
  if (wanted >= usable.length) return usable;
  const chosen: number[] = [];
  let slots = usable.length;
  let remaining = wanted;
  for (const g of usable) {
    if (rolls.int(slots) < remaining) {
      chosen.push(g);
      remaining--;
    }
    slots--;
  }
  return chosen;
}

export function beginMapEdgepointSearch(t: TacticalState): void {
  t.edgepointReservations = [];
}

export function endMapEdgepointSearch(t: TacticalState): void {
  t.edgepointReservations = null;
}

function takeIfListed(reserved: number[], list: readonly number[], g: number): boolean {
  if (reserved.includes(g) || !list.includes(g)) return false;
  if (reserved.length < MAX_RESERVED) reserved.push(g);
  return true;
}

const SPIRAL_DIRECTIONS = [WORLD_COLS, 1, -WORLD_COLS, -1] as const;

export function searchClosestMapEdgepoint(t: TacticalState, start: number, list: readonly number[] | null, underground: boolean): number {
  const reserved = t.edgepointReservations ?? [];
  if (!list || list.length === 0) return NOWHERE;
  if (takeIfListed(reserved, list, start)) return start;
  const limit = underground ? UNDERGROUND_SPIRAL_LIMIT : SURFACE_SPIRAL_LIMIT;
  for (let radius = 1; radius < limit; radius++) {
    let g = start + (-1 - WORLD_COLS) * radius;
    for (const step of SPIRAL_DIRECTIONS) {
      for (let n = radius * 2; n > 0; n--) {
        g += step;
        if (g < 0 || g >= WORLD_MAX) continue;
        if (takeIfListed(reserved, list, g)) return g;
      }
    }
  }
  return NOWHERE;
}

export function searchForClosestPrimaryMapEdgepoint(t: TacticalState, start: number, insertionCode: number, underground: boolean): number {
  return searchClosestMapEdgepoint(t, start, edgepointList(t, insertionCode, true), underground);
}

export function searchForClosestSecondaryMapEdgepoint(
  t: TacticalState,
  start: number,
  insertionCode: number,
  underground: boolean,
): number {
  return searchClosestMapEdgepoint(t, start, edgepointList(t, insertionCode, false), underground);
}

function closestOf(g: number, list: readonly number[]): { readonly spot: number; readonly distance: number } {
  let spot = NOWHERE;
  let distance = 0x7fff;
  for (const point of list) {
    const d = pythSpacesAway(g, point);
    if (d < distance) {
      distance = d;
      spot = point;
    }
  }
  return { spot, distance };
}

export function calcMapEdgepointClassInsertionCode(t: TacticalState, g: number, tacticalDirection: number): number {
  if (sectorMapOf(t).info.isolatedGridNo === -1) return EdgeInsertion.PRIMARY_EDGEINDEX;
  const side = DIRECTION_SIDE[tacticalDirection];
  if (side === undefined) return EdgeInsertion.PRIMARY_EDGEINDEX;
  const e = edgepointsOf(t);
  const primary = closestOf(g, e.primary[side]?.gridNos ?? []);
  const secondary = closestOf(g, e.secondary[side]?.gridNos ?? []);
  const soldier = fakeSoldier(g, Team.ENEMY);
  let distLimit = CLASSIFY_PATH_LIMIT;
  const pathExists = (to: number): boolean => {
    const found = findBestPath(t.pathEnv, soldier, to, 0, { flags: PathFlags.THROUGH_PEOPLE, distLimit }).length > 0;
    if (to !== g) distLimit = 0;
    return found;
  };
  const primaryValid = !primary.distance || pathExists(primary.spot);
  const secondaryValid = !secondary.distance || pathExists(secondary.spot);
  if (primaryValid === secondaryValid)
    return secondary.distance < primary.distance ? EdgeInsertion.SECONDARY_EDGEINDEX : EdgeInsertion.PRIMARY_EDGEINDEX;
  return primaryValid ? EdgeInsertion.PRIMARY_EDGEINDEX : EdgeInsertion.SECONDARY_EDGEINDEX;
}
