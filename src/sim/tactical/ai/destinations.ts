// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/Movement.cc LegalNPCDestination, InternalGoAsFarAsPossibleTowards, NextPatrolPoint,
// @src PointPatrolAI, RandomPointPatrolAI; AIUtils.cc RoamingRange, RandDestWithinRange, RandomFriendWithin.

import { isVisibleTile, newGridNo, spacesAway, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../../content/world/grid.ts';
import { DIRECTION_INCREMENT } from '../directions.ts';
import { findBestPath, isWater, NOWHERE, newOKDestination, PathCopy } from '../pathfinding.ts';
import { estimateActionPointCost } from '../points.ts';
import { AlertStatus, Body, NO_PROFILE, Orders, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { MAX_ROAMING_RANGE } from './actions.ts';

export const PathMode = { IGNORE_PATH: 0, ENSURE_PATH: 1, ENSURE_PATH_COST: 2 } as const;
const NO_ROOM = 0;
const MAX_PATROL_POINTS = 10;

function step(direction: number): number {
  return DIRECTION_INCREMENT[direction > 7 ? 1 : direction] ?? 0;
}

export function roomAt(t: TacticalState, g: number): number {
  return t.world.level.rooms[g] ?? NO_ROOM;
}

export function legalNPCDestination(t: TacticalState, s: Soldier, g: number, mode: number, waterOK: boolean, flags: number): boolean {
  if (g < 0 || g >= WORLD_MAX) return false;
  const heights = t.world.level.heights;
  if (isVisibleTile(s.gridNo) && heights[s.gridNo] !== heights[g]) return false;
  const skipTilesWithMercs = t.inCombat && mode !== PathMode.IGNORE_PATH && spacesAway(s.gridNo, g) === 1;
  if (!newOKDestination(t.pathEnv, s, g, skipTilesWithMercs, s.level) || g === s.gridNo || g === s.ai.blackList) return false;
  if (!waterOK && isWater(t.pathWorld, g)) return false;
  if (mode !== PathMode.ENSURE_PATH) return true;
  const route = findBestPath(t.pathEnv, s, g, s.level, { copy: PathCopy.ROUTE, flags });
  if (route.length === 0) return false;
  s.path = [...route.steps];
  s.pathIndex = 0;
  s.pathSize = route.length;
  return true;
}

export function roamingRange(s: Soldier): { range: number; origin: number } {
  const ai = s.ai;
  if (isCreatureOrBloodcat(s) && ai.alertStatus === AlertStatus.BLACK) return { origin: s.gridNo, range: MAX_ROAMING_RANGE };
  const patrolOrigin =
    ai.orders === Orders.POINTPATROL || ai.orders === Orders.RNDPTPATROL ? ai.patrolGrid[ai.nextPatrolPoint] : ai.patrolGrid[0];
  const origin = patrolOrigin ?? s.gridNo;
  switch (ai.orders) {
    case Orders.STATIONARY:
      return { origin, range: s.profile !== NO_PROFILE || (ai.alertStatus < AlertStatus.BLACK && !ai.underFire) ? 0 : 5 };
    case Orders.ONGUARD:
      return { origin, range: 5 };
    case Orders.CLOSEPATROL:
      return { origin, range: 15 };
    case Orders.RNDPTPATROL:
    case Orders.POINTPATROL:
      return { origin, range: 10 };
    case Orders.FARPATROL:
      return { origin, range: ai.alertStatus < AlertStatus.RED ? 25 : 50 };
    case Orders.ONCALL:
      return { origin, range: ai.alertStatus < AlertStatus.RED ? 10 : 30 };
    case Orders.SEEKENEMY:
      return { origin: s.gridNo, range: MAX_ROAMING_RANGE };
    default:
      return { origin, range: 0 };
  }
}

function roomLimited(s: Soldier): boolean {
  return s.ai.orders <= Orders.CLOSEPATROL && (s.team === Team.CIV || s.profile !== NO_PROFILE);
}

export function randDestWithinRange(t: TacticalState, s: Soldier): number {
  let tries = t.inCombat ? 10 : 1;
  const { range, origin } = roamingRange(s);
  const room = roomLimited(s) ? roomAt(t, s.ai.patrolGrid[0] ?? s.gridNo) : NO_ROOM;
  const limited = range < WORLD_COLS - 1;
  const originX = origin % WORLD_COLS;
  const originY = Math.trunc(origin / WORLD_COLS);
  const maxLeft = Math.min(range, originX);
  const maxRight = Math.min(range, WORLD_COLS - (originX + 1));
  const maxUp = Math.min(range, originY);
  const maxDown = Math.min(range, WORLD_ROWS - (originY + 1));
  if (s.bodyType === Body.LARVAE_MONSTER) {
    const bounds = { originX, originY, maxLeft, maxRight, maxUp, maxDown };
    return larvaeCrawlDest(t, s, tries, limited, origin, bounds);
  }
  while (tries-- > 0) {
    let dest: number;
    if (limited) {
      const dx = t.rng.int(maxLeft + maxRight + 1) - maxLeft;
      const dy = t.rng.int(maxUp + maxDown + 1) - maxUp;
      dest = origin + dx + WORLD_COLS * dy;
    } else {
      dest = t.pre.int(WORLD_MAX);
    }
    if (room !== NO_ROOM) {
      const destRoom = roomAt(t, dest);
      if (destRoom !== NO_ROOM && destRoom !== room) continue;
    }
    if (!legalNPCDestination(t, s, dest, PathMode.ENSURE_PATH, false, 0)) continue;
    s.pathStored = true;
    return dest;
  }
  return NOWHERE;
}

interface RoamBounds {
  readonly originX: number;
  readonly originY: number;
  readonly maxLeft: number;
  readonly maxRight: number;
  readonly maxUp: number;
  readonly maxDown: number;
}

function insideRoamBounds(s: Soldier, dx: number, dy: number, b: RoamBounds): boolean {
  const x = (s.gridNo % WORLD_COLS) + dx;
  const y = Math.trunc(s.gridNo / WORLD_COLS) + dy;
  return x >= b.originX - b.maxLeft && x <= b.originX + b.maxRight && y >= b.originY - b.maxUp && y <= b.originY + b.maxDown;
}

function larvaeCrawlDest(t: TacticalState, s: Soldier, triesIn: number, limited: boolean, origin: number, bounds: RoamBounds): number {
  let tries = triesIn;
  while (tries-- > 0) {
    const dx = t.rng.int(3) - 1;
    const dy = t.rng.int(3) - 1;
    if (limited && !insideRoamBounds(s, dx, dy, bounds)) continue;
    const dest = origin + dx + WORLD_COLS * dy;
    if (!legalNPCDestination(t, s, dest, PathMode.ENSURE_PATH, false, 0)) continue;
    s.pathStored = true;
    return dest;
  }
  return NOWHERE;
}

function shuffledDirections(t: TacticalState): number[] {
  const dirs = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = t.rng.int(i + 1);
    const tmp = dirs[i] as number;
    dirs[i] = dirs[j] as number;
    dirs[j] = tmp;
  }
  return dirs;
}

export const GoFlag = { CAUTIOUS: 1, STOPSHORT: 2 } as const;
const STOPSHORTDIST = 5;
const MAX_AP_CARRIED = 5;
const AP_START_RUN_COST = 1;
const PATH_CLOSE_GOOD_ENOUGH = 0x04;

const isCreatureOrBloodcat = (s: Soldier) => (s.bodyType >= 4 && s.bodyType <= 10) || s.bodyType === 20;

export function internalGoAsFarAsPossibleTowards(
  t: TacticalState,
  s: Soldier,
  destination: number,
  reserveIn: number,
  action: number,
  flags: number,
  determineMode: (s: Soldier, action: number) => number,
): number {
  const reserve = reserveIn === -1 ? (isCreatureOrBloodcat(s) ? 0 : MAX_AP_CARRIED) : reserveIn;
  const { range, origin } = roamingRange(s);
  const roomRequired = roomLimited(s) && s.absoluteFinalDestination !== NOWHERE ? roomAt(t, s.ai.patrolGrid[0] ?? s.gridNo) : NO_ROOM;
  s.uiMovementMode = determineMode(s, action);
  const running = t.content.animations.stateIndex.get('RUNNING') ?? -1;
  if (s.uiMovementMode === running && flags & GoFlag.CAUTIOUS)
    s.uiMovementMode = t.content.animations.stateIndex.get('WALKING') ?? s.uiMovementMode;
  let dest = destination;
  if (dest === s.gridNo || isWater(t.pathWorld, dest)) return NOWHERE;
  const pathFlags = isCreatureOrBloodcat(s) ? PATH_CLOSE_GOOD_ENOUGH : 0;
  if (!legalNPCDestination(t, s, dest, PathMode.ENSURE_PATH, false, pathFlags)) {
    if (isCreatureOrBloodcat(s)) return NOWHERE;
    let found = false;
    for (const d of shuffledDirections(t)) {
      const candidate = newGridNo(dest, step(d));
      if (candidate === dest) continue;
      if (legalNPCDestination(t, s, candidate, PathMode.ENSURE_PATH, false, 0)) {
        dest = candidate;
        found = true;
        break;
      }
    }
    if (!found) return NOWHERE;
  }
  let go = s.gridNo;
  let apCost = 0;
  let apsLeft = -1;
  const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
  let i = 0;
  for (; i < s.pathSize - s.pathIndex; i++) {
    const next = newGridNo(go, step(s.path[i] ?? 0));
    if (next === go) break;
    if (spacesAway(origin, next) > range) break;
    if (roomRequired !== NO_ROOM && roomRequired !== roomAt(t, next)) break;
    if (flags & GoFlag.STOPSHORT && spacesAway(dest, next) <= STOPSHORTDIST) break;
    if (!legalNPCDestination(t, s, next, PathMode.IGNORE_PATH, true, 0)) break;
    if (t.inCombat) {
      if (i === 0 && s.uiMovementMode === running) apCost += AP_START_RUN_COST;
      apCost += estimateActionPointCost(ctx, s, next, s.path[i] ?? 0, s.uiMovementMode, i, s.pathSize);
      apsLeft = ((s.actionPoints - apCost) << 24) >> 24;
    }
    if (t.inCombat && apsLeft < reserve) break;
    go = next;
    if (t.inCombat && apsLeft === reserve) break;
  }
  if (go === s.gridNo) return NOWHERE;
  if (go === dest) {
    s.pathStored = true;
    s.finalDestination = go;
  } else if (s.pathIndex === 0) {
    s.pathStored = true;
    s.finalDestination = go;
    s.pathSize = i + 1;
  }
  return go;
}

export function goAsFarAsPossibleTowards(
  t: TacticalState,
  s: Soldier,
  destination: number,
  action: number,
  determineMode: (s: Soldier, action: number) => number,
): number {
  return internalGoAsFarAsPossibleTowards(t, s, destination, -1, action, 0, determineMode);
}

export function randomFriendWithin(t: TacticalState, s: Soldier): boolean {
  const { range, origin } = roamingRange(s);
  if (origin >= WORLD_MAX) return false;
  const friends = t.soldiers.filter(
    (c) => c?.placed && c !== s && (c.neutral ? s.neutral : s.side === c.side) && spacesAway(s.gridNo, c.gridNo) > 1,
  );
  while (friends.length > 0) {
    const index = t.pre.int(friends.length);
    const chosen = friends[index] as Soldier;
    if (spacesAway(origin, chosen.gridNo) - 1 <= range) {
      const checked = new Array<boolean>(8).fill(false);
      for (let left = 8; left-- > 0; ) {
        let direction: number;
        do direction = t.rng.int(8);
        while (checked[direction]);
        checked[direction] = true;
        const dest = newGridNo(chosen.gridNo, step(direction + 1));
        if (dest === chosen.gridNo) continue;
        if (spacesAway(origin, dest) <= range && legalNPCDestination(t, s, dest, PathMode.ENSURE_PATH, false, 0)) {
          s.ai.actionData = dest;
          s.pathStored = true;
          return true;
        }
      }
    }
    friends[index] = friends[friends.length - 1] as Soldier;
    friends.pop();
  }
  return false;
}

export function nextPatrolPoint(s: Soldier): number {
  const ai = s.ai;
  if (ai.patrolCount < 1 || ai.patrolCount >= MAX_PATROL_POINTS) return NOWHERE;
  ai.nextPatrolPoint++;
  if (ai.nextPatrolPoint > ai.patrolCount) ai.nextPatrolPoint = 1;
  return ai.patrolGrid[ai.nextPatrolPoint] ?? NOWHERE;
}

export function pointPatrolAI(
  t: TacticalState,
  s: Soldier,
  determineMode: (s: Soldier, action: number) => number,
  action: number,
): boolean {
  const ai = s.ai;
  let point = ai.patrolGrid[ai.nextPatrolPoint] ?? NOWHERE;
  if (s.gridNo === point || ai.nextPatrolPoint === 0) {
    do point = nextPatrolPoint(s);
    while (point !== NOWHERE && !newOKDestination(t.pathEnv, s, point, false, s.level));
    if (point === s.gridNo) point = NOWHERE;
  }
  if (point === NOWHERE) {
    ai.orders = Orders.FARPATROL;
    return false;
  }
  if (legalNPCDestination(t, s, point, PathMode.ENSURE_PATH, false, 0)) {
    ai.actionData = point;
    return true;
  }
  const savedOrders = ai.orders;
  ai.orders = Orders.ONCALL;
  ai.actionData = goAsFarAsPossibleTowards(t, s, point, action, determineMode);
  ai.orders = savedOrders;
  return ai.actionData !== NOWHERE;
}

export function randomPointPatrolAI(
  t: TacticalState,
  s: Soldier,
  determineMode: (s: Soldier, action: number) => number,
  action: number,
): boolean {
  const ai = s.ai;
  let point = ai.patrolGrid[ai.nextPatrolPoint] ?? NOWHERE;
  if (s.gridNo === point || ai.nextPatrolPoint === 0) {
    let count = 0;
    do {
      ai.nextPatrolPoint = t.pre.int(ai.patrolCount) + 1;
      point = ai.patrolGrid[ai.nextPatrolPoint] ?? NOWHERE;
      count++;
    } while (point === s.gridNo || (point !== NOWHERE && count < ai.patrolCount && !newOKDestination(t.pathEnv, s, point, false, s.level)));
    if (count === ai.patrolCount) {
      ai.nextPatrolPoint = 0;
      do point = nextPatrolPoint(s);
      while (point !== NOWHERE && !newOKDestination(t.pathEnv, s, point, false, s.level));
    }
    if (point === s.gridNo) return false;
  }
  if (point === NOWHERE) return false;
  if (legalNPCDestination(t, s, point, PathMode.ENSURE_PATH, false, 0)) {
    ai.actionData = point;
    return true;
  }
  const savedOrders = ai.orders;
  ai.orders = Orders.SEEKENEMY;
  ai.actionData = goAsFarAsPossibleTowards(t, s, point, action, determineMode);
  ai.orders = savedOrders;
  return ai.actionData !== NOWHERE;
}
