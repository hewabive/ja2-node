// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Buildings.cc GenerateBuildings, GenerateBuilding, FindBuilding, FindClosestClimbPoint,
// @src SameBuilding; Tactical/PathAI.cc RoofReachableTest; Tactical/Structure_Wrap.cc WallExistsOfTopLeftOrientation,
// @src WallExistsOfTopRightOrientation; TacticalAI/AIUtils.cc FindClosestClimbPointAvailableToAI, ClimbingNecessary,
// @src GetInterveningClimbingLocation.

import { Orientation } from '../../content/formats/jsd.ts';
import { DIRECTION_INCREMENT, Direction, newGridNo, pythSpacesAway, WORLD_MAX } from '../../content/world/grid.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { roamingRange } from './ai/destinations.ts';
import { findBestPath, newOKDestination, PathCopy, type PathSoldier } from './pathfinding.ts';
import { type Soldier, Team } from './soldier.ts';
import { type TacticalState, whoIsThere } from './state.ts';

export const NO_BUILDING = 0;
const NO_ROOM = 0;
const MAX_BUILDINGS = 31;
const MAX_CLIMBSPOTS_PER_BUILDING = 21;
const ROOF_LOCATION_CHANCE = 8;
const ROOF_TRAIL_TREE = 65536;
const ORIENT_LEFT = Orientation.INSIDE_LEFT | Orientation.OUTSIDE_LEFT;
const ORIENT_RIGHT = Orientation.INSIDE_RIGHT | Orientation.OUTSIDE_RIGHT;

export interface Building {
  readonly upClimbSpots: number[];
  readonly downClimbSpots: number[];
}

export interface Buildings {
  readonly info: Uint8Array;
  readonly list: Building[];
}

export function createBuildings(): Buildings {
  return { info: new Uint8Array(WORLD_MAX), list: [] };
}

const twoC = (d: number) => (d + 2) % 8;
const step = (g: number, d: number) => newGridNo(g, DIRECTION_INCREMENT[d] ?? 0);

function wallExists(t: TacticalState, g: number, orientation: number): boolean {
  return t.world.structures.at(g).some((s) => has(s.flags, StructureFlags.WALL) && (s.wallOrientation & orientation) !== 0);
}

function fakeRoofSoldier(g: number): PathSoldier {
  return {
    id: 0,
    team: Team.ENEMY,
    bodyType: 0,
    gridNo: g,
    level: 1,
    visible: 0,
    hasKeys: false,
    underAiControl: false,
    monsterOrAnimal: false,
  };
}

interface Scan {
  readonly reachable: Uint8Array;
  readonly visited: Uint8Array;
}

function roofReachableTest(t: TacticalState, scan: Scan, start: number, id: number): void {
  const flood = findBestPath(t.pathEnv, fakeRoofSoldier(start), -1, 1, { copy: PathCopy.REACHABLE, maxTrailTree: ROOF_TRAIL_TREE });
  const reached = flood.reachable;
  if (reached) {
    for (let g = 0; g < WORLD_MAX; g++) {
      if (!reached[g]) continue;
      scan.reachable[g] = 1;
      t.buildings.info[g] = id;
    }
  }
  scan.reachable[start] = 1;
}

function climbWall(current: number, direction: number): { wall: number; orientation: number } | null {
  switch (direction) {
    case Direction.NORTH:
      return { wall: current, orientation: ORIENT_RIGHT };
    case Direction.EAST:
      return { wall: current, orientation: ORIENT_LEFT };
    case Direction.SOUTH:
      return { wall: step(current, twoC(direction)), orientation: ORIENT_RIGHT };
    case Direction.WEST:
      return { wall: step(current, twoC(direction)), orientation: ORIENT_LEFT };
    default:
      return null;
  }
}

function turnAwayFromBuilding(scan: Scan, current: number, direction: number): number {
  let d = twoC(direction);
  for (let k = 0; k < 3; k++) {
    const g = step(current, d);
    if (!scan.reachable[g] && !scan.visited[g]) return d;
    d = twoC(d);
  }
  d = twoC(direction);
  for (let k = 0; k < 3; k++) {
    if (!scan.reachable[step(current, d)]) return d;
    d = twoC(d);
  }
  return -1;
}

function generateBuilding(t: TacticalState, scan: Scan, desired: number): void {
  if (t.buildings.list.length + 1 >= MAX_BUILDINGS) return;
  const building: Building = { upClimbSpots: [], downClimbSpots: [] };
  t.buildings.list.push(building);
  const id = t.buildings.list.length;
  const fake = fakeRoofSoldier(desired);
  roofReachableTest(t, scan, desired, id);
  let probe = desired;
  while (scan.reachable[probe]) {
    const next = step(probe, Direction.NORTHWEST);
    if (next === probe) return;
    probe = next;
  }
  const start = probe;
  let current = start;
  let previous = -1;
  let direction: number = scan.reachable[step(current, Direction.EAST)] ? Direction.NORTH : Direction.EAST;
  let chanceIn = ROOF_LOCATION_CHANCE;
  let skipSpots = 0;
  scan.visited[start] = 1;
  for (;;) {
    const right = step(current, twoC(direction));
    if (((!scan.reachable[right] && !scan.visited[right]) || right === start) && current !== start) {
      direction = twoC(direction);
      continue;
    }
    const ahead = step(current, direction);
    if (scan.reachable[ahead]) {
      const turned = turnAwayFromBuilding(scan, current, direction);
      if (turned < 0) return;
      direction = turned;
      continue;
    }
    previous = current;
    current = ahead;
    const rightOfCurrent = step(current, twoC(direction));
    if (current === previous || current === start) break;
    if (scan.visited[current]) continue;
    scan.visited[current] = 1;
    const wall = climbWall(current, direction);
    if (!wall) return;
    if (wallExists(t, wall.wall, wall.orientation)) {
      if (skipSpots > 0) skipSpots--;
      else if (t.rng.int(chanceIn) === 0) {
        if (newOKDestination(t.pathEnv, fake, current, false, 0)) {
          building.upClimbSpots.push(current);
          building.downClimbSpots.push(rightOfCurrent);
          if (building.upClimbSpots.length === MAX_CLIMBSPOTS_PER_BUILDING) return;
          chanceIn = ROOF_LOCATION_CHANCE;
          skipSpots = 1;
        } else chanceIn = 1;
      } else if (chanceIn > 2) chanceIn--;
    } else {
      if (previous !== -1 && building.upClimbSpots.length > 0 && building.downClimbSpots.at(-1) === current) {
        building.upClimbSpots.pop();
        building.downClimbSpots.pop();
        chanceIn = 1;
      }
      skipSpots = 1;
    }
  }
}

export function generateBuildings(t: TacticalState): void {
  t.buildings.info.fill(NO_BUILDING);
  t.buildings.list.length = 0;
  const scan: Scan = { reachable: new Uint8Array(WORLD_MAX), visited: new Uint8Array(WORLD_MAX) };
  const rooms = t.world.level.rooms;
  for (let g = 0; g < WORLD_MAX; g++) {
    if ((rooms[g] ?? NO_ROOM) === NO_ROOM || t.buildings.info[g] !== NO_BUILDING) continue;
    if (!t.world.structures.find(g, StructureFlags.NORMAL_ROOF)) continue;
    generateBuilding(t, scan, g);
  }
}

export function findBuilding(t: TacticalState, g: number): Building | null {
  if (g <= 0 || g >= WORLD_MAX) return null;
  const id = t.buildings.info[g] ?? NO_BUILDING;
  return id === NO_BUILDING ? null : (t.buildings.list[id - 1] ?? null);
}

export function findClosestClimbPoint(t: TacticalState, start: number, desired: number, climbUp: boolean): number {
  const building = findBuilding(t, desired);
  if (!building) return -1;
  const spots = climbUp ? building.upClimbSpots : building.downClimbSpots;
  let closest = 1000;
  let best = -1;
  for (let k = 0; k < spots.length; k++) {
    if (whoIsThere(t, building.upClimbSpots[k] ?? -1, 0) || whoIsThere(t, building.downClimbSpots[k] ?? -1, 1)) continue;
    const d = pythSpacesAway(start, spots[k] ?? -1);
    if (d < closest) {
      closest = d;
      best = spots[k] ?? -1;
    }
  }
  return best;
}

export function sameBuilding(t: TacticalState, a: number, b: number): boolean {
  const ia = t.buildings.info[a] ?? NO_BUILDING;
  const ib = t.buildings.info[b] ?? NO_BUILDING;
  return ia !== NO_BUILDING && ib !== NO_BUILDING && ia === ib;
}

const PC_ROAMING_RANGE = 99;

export function findClosestClimbPointAvailableToAI(t: TacticalState, s: Soldier, start: number, desired: number, climbUp: boolean): number {
  const { origin, range } = s.team === Team.OUR ? { origin: s.gridNo, range: PC_ROAMING_RANGE } : roamingRange(s);
  const g = findClosestClimbPoint(t, start, desired, climbUp);
  if (g === -1) return -1;
  return pythSpacesAway(origin, g) + 1 > range ? -1 : g;
}

function sameLevelNoClimb(t: TacticalState, s: Soldier, dest: number): boolean {
  return s.level === 0 || (t.buildings.info[s.gridNo] ?? NO_BUILDING) === (t.buildings.info[dest] ?? NO_BUILDING);
}

export function climbingNecessary(t: TacticalState, s: Soldier, dest: number, destLevel: number): boolean {
  return s.level !== destLevel || !sameLevelNoClimb(t, s, dest);
}

export interface InterveningClimb {
  readonly necessary: boolean;
  readonly gridNo: number;
}

export function getInterveningClimbingLocation(t: TacticalState, s: Soldier, dest: number, destLevel: number): InterveningClimb {
  if (s.level === destLevel && sameLevelNoClimb(t, s, dest)) return { necessary: false, gridNo: -1 };
  if (s.level !== destLevel && s.level === 0)
    return { necessary: true, gridNo: findClosestClimbPointAvailableToAI(t, s, s.gridNo, dest, true) };
  return { necessary: true, gridNo: findClosestClimbPointAvailableToAI(t, s, s.gridNo, s.gridNo, false) };
}
