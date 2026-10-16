// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Pathing.cc FindStratPath (queue, trail tree, QUESEARCH, ESTIMATE1, FARTHER),
// @src BuildAStrategicPath, AppendStrategicPath, ClearStrategicPathListAfterThisSector, RemoveTailFromStrategicPath,
// @src RemoveHeadFromStrategicPath, GetLengthOfPath. See docs/16 §3.2.

import { isValidSector, MAP_WORLD_CELLS, MAP_WORLD_X, sectorFromStrategicIndex, sectorId } from '../../../content/strategic/sector-ids.ts';
import { Direction } from '../../../content/world/grid.ts';
import { idiv } from '../../../core/int.ts';
import { TRAVERSE_TIME_IMPOSSIBLE } from './travel.ts';

export const MAX_PATH_LIST_SIZE = 30;
const MAX_TRAIL_TREE = 4096;
const MAX_PATH_Q = 512;
const QHEADNDX = 0;
const QPOOLNDX = MAX_PATH_Q - 1;
const TRAILCELLMAX = 0xffffffff;
const MAXCOST = 99900;
const FIRST_QUEUE_REQUEST = 2;
const STRAIGHT_COST = 10;
const DIAGONAL_COST = 14;
const NORTH_MOVE = -MAP_WORLD_X;
const SOUTH_MOVE = MAP_WORLD_X;
const EAST_MOVE = 1;
const WEST_MOVE = -1;
const STRAT_DELTA: readonly number[] = [
  -MAP_WORLD_X,
  1 - MAP_WORLD_X,
  1,
  1 + MAP_WORLD_X,
  MAP_WORLD_X,
  MAP_WORLD_X - 1,
  -1,
  -MAP_WORLD_X - 1,
];
const DIRECTION_STEP = 2;
const MIN_PATH_SECTOR = MAP_WORLD_X - 1;

export interface StratPathRules {
  readonly edgeCost: (fromSectorId: number, strategicMove: number) => number;
  readonly helicopterCost?: ((fromStrategicIndex: number) => number) | undefined;
  readonly tacticalTraversal?: boolean | undefined;
  readonly direct?: boolean | undefined;
  readonly flatTravelTime?: number | undefined;
  readonly traversability?: ((fromSectorId: number, toSectorId: number) => number) | undefined;
  readonly groundBarrier?: number | undefined;
  readonly avoid?: ((strategicIndex: number) => boolean) | undefined;
}

class PathQueue {
  readonly next = new Int32Array(MAX_PATH_Q);
  readonly prev = new Int32Array(MAX_PATH_Q);
  readonly location = new Int32Array(MAX_PATH_Q);
  readonly pathNdx = new Int32Array(MAX_PATH_Q);
  readonly costSoFar = new Float64Array(MAX_PATH_Q);
  readonly costToGo = new Float64Array(MAX_PATH_Q);

  total(n: number): number {
    return (this.costSoFar[n] ?? 0) + (this.costToGo[n] ?? 0);
  }

  remove(n: number): void {
    const p = this.prev[n] ?? 0;
    const x = this.next[n] ?? 0;
    this.next[p] = x;
    this.prev[x] = p;
  }

  insertBefore(n: number, cur: number): void {
    const p = this.prev[cur] ?? 0;
    this.next[n] = cur;
    this.prev[n] = p;
    this.next[p] = n;
    this.prev[cur] = n;
  }

  release(n: number): void {
    this.remove(n);
    this.insertBefore(n, QPOOLNDX);
    this.location[n] = -1;
  }
}

function estimate(loc: number, destX: number, destY: number): number {
  const dy = Math.abs(destY - idiv(loc, MAP_WORLD_X));
  const dx = Math.abs(destX - (loc % MAP_WORLD_X));
  return dx < dy ? idiv(dx * DIAGONAL_COST, STRAIGHT_COST) + dy : idiv(dy * DIAGONAL_COST, STRAIGHT_COST) + dx;
}

function legDistance(a: number, b: number): number {
  return Math.abs((b % MAP_WORLD_X) - (a % MAP_WORLD_X)) + Math.abs(idiv(b, MAP_WORLD_X) - idiv(a, MAP_WORLD_X));
}

export function findStratPath(start: number, destination: number, rules: StratPathRules): number[] {
  const q = new PathQueue();
  const trailNext = new Int32Array(MAX_TRAIL_TREE);
  const trailDelta = new Int32Array(MAX_TRAIL_TREE);
  const trailCost = new Float64Array(MAP_WORLD_CELLS).fill(TRAILCELLMAX);
  const destY = idiv(destination, MAP_WORLD_X);
  const destX = destination % MAP_WORLD_X;
  let queRequests = FIRST_QUEUE_REQUEST;

  q.location[QHEADNDX] = start;
  q.next[QHEADNDX] = 1;
  q.prev[QHEADNDX] = 1;
  q.costSoFar[QHEADNDX] = MAXCOST;
  q.next[QPOOLNDX] = QPOOLNDX;
  q.prev[QPOOLNDX] = QPOOLNDX;
  q.next[1] = QHEADNDX;
  q.prev[1] = QHEADNDX;
  q.location[1] = start;
  q.pathNdx[1] = 0;
  q.costSoFar[1] = 0;
  q.costToGo[1] = estimate(start, destX, destY);
  trailCost[start] = 0;
  let trailIndex = 1;

  const farther = (a: number, b: number) => legDistance(q.location[a] ?? 0, destination) > legDistance(q.location[b] ?? 0, destination);
  const queueSearch = (n: number): number => {
    const k = q.total(n);
    let at = q.next[QHEADNDX] ?? 0;
    while (at && k > q.total(at)) at = q.next[at] ?? 0;
    while (at && k === q.total(at) && farther(n, at)) at = q.next[at] ?? 0;
    return at;
  };

  do {
    const ndx: number = q.next[QHEADNDX] ?? 0;
    const curLoc: number = q.location[ndx] ?? 0;
    const curCost: number = q.costSoFar[ndx] ?? 0;
    q.release(ndx);
    if ((trailCost[curLoc] ?? 0) < curCost) continue;
    const curId = sectorId(sectorFromStrategicIndex(curLoc));
    for (let iCnt = 0; iCnt < 8; iCnt += DIRECTION_STEP) {
      const newLoc = (curLoc + (STRAT_DELTA[iCnt] ?? 0)) & 0xffff;
      const target = sectorFromStrategicIndex(newLoc);
      if (!isValidSector(target)) continue;
      if (rules.avoid && newLoc !== destination && rules.avoid(newLoc)) continue;
      let nextCost = rules.edgeCost(curId, iCnt / DIRECTION_STEP) >>> 0;
      if (nextCost === TRAVERSE_TIME_IMPOSSIBLE) continue;
      if (rules.helicopterCost) nextCost = rules.helicopterCost(curLoc);
      if (rules.tacticalTraversal) {
        if (curCost === 0 && newLoc === destination && rules.traversability?.(curId, sectorId(target)) !== rules.groundBarrier)
          nextCost = 0;
      } else if (rules.direct) {
        nextCost = rules.flatTravelTime ?? nextCost;
      }
      const newTotal = curCost + nextCost;
      if (!(newTotal < (trailCost[newLoc] ?? TRAILCELLMAX))) continue;
      let qNew: number;
      if (queRequests < QPOOLNDX) qNew = queRequests++;
      else {
        qNew = q.next[QPOOLNDX] ?? 0;
        q.remove(qNew);
      }
      if (qNew === QHEADNDX || qNew === QPOOLNDX) return [];
      trailNext[trailIndex] = q.pathNdx[ndx] ?? 0;
      trailDelta[trailIndex] = iCnt;
      q.pathNdx[qNew] = trailIndex;
      trailIndex++;
      if (trailIndex >= MAX_TRAIL_TREE) return [];
      q.location[qNew] = newLoc;
      q.costSoFar[qNew] = newTotal;
      q.costToGo[qNew] = estimate(newLoc, destX, destY);
      trailCost[newLoc] = newTotal;
      q.insertBefore(qNew, queueSearch(qNew));
    }
  } while (q.next[QHEADNDX] !== QHEADNDX && q.location[q.next[QHEADNDX] ?? 0] !== destination);

  if (q.location[q.next[QHEADNDX] ?? 0] !== destination) return [];
  let reversed = 0;
  let z = q.pathNdx[q.next[QHEADNDX] ?? 0] ?? 0;
  while (z) {
    const following = trailNext[z] ?? 0;
    trailNext[z] = reversed;
    reversed = z;
    z = following;
  }
  const directions: number[] = [];
  for (z = reversed; z && directions.length < MAX_PATH_LIST_SIZE; z = trailNext[z] ?? 0) directions.push(trailDelta[z] ?? 0);
  return directions;
}

function moveForDirection(direction: number, previous: number): number {
  if (direction === Direction.NORTH) return NORTH_MOVE;
  if (direction === Direction.SOUTH) return SOUTH_MOVE;
  if (direction === Direction.EAST) return EAST_MOVE;
  if (direction === Direction.WEST) return WEST_MOVE;
  return previous;
}

export function buildStrategicPath(start: number, end: number, rules: StratPathRules): number[] | null {
  if (end < MIN_PATH_SECTOR) return null;
  const directions = findStratPath(start, end, rules);
  if (directions.length === 0) return null;
  const path = [start];
  let current = start;
  let delta = 0;
  for (const d of directions) {
    delta = moveForDirection(d, delta);
    current += delta;
    if (current < MIN_PATH_SECTOR) return null;
    path.push(current);
  }
  return path;
}

export function appendStrategicPath(section: readonly number[] | null, head: readonly number[]): number[] {
  if (!section || section.length === 0) return [...head];
  if (head.length === 0) return [...section];
  const tail = head[head.length - 1];
  return tail === section[0] ? [...head, ...section.slice(1)] : [...head, ...section];
}

export function clearStrategicPathAfterSector(path: readonly number[], strategicIndexToKeep: number): number[] {
  const at = path.lastIndexOf(strategicIndexToKeep);
  return at < 0 ? [...path] : path.slice(0, at + 1);
}

export function removeTailFromStrategicPath(path: readonly number[]): number[] {
  return path.slice(0, -1);
}

export function removeHeadFromStrategicPath(path: readonly number[]): number[] {
  return path.slice(1);
}

export function lastSectorOfPath(path: readonly number[], fallback: number): number {
  return path.length > 0 ? (path[path.length - 1] ?? fallback) : fallback;
}
