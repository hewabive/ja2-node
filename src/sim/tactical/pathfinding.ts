// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/PathAI.cc FindBestPath, IsDoorObstacleIfClosed, GetDoorState; Overhead.cc NewOKDestination,
// @src NewOKDestinationAndDirection, IsDestinationBlocked; TileEngine/WorldMan.cc WhoIsThere2, Water.

import type { StructureDef } from '../../content/formats/jsd.ts';
import type { MapDoor } from '../../content/formats/map.ts';
import { DIRECTION_INCREMENT, Direction, pythSpacesAway, spacesAway, WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { isDoorTravelCost, type MovementCosts, TravelCost } from '../../content/world/movement-costs.ts';
import { gridNoOnVisibleWorldTile } from '../../content/world/render-bounds.ts';
import {
  has,
  IGNORE_PEOPLE_STRUCTURE_ID,
  STRUCTURE_ON_GROUND,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  type WorldStructures,
} from '../../content/world/structures.ts';
import { TERRAIN_MOVEMENT_COST, Terrain } from '../../content/world/terrain.ts';
import { u8, u16 } from '../../core/int.ts';
import { Team } from './soldier.ts';

export const PathFlags = { THROUGH_PEOPLE: 0x01, IGNORE_PERSON_AT_DEST: 0x02, CLOSE_GOOD_ENOUGH: 0x04 } as const;
export const PathCopy = { NONE: 0, ROUTE: 1, REACHABLE: 2, REACHABLE_AND_APS: 3 } as const;
export const MAX_PATH_LIST_SIZE = 30;
export const NOWHERE = -1;
export const AI_PATHCOST_RADIUS = 9;
export const AI_PATHCOST_SIZE = 2 * AI_PATHCOST_RADIUS + 1;

const PATH_CLOSE_RADIUS = 5;
const MAX_PATHQ = 1024;
const POOL_NODES = MAX_PATHQ - 2;
const MAX_TRAIL_TREE = 16384;
export const ABSMAX_TRAIL_TREE = 65536;
const PLAIN_PATH_LIMIT = 256;
const DIRECTIONS = 8;
const BACKWARDS_STEP_PENALTY = 50;
const Looping = { CLOCKWISE: 0, COUNTERCLOCKWISE: 1, REVERSE: 2 } as const;
const EASYWATERCOST = 5;
const LOWEST_STEP_COST = EASYWATERCOST;
const MERC_BODY_MAX = 3;
const DOOR_APS_OPEN = 3;
const RUN_DIVISOR_X10 = 18;
const WALK_COST = -1;
const CRAWL_COST = 1;
const AP_CROUCH = 2;
const AP_JUMPFENCE = 6;

export const MoveMode = { WALKING: 'WALKING', RUNNING: 'RUNNING', SWATTING: 'SWATTING', CRAWLING: 'CRAWLING' } as const;
export type MoveMode = (typeof MoveMode)[keyof typeof MoveMode];

export interface PathSoldier {
  readonly id: number;
  readonly team: number;
  readonly bodyType: number;
  readonly gridNo: number;
  readonly level: number;
  readonly visible: number;
  readonly hasKeys: boolean;
  readonly underAiControl: boolean;
  readonly monsterOrAnimal: boolean;
}

export interface DoorStatus {
  readonly perceivedOpen: boolean;
}

export interface MultiTileShape {
  readonly structures: readonly (StructureDef | null)[] | null;
  readonly structureId: number;
  readonly continuousTurn: boolean;
  readonly direction: number;
}

export interface PathWorld {
  readonly costs: MovementCosts;
  readonly terrain: Uint8Array;
  readonly heights: Uint8Array;
  readonly structures: WorldStructures;
  readonly mapDoors: ReadonlyMap<number, MapDoor>;
}

export interface PathEnv {
  readonly world: PathWorld;
  readonly restrictedScrollId: number;
  whoIsThere(g: number, level: number): PathSoldier | null;
  doorStatus(g: number): DoorStatus | null;
  readonly showAllMercs: boolean;
  readonly autoBandage: boolean;
  readonly minAPsToStartMovement?: (s: PathSoldier, mode: MoveMode) => number;
  readonly multiTile?: (s: PathSoldier, mode: MoveMode | null) => MultiTileShape | null;
  readonly stats?: { searches: number };
}

export interface PathOptions {
  readonly mode?: MoveMode;
  readonly copy?: number;
  readonly flags?: number;
  readonly budget?: number;
  readonly distLimit?: number;
  readonly circular?: boolean;
  readonly plotToExitGrid?: boolean;
  readonly maxTrailTree?: number;
  readonly estimate?: boolean;
}

export interface PathResult {
  readonly length: number;
  readonly steps: readonly number[];
  readonly reachable?: Uint8Array;
  readonly apCosts?: Int8Array;
  readonly reachedDestination?: boolean;
}

const NO_PATH: PathResult = { length: 0, steps: [] };
const EXPANDED = true;
const ABORTED = false;
const REACHABLE_COST_TO_GO = 100;

export function terrainCost(world: PathWorld, g: number): number {
  return TERRAIN_MOVEMENT_COST[world.terrain[g] ?? 0] ?? TravelCost.FLAT;
}

export function isWater(world: PathWorld, g: number): boolean {
  if (g === NOWHERE) return false;
  const t = world.terrain[g];
  return t === Terrain.LOW_WATER || t === Terrain.MED_WATER || t === Terrain.DEEP_WATER;
}

export function isMercBody(s: { readonly bodyType: number }): boolean {
  return s.bodyType <= MERC_BODY_MAX;
}

export function isDestinationBlocked(env: PathEnv, g: number, level: number, plotToExitGrid = false): boolean {
  if (plotToExitGrid) return false;
  const desired = level === 0 ? STRUCTURE_ON_GROUND : STRUCTURE_ON_ROOF;
  for (const st of env.world.structures.at(g)) {
    if (!has(st.flags, StructureFlags.BLOCKSMOVES) || has(st.flags, StructureFlags.PASSABLE)) continue;
    if (st.cubeOffset === desired) return true;
  }
  return false;
}

function personBlocksDestination(env: PathEnv, s: PathSoldier, g: number, level: number): boolean {
  const person = env.whoIsThere(g, level);
  return person !== null && (person.id !== s.id || g === s.gridNo) && (s.team !== Team.OUR || person.visible >= 0 || env.showAllMercs);
}

function okayForShape(
  env: PathEnv,
  g: number,
  level: number,
  def: StructureDef | null | undefined,
  id: number,
  ignorePeople: boolean,
): boolean {
  return !def || env.world.structures.okayToAdd(g, level, def, id, ignorePeople);
}

export function newOKDestination(
  env: PathEnv,
  s: PathSoldier,
  g: number,
  peopleToo: boolean,
  level: number,
  plotToExitGrid = false,
  estimate = false,
): boolean {
  if (!gridNoOnVisibleWorldTile(env.restrictedScrollId, g)) return false;
  if (peopleToo && personBlocksDestination(env, s, g, level)) return false;
  const shape = estimate ? null : (env.multiTile?.(s, null) ?? null);
  if (shape) {
    const structures = shape.structures;
    if (!structures) return false;
    for (let dir = 0; dir < DIRECTIONS; dir++) if (okayForShape(env, g, level, structures[dir], shape.structureId, !peopleToo)) return true;
    return false;
  }
  return !isDestinationBlocked(env, g, level, plotToExitGrid);
}

export function newOKDestinationAndDirection(
  env: PathEnv,
  s: PathSoldier,
  g: number,
  direction: number,
  peopleToo: boolean,
  level: number,
): boolean {
  if (peopleToo && personBlocksDestination(env, s, g, level)) return false;
  const shape = env.multiTile?.(s, null) ?? null;
  if (shape) {
    const structures = shape.structures;
    return structures !== null && okayForShape(env, g, s.level, structures[oneCDirection(direction)], shape.structureId, !peopleToo);
  }
  return !isDestinationBlocked(env, g, level);
}

function oneCDirection(dir: number): number {
  return (dir + 1) % DIRECTIONS;
}

function oneCCDirection(dir: number): number {
  return (dir + DIRECTIONS - 1) % DIRECTIONS;
}

function oppositeDirection(dir: number): number {
  return (dir + DIRECTIONS / 2) % DIRECTIONS;
}

interface DoorRef {
  readonly obstacleIfClosed: boolean;
  readonly door: number;
  readonly door2: number;
}

const DI = DIRECTION_INCREMENT;
const { NORTH, NORTHEAST, EAST, SOUTHEAST, SOUTH, SOUTHWEST, WEST, NORTHWEST } = Direction;
const DOOR_OFFSETS: Readonly<Record<number, readonly [boolean, number, number | null]>> = {
  212: [true, DI[WEST] as number, DI[SOUTHWEST] as number],
  213: [true, 0, DI[SOUTH] as number],
  214: [true, DI[NORTH] as number, DI[NORTHWEST] as number],
  215: [true, 0, DI[WEST] as number],
  216: [true, DI[WEST] as number, DI[NORTHWEST] as number],
  217: [true, 0, DI[NORTH] as number],
  218: [true, DI[NORTH] as number, DI[NORTHEAST] as number],
  219: [true, 0, DI[EAST] as number],
  220: [true, 0, null],
  221: [true, DI[NORTH] as number, null],
  222: [true, DI[WEST] as number, null],
  223: [false, 0, null],
  224: [false, DI[NORTH] as number, null],
  225: [false, DI[NORTHEAST] as number, null],
  226: [false, DI[EAST] as number, null],
  227: [false, DI[SOUTHEAST] as number, null],
  228: [false, DI[SOUTH] as number, null],
  229: [false, DI[SOUTHWEST] as number, null],
  230: [false, DI[WEST] as number, null],
  231: [false, DI[NORTHWEST] as number, null],
  232: [false, 2 * (DI[NORTH] as number), null],
  233: [false, (DI[NORTHWEST] as number) + (DI[NORTH] as number), null],
  234: [false, (DI[NORTHEAST] as number) + (DI[NORTH] as number), null],
  235: [false, 2 * (DI[WEST] as number), null],
  236: [false, (DI[SOUTHWEST] as number) + (DI[WEST] as number), null],
  237: [false, (DI[NORTHWEST] as number) + (DI[WEST] as number), null],
};

export function doorObstacleIfClosed(cost: number, g: number): DoorRef {
  const entry = DOOR_OFFSETS[cost];
  if (!entry) return { obstacleIfClosed: false, door: -1, door2: -1 };
  const [obstacle, offset, offset2] = entry;
  return { obstacleIfClosed: obstacle, door: g + offset, door2: offset2 === null ? -1 : g + offset2 };
}

export function doorState(env: PathEnv, g: number, perceived: boolean): number {
  if (perceived) {
    const status = env.doorStatus(g);
    if (status) return (StructureFlags.DOOR | (status.perceivedOpen ? StructureFlags.OPEN : 0)) >>> 0;
  }
  return env.world.structures.find(g, StructureFlags.ANYDOOR)?.flags ?? StructureFlags.OPEN;
}

function heuristic(dx: number, dy: number): number {
  return dx < dy ? Math.trunc((LOWEST_STEP_COST * (dx * 14 + dy * 10)) / 14) : Math.trunc((LOWEST_STEP_COST * (dy * 14 + dx * 10)) / 14);
}

interface OpenHead {
  readonly loc: number;
  readonly g: number;
  readonly trail: number;
  readonly ap: number;
}

class OpenList {
  private readonly loc: number[] = [];
  private readonly g: number[] = [];
  private readonly total: number[] = [];
  private readonly leg: number[] = [];
  private readonly trail: number[] = [];
  private readonly ap: number[] = [];
  private readonly seq: number[] = [];
  private heap: number[] = [];
  private free: number[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  private before(a: number, b: number): boolean {
    const ta = this.total[a] as number;
    const tb = this.total[b] as number;
    if (ta !== tb) return ta < tb;
    const la = this.leg[a] as number;
    const lb = this.leg[b] as number;
    if (la !== lb) return la < lb;
    return (this.seq[a] as number) > (this.seq[b] as number);
  }

  push(loc: number, g: number, total: number, leg: number, trail: number, ap: number): void {
    const n = this.free.pop() ?? this.loc.length;
    this.loc[n] = loc;
    this.g[n] = g;
    this.total[n] = total;
    this.leg[n] = leg;
    this.trail[n] = trail;
    this.ap[n] = ap;
    this.seq[n] = this.counter++;
    const h = this.heap;
    let i = h.length;
    h.push(n);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(n, h[parent] as number)) break;
      h[i] = h[parent] as number;
      i = parent;
    }
    h[i] = n;
  }

  head(): OpenHead | null {
    const n = this.heap[0];
    if (n === undefined) return null;
    return { loc: this.loc[n] as number, g: this.g[n] as number, trail: this.trail[n] as number, ap: this.ap[n] as number };
  }

  pop(): void {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (top === undefined || last === undefined) return;
    this.free.push(top);
    if (h.length === 0) return;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= h.length) break;
      const r = l + 1;
      const c = r < h.length && this.before(h[r] as number, h[l] as number) ? r : l;
      if (!this.before(h[c] as number, last)) break;
      h[i] = h[c] as number;
      i = c;
    }
    h[i] = last;
  }
}

function budgetStepCost(nextCost: number, dir: number, mode: MoveMode, throughDoor: boolean): number | null {
  let ap: number;
  switch (nextCost) {
    case TravelCost.NONE:
      ap = 0;
      break;
    case TravelCost.DIRTROAD:
    case TravelCost.FLAT:
      ap = 3;
      break;
    case TravelCost.GRASS:
      ap = 4;
      break;
    case TravelCost.THICK:
      ap = 5;
      break;
    case TravelCost.DEBRIS:
      ap = 6;
      break;
    case TravelCost.SHORE:
      ap = 7;
      break;
    case TravelCost.KNEEDEEP:
      ap = 9;
      break;
    case TravelCost.DEEPWATER:
      ap = 8;
      break;
    case TravelCost.FENCE:
      ap = AP_JUMPFENCE;
      break;
    default:
      return null;
  }
  if (dir & 1) ap = Math.trunc((ap * 14) / 10);
  const water = nextCost === TravelCost.SHORE || nextCost === TravelCost.KNEEDEEP || nextCost === TravelCost.DEEPWATER;
  const apMode = water ? MoveMode.WALKING : mode;
  if (apMode === MoveMode.RUNNING) ap = Math.trunc((ap * 10) / RUN_DIVISOR_X10);
  else if (apMode === MoveMode.WALKING) ap = u8(ap + WALK_COST);
  else if (apMode === MoveMode.CRAWLING) ap = u8(ap + CRAWL_COST);
  if (nextCost === TravelCost.FENCE) {
    if (apMode === MoveMode.CRAWLING) return null;
    ap += AP_CROUCH;
  } else if (throughDoor) {
    ap += DOOR_APS_OPEN;
  }
  return u8(ap);
}

export function aiPathCostIndex(dx: number, dy: number): number {
  return (AI_PATHCOST_RADIUS + dx) * AI_PATHCOST_SIZE + AI_PATHCOST_RADIUS + dy;
}

export function findBestPath(env: PathEnv, s: PathSoldier, destination: number, level: number, options: PathOptions = {}): PathResult {
  const world = env.world;
  const mode = options.mode ?? MoveMode.WALKING;
  const copy = options.copy ?? PathCopy.NONE;
  const flags = options.flags ?? 0;
  const maxTrailTree = options.maxTrailTree ?? MAX_TRAIL_TREE;
  const copyCosts = copy === PathCopy.REACHABLE_AND_APS;
  const distLimit = copyCosts ? Math.min(options.distLimit ?? 0, AI_PATHCOST_RADIUS) : (options.distLimit ?? 0);
  let budget = options.budget ?? 0;
  const org = s.gridNo;
  if (org < 0 || org >= WORLD_MAX || !gridNoOnVisibleWorldTile(env.restrictedScrollId, org) || s.level !== level) return NO_PATH;

  const forPlayer = s.team === Team.OUR && !env.autoBandage && !s.underAiControl;
  const nonMerc = !isMercBody(s);
  if (nonMerc && isWater(world, destination)) return NO_PATH;
  const aroundPeople = (flags & PathFlags.THROUGH_PEOPLE) === 0;
  let closeGoodEnough = (flags & PathFlags.CLOSE_GOOD_ENOUGH) !== 0;
  let closeLimit = -1;
  if (closeGoodEnough) {
    closeLimit = Math.min(pythSpacesAway(org, destination) - 1, PATH_CLOSE_RADIUS);
    if (closeLimit <= 0) return NO_PATH;
  }
  const personAtDestIsObstacle = forPlayer && aroundPeople && !(flags & PathFlags.IGNORE_PERSON_AT_DEST);
  if (env.stats) env.stats.searches = u8(env.stats.searches + 1);

  let dest = destination;
  if (dest !== NOWHERE) {
    if (!newOKDestination(env, s, dest, personAtDestIsObstacle, level, options.plotToExitGrid, options.estimate)) return NO_PATH;
    if (dest === org) return NO_PATH;
  }
  if (budget) {
    const start = env.minAPsToStartMovement?.(s, mode) ?? 0;
    if (start > budget) return NO_PATH;
    budget -= start;
  }

  const copyReachable = copy >= PathCopy.REACHABLE;
  const visitOnce = copy === PathCopy.REACHABLE;
  const reachable = copyReachable ? new Uint8Array(WORLD_MAX) : null;
  const apCosts = copyCosts ? new Int8Array(AI_PATHCOST_SIZE * AI_PATHCOST_SIZE) : null;
  const apCostIndex = (loc: number) =>
    aiPathCostIndex((loc % WORLD_COLS) - (org % WORLD_COLS), Math.trunc(loc / WORLD_COLS) - Math.trunc(org / WORLD_COLS));
  const destX = dest % WORLD_COLS;
  const destY = Math.trunc(dest / WORLD_COLS);
  const waterCost = (c: number) => c === TravelCost.KNEEDEEP || c === TravelCost.DEEPWATER;
  const waterToWater = dest !== NOWHERE && waterCost(world.costs.get(org, 0, level)) && waterCost(world.costs.get(dest, 0, level));
  const trailCost = new Uint16Array(WORLD_MAX);
  const used = new Uint8Array(WORLD_MAX);
  const trailPrev: number[] = [0];
  const trailDir: number[] = [0];
  const trailGrid: number[] = [0];
  const trailBack: boolean[] = [false];
  const shape = env.multiTile?.(s, mode) ?? null;
  const structures = shape?.structures ?? null;
  const continuous = structures !== null && shape?.continuousTurn === true;
  const shapeId = options.estimate ? IGNORE_PEOPLE_STRUCTURE_ID : (shape?.structureId ?? IGNORE_PEOPLE_STRUCTURE_ID);
  const fits = (g: number, index: number) =>
    okayForShape(env, g, level, structures?.[index], shapeId, shapeId === IGNORE_PEOPLE_STRUCTURE_ID);
  const facingAt = (trail: number) => {
    if (trailPrev.length < 2) return shape?.direction ?? 0;
    const dir = trailDir[trail] as number;
    return trailBack[trail] ? oppositeDirection(dir) : dir;
  };
  const open = new OpenList();
  const remaining = (loc: number) => heuristic(Math.abs(destX - (loc % WORLD_COLS)), Math.abs(destY - Math.trunc(loc / WORLD_COLS)));
  const legDistance = (loc: number) => u8(Math.abs(destX - (loc % WORLD_COLS)) + Math.abs(destY - Math.trunc(loc / WORLD_COLS)));
  const costToGo = (loc: number) => (copyReachable ? REACHABLE_COST_TO_GO : remaining(loc));
  open.push(org, 0, u16(costToGo(org)), legDistance(org), 0, 0);
  trailCost[org] = 0;

  let goingThroughDoor = false;
  const expand = (cur: OpenHead, dir: number, structIndex: number, backwards: boolean): boolean => {
    const curLoc = cur.loc;
    const newLoc = curLoc + (DIRECTION_INCREMENT[dir] as number);
    if (newLoc < 0 || newLoc >= WORLD_MAX) return EXPANDED;
    if (visitOnce && used[newLoc] === 1) return EXPANDED;
    if (world.heights[newLoc] !== world.heights[curLoc]) return EXPANDED;
    if (distLimit && (options.circular ? pythSpacesAway(org, newLoc) : spacesAway(org, newLoc)) > distLimit) return EXPANDED;

    let nextCost = world.costs.get(newLoc, dir, level);
    if (nextCost === TravelCost.NOT_STANDING) {
      nextCost = terrainCost(world, newLoc);
    } else if (nextCost === TravelCost.EXITGRID) {
      if (options.plotToExitGrid) nextCost = terrainCost(world, newLoc);
    } else if (nextCost === TravelCost.FENCE && nonMerc) {
      return EXPANDED;
    } else if (isDoorTravelCost(nextCost)) {
      const ref = doorObstacleIfClosed(nextCost, newLoc);
      const state = doorState(env, ref.door, forPlayer);
      let doorOpen = false;
      if (ref.door2 === -1) {
        if (!has(state, StructureFlags.ANYDOOR)) nextCost = terrainCost(world, newLoc);
        else {
          doorOpen = has(state, StructureFlags.OPEN);
          if (has(state, StructureFlags.GARAGEDOOR) && dir & 1 && !doorOpen) return EXPANDED;
        }
      } else {
        const state2 = doorState(env, ref.door2, forPlayer);
        if (!has(state, StructureFlags.ANYDOOR) && !has(state2, StructureFlags.ANYDOOR)) nextCost = terrainCost(world, newLoc);
        else if (!has(state, StructureFlags.OPEN) || !has(state2, StructureFlags.OPEN)) return EXPANDED;
        doorOpen = true;
      }
      if (isDoorTravelCost(nextCost)) {
        if (doorOpen) nextCost = ref.obstacleIfClosed ? terrainCost(world, newLoc) : TravelCost.OBSTACLE;
        else if (ref.obstacleIfClosed) {
          if (forPlayer || s.monsterOrAnimal) nextCost = TravelCost.OBSTACLE;
          else {
            const mapDoor = world.mapDoors.get(ref.door);
            if (!mapDoor) nextCost = terrainCost(world, newLoc);
            else if (!mapDoor.locked || s.hasKeys) {
              if (budget) goingThroughDoor = true;
              nextCost = terrainCost(world, newLoc);
            } else nextCost = TravelCost.OBSTACLE;
          }
        } else nextCost = terrainCost(world, newLoc);
      }
    } else if ((nextCost === TravelCost.SHORE || nextCost === TravelCost.KNEEDEEP || nextCost === TravelCost.DEEPWATER) && nonMerc) {
      nextCost = TravelCost.OBSTACLE;
    }
    if (nextCost >= TravelCost.BLOCKED) return EXPANDED;

    if (aroundPeople && (newLoc !== dest || copyReachable)) {
      const who = env.whoIsThere(newLoc, s.level);
      if (who && who.id !== s.id) return EXPANDED;
    }
    if (structures && !fits(newLoc, structIndex)) return EXPANDED;

    let newAp = 0;
    if (budget) {
      const step = budgetStepCost(nextCost, dir, mode, goingThroughDoor);
      if (step === null) return EXPANDED;
      if (goingThroughDoor && nextCost !== TravelCost.FENCE) goingThroughDoor = false;
      newAp = u8(cur.ap + step);
      if (newAp > budget) return EXPANDED;
    }

    if (closeGoodEnough && pythSpacesAway(newLoc, dest) <= closeLimit) {
      dest = newLoc;
      closeGoodEnough = false;
    }
    if (newLoc === dest) nextCost = 0;
    if (waterToWater && waterCost(nextCost)) nextCost = EASYWATERCOST;
    if (dir & 1) nextCost = Math.trunc((nextCost * 14) / 10);
    if (backwards) nextCost += BACKWARDS_STEP_PENALTY;
    const newTotal = cur.g + nextCost;
    if (used[newLoc] === 1 && newTotal >= (trailCost[newLoc] as number)) return EXPANDED;
    if (open.size === POOL_NODES) return ABORTED;
    trailPrev.push(cur.trail);
    trailDir.push(dir);
    trailGrid.push(newLoc);
    trailBack.push(backwards);
    if (trailPrev.length >= maxTrailTree) return ABORTED;
    const cost = u16(newTotal);
    open.push(newLoc, cost, u16(cost + costToGo(newLoc)), legDistance(newLoc), trailPrev.length - 1, newAp);
    if (budget && apCosts) apCosts[apCostIndex(newLoc)] = newAp;
    trailCost[newLoc] = cost;
    used[newLoc] = 1;
    return EXPANDED;
  };

  let cnt = 0;
  let loopStart = 0;
  let loopEnd = 0;
  let loopState: number = Looping.CLOCKWISE;
  let lastDir = 0;
  let checkedBehind = false;
  for (;;) {
    const cur = open.head();
    if (!cur || cur.loc === dest) break;
    open.pop();
    if (reachable && world.costs.get(trailGrid[cur.trail] as number, trailDir[cur.trail] as number, level) !== TravelCost.FENCE)
      reachable[cur.loc] = 1;
    let toNextDirection = used[cur.loc] === 1 && (trailCost[cur.loc] as number) < cur.g;
    if (!toNextDirection) {
      if (continuous) {
        lastDir = facingAt(cur.trail);
        loopStart = lastDir;
        loopEnd = lastDir;
        loopState = Looping.CLOCKWISE;
        checkedBehind = false;
      }
      cnt = loopStart;
    }
    for (;;) {
      if (!toNextDirection) {
        const structIndex = loopState === Looping.REVERSE ? oppositeDirection(oneCDirection(cnt)) : oneCDirection(cnt);
        let canTurn = true;
        if (continuous) {
          if (cnt !== lastDir && !fits(cur.loc, structIndex)) {
            canTurn = false;
            if (loopState === Looping.CLOCKWISE) {
              loopStart = lastDir;
              loopEnd = cnt;
              loopState = Looping.COUNTERCLOCKWISE;
              cnt = loopStart;
            } else if (loopState === Looping.COUNTERCLOCKWISE && !checkedBehind) {
              loopState = Looping.REVERSE;
              loopStart = oppositeDirection(oneCCDirection(lastDir));
              loopEnd = (loopStart + 2) % DIRECTIONS;
              cnt = loopStart;
              checkedBehind = true;
            } else break;
          }
        } else if (structures && !fits(cur.loc, structIndex)) canTurn = false;
        if (canTurn && expand(cur, cnt, structIndex, loopState === Looping.REVERSE) === ABORTED) return NO_PATH;
      }
      toNextDirection = false;
      cnt = loopState === Looping.CLOCKWISE ? oneCCDirection(cnt) : oneCDirection(cnt);
      if (cnt === loopEnd) break;
      if (continuous && cnt === oppositeDirection(loopStart)) checkedBehind = true;
    }
  }

  const head = open.head();
  if (reachable) {
    const reachedDestination = dest !== NOWHERE && head?.loc === dest;
    return apCosts
      ? { length: 0, steps: [], reachable, apCosts, reachedDestination }
      : { length: 0, steps: [], reachable, reachedDestination };
  }
  if (!head || head.loc !== dest) return NO_PATH;
  const steps: number[] = [];
  for (let z = head.trail; z !== 0; z = trailPrev[z] as number) steps.push(trailDir[z] as number);
  steps.reverse();
  if (copy === PathCopy.ROUTE) {
    const route = steps.slice(0, MAX_PATH_LIST_SIZE);
    return { length: route.length, steps: route };
  }
  const plain = steps.slice(0, PLAIN_PATH_LIMIT);
  return { length: u8(plain.length), steps: plain };
}
