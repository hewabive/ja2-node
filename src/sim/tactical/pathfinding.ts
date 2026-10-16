// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/PathAI.cc FindBestPath, IsDoorObstacleIfClosed, GetDoorState; Overhead.cc NewOKDestination,
// @src IsDestinationBlocked; TileEngine/WorldMan.cc WhoIsThere2, Water. See docs/07 §3.

import type { MapDoor } from '../../content/formats/map.ts';
import {
  DIRECTION_INCREMENT,
  Direction,
  isVisibleTile,
  pythSpacesAway,
  spacesAway,
  WORLD_COLS,
  WORLD_MAX,
} from '../../content/world/grid.ts';
import { isDoorTravelCost, type MovementCosts, TravelCost } from '../../content/world/movement-costs.ts';
import { has, STRUCTURE_ON_GROUND, STRUCTURE_ON_ROOF, StructureFlags, type WorldStructures } from '../../content/world/structures.ts';
import { TERRAIN_MOVEMENT_COST, Terrain } from '../../content/world/terrain.ts';
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
const PLAIN_PATH_LIMIT = 256;
const DIRECTION_ORDER = [0, 7, 6, 5, 4, 3, 2, 1] as const;
const EASYWATERCOST = 5;
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

export interface PathWorld {
  readonly costs: MovementCosts;
  readonly terrain: Uint8Array;
  readonly heights: Uint8Array;
  readonly structures: WorldStructures;
  readonly mapDoors: ReadonlyMap<number, MapDoor>;
}

export interface PathEnv {
  readonly world: PathWorld;
  whoIsThere(g: number, level: number): PathSoldier | null;
  doorStatus(g: number): DoorStatus | null;
  readonly showAllMercs: boolean;
  readonly autoBandage: boolean;
  readonly minAPsToStartMovement?: (s: PathSoldier, mode: MoveMode) => number;
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
}

export interface PathResult {
  readonly length: number;
  readonly steps: readonly number[];
  readonly reachable?: Uint8Array;
  readonly apCosts?: Int8Array;
}

const NO_PATH: PathResult = { length: 0, steps: [] };
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

export function newOKDestination(
  env: PathEnv,
  s: PathSoldier,
  g: number,
  peopleToo: boolean,
  level: number,
  plotToExitGrid = false,
): boolean {
  if (!isVisibleTile(g)) return false;
  if (peopleToo) {
    const person = env.whoIsThere(g, level);
    if (person && (person.id !== s.id || g === s.gridNo) && (s.team !== Team.OUR || person.visible >= 0 || env.showAllMercs)) return false;
  }
  return !isDestinationBlocked(env, g, level, plotToExitGrid);
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
  return dx < dy ? Math.trunc((EASYWATERCOST * (dx * 14 + dy * 10)) / 14) : Math.trunc((EASYWATERCOST * (dy * 14 + dx * 10)) / 14);
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

  head(): { loc: number; g: number; trail: number; ap: number } | null {
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
  else if (apMode === MoveMode.WALKING) ap = (ap + WALK_COST) & 0xff;
  else if (apMode === MoveMode.CRAWLING) ap = (ap + CRAWL_COST) & 0xff;
  if (nextCost === TravelCost.FENCE) {
    if (apMode === MoveMode.CRAWLING) return null;
    ap += AP_CROUCH;
  } else if (throughDoor) {
    ap += DOOR_APS_OPEN;
  }
  return ap & 0xff;
}

export function aiPathCostIndex(dx: number, dy: number): number {
  return (AI_PATHCOST_RADIUS + dx) * AI_PATHCOST_SIZE + AI_PATHCOST_RADIUS + dy;
}

export function findBestPath(env: PathEnv, s: PathSoldier, destination: number, level: number, options: PathOptions = {}): PathResult {
  const world = env.world;
  const mode = options.mode ?? MoveMode.WALKING;
  const copy = options.copy ?? PathCopy.NONE;
  const flags = options.flags ?? 0;
  const copyCosts = copy === PathCopy.REACHABLE_AND_APS;
  const distLimit = copyCosts ? Math.min(options.distLimit ?? 0, AI_PATHCOST_RADIUS) : (options.distLimit ?? 0);
  let budget = options.budget ?? 0;
  const org = s.gridNo;
  if (org < 0 || org >= WORLD_MAX || !isVisibleTile(org) || s.level !== level) return NO_PATH;

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
  if (env.stats) env.stats.searches = (env.stats.searches + 1) & 0xff;

  let dest = destination;
  if (dest !== NOWHERE) {
    if (!newOKDestination(env, s, dest, personAtDestIsObstacle, level, options.plotToExitGrid)) return NO_PATH;
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
  const open = new OpenList();
  const remaining = (loc: number) => heuristic(Math.abs(destX - (loc % WORLD_COLS)), Math.abs(destY - Math.trunc(loc / WORLD_COLS)));
  const legDistance = (loc: number) => (Math.abs(destX - (loc % WORLD_COLS)) + Math.abs(destY - Math.trunc(loc / WORLD_COLS))) & 0xff;
  const costToGo = (loc: number) => (copyReachable ? REACHABLE_COST_TO_GO : remaining(loc));
  open.push(org, 0, costToGo(org) & 0xffff, legDistance(org), 0, 0);
  trailCost[org] = 0;

  let goingThroughDoor = false;
  for (;;) {
    const cur = open.head();
    if (!cur || cur.loc === dest) break;
    open.pop();
    const curLoc = cur.loc;
    const curCost = cur.g;
    if (reachable && world.costs.get(trailGrid[cur.trail] as number, trailDir[cur.trail] as number, level) !== TravelCost.FENCE)
      reachable[curLoc] = 1;
    const stale = used[curLoc] === 1 && (trailCost[curLoc] as number) < curCost;
    for (let k = stale ? 1 : 0; k < DIRECTION_ORDER.length; k++) {
      const dir = DIRECTION_ORDER[k] as number;
      const newLoc = curLoc + (DIRECTION_INCREMENT[dir] as number);
      if (newLoc < 0 || newLoc >= WORLD_MAX) continue;
      if (visitOnce && used[newLoc] === 1) continue;
      if (world.heights[newLoc] !== world.heights[curLoc]) continue;
      if (distLimit && (options.circular ? pythSpacesAway(org, newLoc) : spacesAway(org, newLoc)) > distLimit) continue;

      let nextCost = world.costs.get(newLoc, dir, level);
      if (nextCost === TravelCost.NOT_STANDING) {
        nextCost = terrainCost(world, newLoc);
      } else if (nextCost === TravelCost.EXITGRID) {
        if (options.plotToExitGrid) nextCost = terrainCost(world, newLoc);
      } else if (nextCost === TravelCost.FENCE && nonMerc) {
        continue;
      } else if (isDoorTravelCost(nextCost)) {
        const ref = doorObstacleIfClosed(nextCost, newLoc);
        const state = doorState(env, ref.door, forPlayer);
        let doorOpen = false;
        if (ref.door2 === -1) {
          if (!has(state, StructureFlags.ANYDOOR)) nextCost = terrainCost(world, newLoc);
          else {
            doorOpen = has(state, StructureFlags.OPEN);
            if (has(state, StructureFlags.GARAGEDOOR) && dir & 1 && !doorOpen) continue;
          }
        } else {
          const state2 = doorState(env, ref.door2, forPlayer);
          if (!has(state, StructureFlags.ANYDOOR) && !has(state2, StructureFlags.ANYDOOR)) nextCost = terrainCost(world, newLoc);
          else if (!has(state, StructureFlags.OPEN) || !has(state2, StructureFlags.OPEN)) continue;
          doorOpen = true;
        }
        if (isDoorTravelCost(nextCost)) {
          if (doorOpen) nextCost = ref.obstacleIfClosed ? terrainCost(world, newLoc) : TravelCost.OBSTACLE;
          else if (ref.obstacleIfClosed) {
            if (forPlayer || s.monsterOrAnimal) nextCost = TravelCost.OBSTACLE;
            else {
              const mapDoor = world.mapDoors.get(ref.door);
              if (!mapDoor?.locked || s.hasKeys) {
                if (budget) goingThroughDoor = true;
                nextCost = terrainCost(world, newLoc);
              } else nextCost = TravelCost.OBSTACLE;
            }
          } else nextCost = terrainCost(world, newLoc);
        }
      } else if ((nextCost === TravelCost.SHORE || nextCost === TravelCost.KNEEDEEP || nextCost === TravelCost.DEEPWATER) && nonMerc) {
        nextCost = TravelCost.OBSTACLE;
      }
      if (nextCost >= TravelCost.BLOCKED) continue;

      if (aroundPeople && (newLoc !== dest || copyReachable)) {
        const who = env.whoIsThere(newLoc, s.level);
        if (who && who.id !== s.id) continue;
      }

      let newAp = 0;
      if (budget) {
        const step = budgetStepCost(nextCost, dir, mode, goingThroughDoor);
        if (step === null) continue;
        if (goingThroughDoor && nextCost !== TravelCost.FENCE) goingThroughDoor = false;
        newAp = (cur.ap + step) & 0xff;
        if (newAp > budget) continue;
      }

      if (closeGoodEnough && pythSpacesAway(newLoc, dest) <= closeLimit) {
        dest = newLoc;
        closeGoodEnough = false;
      }
      if (newLoc === dest) nextCost = 0;
      if (waterToWater && waterCost(nextCost)) nextCost = EASYWATERCOST;
      if (dir & 1) nextCost = Math.trunc((nextCost * 14) / 10);
      const newTotal = curCost + nextCost;
      if (used[newLoc] === 1 && newTotal >= (trailCost[newLoc] as number)) continue;
      if (open.size === POOL_NODES) return NO_PATH;
      trailPrev.push(cur.trail);
      trailDir.push(dir);
      trailGrid.push(newLoc);
      if (trailPrev.length >= MAX_TRAIL_TREE) return NO_PATH;
      const cost = newTotal & 0xffff;
      open.push(newLoc, cost, (cost + costToGo(newLoc)) & 0xffff, legDistance(newLoc), trailPrev.length - 1, newAp);
      if (budget && apCosts) apCosts[apCostIndex(newLoc)] = newAp;
      trailCost[newLoc] = cost;
      used[newLoc] = 1;
    }
  }

  if (reachable) return apCosts ? { length: 0, steps: [], reachable, apCosts } : { length: 0, steps: [], reachable };
  const head = open.head();
  if (!head || head.loc !== dest) return NO_PATH;
  const steps: number[] = [];
  for (let z = head.trail; z !== 0; z = trailPrev[z] as number) steps.push(trailDir[z] as number);
  steps.reverse();
  if (copy === PathCopy.ROUTE) {
    const route = steps.slice(0, MAX_PATH_LIST_SIZE);
    return { length: route.length, steps: route };
  }
  const plain = steps.slice(0, PLAIN_PATH_LIMIT);
  return { length: plain.length & 0xff, steps: plain };
}
