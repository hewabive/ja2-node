// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Scheduling.cc DestroyAllSchedules, DeleteSchedule, ProcessTacticalSchedule, OptimizeSchedules,
// @src BumpAnyExistingMerc, AutoProcessSchedule, PostSchedule, PrepareScheduleForAutoProcessing, PostDefaultSchedule,
// @src PostSchedules, PerformActionOnDoorAdjacentToGridNo, PostNextSchedule, ExtractScheduleDoorLockAndUnlockInfo,
// @src ScheduleHasMorningNonSleepEntries, GetEmptyScheduleEntry, FindSleepSpot, ReplaceSleepSpot, SecureSleepSpot;
// @src Tactical/Structure_Wrap.cc FindDoorAtGridNoOrAdjacent; Tactical/Keys.cc ModifyDoorStatus (with the structure sync of
// @src UpdateDoorGraphicsFromStatus); Tactical/Soldier_Control.cc EVENT_SetSoldierPositionNoCenter;
// @src TacticalAI/FindLocations.cc FindNearestEdgePoint; TileEngine/Isometric_Utils.cc GridNoOnEdgeOfMap.

import { DIRECTION_COUNT, DIRECTION_INCREMENT, Direction, WORLD_COLS, WORLD_MAX } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { absoluteScreenXY, renderedScreenSize, restrictedScrollIdOf } from '../../../content/world/render-bounds.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { i16, idiv, u16, u32 } from '../../../core/int.ts';
import { civGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { awaySoldierAt, moveSoldierFromAwayToMercSlot, moveSoldierFromMercToAwaySlot } from '../away-slots.ts';
import { findDoorInfo, updateDoor } from '../doors/door-table.ts';
import { isDoorOpenAt, toggleDoorAt } from '../doors.ts';
import { EdgeSide, findNearestEdgepointOnSpecifiedEdge } from '../edgepoints.ts';
import { setSoldierPosition, setSoldierPositionXY } from '../movement.ts';
import { NOWHERE } from '../pathfinding.ts';
import { profileProgress } from '../profiles.ts';
import { Body, CivilianGroup, cellCentre, NO_PROFILE, OKLIFE, type Soldier, TEAM_FIRST_ID, TEAM_SIZES, Team } from '../soldier.ts';
import { onVisibleWorldTile, type TacticalState, whoIsThere } from '../state.ts';
import { findGridNoFromSweetSpotExcludingSweetSpot, findGridNoFromSweetSpotNearSoldier } from '../sweet-spots.ts';
import {
  getSchedule,
  MAX_SCHEDULE_ACTIONS,
  NO_SCHEDULE_SOLDIER,
  ScheduleAction,
  ScheduleFlags,
  type ScheduleNode,
  UNSET_SCHEDULE_VALUE,
} from './schedule-state.ts';

const MINUTES_PER_DAY = 1440;
const CELL_SIZE = 10;
const NOON = 12 * 60;
const SLEEP_TIME_BASE = 21 * 60;
const SLEEP_TIME_RANGE = 3 * 60;
const SLEEP_LENGTH = 8 * 60;
const DEFAULT_ENTER_BASE = 420;
const DEFAULT_ENTER_RANGE = 61;
const DEFAULT_LEAVE_BASE = 1080;
const DEFAULT_LEAVE_RANGE = 121;
const BUMP_RADIUS = 5;
const SLEEP_SPOT_RADIUS = 3;
const MAX_SCHEDULE_ID = 255;
const NO_ENTRY = -1;
const PERMANENT_INSERTION_CODE = 0x02;
const DONT_ADD_TO_SECTOR = 0x01;
const QUEST_KINGPIN_MONEY = 4;
const QUEST_IN_PROGRESS = 1;
const FACT_KINGPIN_CAN_SEND_ASSASSINS = 276;
const PROFILE_KINGPIN = 86;
const KINGPIN_SECTOR = { x: 5, y: 3, z: 0 } as const;
const NO_DEFAULT_SCHEDULE_BODIES: ReadonlySet<number> = new Set([
  Body.COW,
  Body.BLOODCAT,
  Body.HUMVEE,
  Body.ELDORADO,
  Body.ICECREAMTRUCK,
  Body.JEEP,
]);
const ENTRY_POINT_ABSENT = -1;
const RELINK_OFFSET = 100;

export interface PostOptions {
  readonly loadingSave: boolean;
}

const minuteOfDay = (t: TacticalState) => t.scheduleClock.worldMinutes() % MINUTES_PER_DAY;
const dayStartMinute = (t: TacticalState) => idiv(t.scheduleClock.worldMinutes(), MINUTES_PER_DAY) * MINUTES_PER_DAY;
const asGridNo = (value: number) => i16(value);
const soldierOf = (t: TacticalState, node: ScheduleNode): Soldier | null =>
  node.soldier === NO_SCHEDULE_SOLDIER ? null : (t.soldiers[node.soldier] ?? null);

function inSector(s: Soldier): boolean {
  return s.placed || s.offMap;
}

function activeSoldier(s: Soldier | null | undefined): s is Soldier {
  return s !== null && s !== undefined && (s.placed || s.offMap || s.away);
}

export function destroyAllSchedules(t: TacticalState): void {
  t.scheduleClock.deleteAllEvents();
  t.schedules.nodes = [];
  t.schedules.lastId = 0;
}

function addEvent(t: TacticalState, minute: number, node: ScheduleNode): void {
  t.scheduleClock.addEvent(minute, node.id);
}

export function processTacticalSchedule(t: TacticalState, id: number, inTactical: boolean): void {
  const node = getSchedule(t.schedules, id);
  if (!node) return;
  const s = soldierOf(t, node);
  if (!s || s.life < OKLIFE) return;
  const now = minuteOfDay(t);
  const index = inTactical ? node.times.indexOf(now) : NO_ENTRY;
  if (index === NO_ENTRY) {
    const start = t.scheduleClock.lastEventQueryMinutes() % MINUTES_PER_DAY;
    if (start !== now) prepareScheduleForAutoProcessing(t, node, start, now, true);
    return;
  }
  node.flags = (node.flags & ~ScheduleFlags.ACTIVE_ALL) | (ScheduleFlags.ACTIVE1 << index);
  s.ai.checkSchedule = true;
  s.ai.scheduleProgress = 0;
}

export function optimizeSchedules(t: TacticalState): void {
  const list = t.schedules;
  list.lastId = 0;
  for (const node of list.nodes) {
    list.lastId++;
    const old = node.id;
    if (old === list.lastId) continue;
    node.id = list.lastId;
    const linked = t.initList.find((n) => n.detail?.scheduleId === old);
    if (!linked?.detail) continue;
    linked.detail = { ...linked.detail, scheduleId: list.lastId + RELINK_OFFSET };
    const s = linked.hasSoldier ? t.soldiers[linked.soldierId] : undefined;
    if (s) s.scheduleId = list.lastId;
  }
  for (const n of t.initList)
    if (n.detail && n.detail.scheduleId > RELINK_OFFSET) n.detail = { ...n.detail, scheduleId: n.detail.scheduleId - RELINK_OFFSET };
}

function parkAway(s: Soldier, g: number, x: number, y: number): void {
  s.destination = g;
  s.finalDestination = g;
  s.x = x;
  s.y = y;
  s.oldGridNo = s.gridNo;
  s.gridNo = g;
}

export function setSoldierPositionNoCenter(t: TacticalState, s: Soldier, g: number): void {
  const x = (g % WORLD_COLS) * CELL_SIZE;
  const y = idiv(g, WORLD_COLS) * CELL_SIZE;
  if (s.away) parkAway(s, g, x, y);
  else setSoldierPositionXY(t, s, x, y);
}

export function setSoldierPositionCentred(t: TacticalState, s: Soldier, g: number): void {
  if (!s.away) {
    setSoldierPosition(t, s, g);
    return;
  }
  const centre = cellCentre(g);
  parkAway(s, g, Math.fround(centre.x), Math.fround(centre.y));
}

export function returnFromAwaySlot(t: TacticalState, s: Soldier): void {
  if (!moveSoldierFromAwayToMercSlot(t, s)) return;
  setSoldierPositionXY(t, s, s.x, s.y, { keepDestination: true, keepFinalDestination: true });
}

export function bumpAnyExistingMerc(t: TacticalState, g: number): boolean {
  if (!onVisibleWorldTile(t, g)) return true;
  const there = whoIsThere(t, g, 0) ?? awaySoldierAt(t, g, 0);
  if (!there) return true;
  const spot = findGridNoFromSweetSpotNearSoldier(t, there, BUMP_RADIUS);
  if (spot === NOWHERE) return false;
  setSoldierPositionNoCenter(t, there, spot);
  return true;
}

export function gridNoOnEdgeOfMap(t: TacticalState, g: number): number | null {
  for (let direction = Direction.NORTHEAST; direction < DIRECTION_COUNT; direction += 2) {
    const next = g + (DIRECTION_INCREMENT[direction] ?? 0);
    if (next < 0 || next >= WORLD_MAX) continue;
    if (t.world.costs.get(next, direction, 0) === TravelCost.OFF_MAP) return direction;
  }
  return null;
}

export function findNearestEdgePoint(t: TacticalState, g: number): number {
  const edgepoints = t.edgepoints;
  if (!edgepoints) return NOWHERE;
  const restriction = restrictedScrollIdOf(t.world);
  const { x, y } = absoluteScreenXY(restriction, g);
  const size = renderedScreenSize(restriction);
  const ranked = [
    { distance: i16(x), side: EdgeSide.WEST },
    { distance: i16(size.width - x), side: EdgeSide.EAST },
    { distance: i16(y), side: EdgeSide.NORTH },
    { distance: i16(size.height - y), side: EdgeSide.SOUTH },
  ].sort((a, b) => a.distance - b.distance);
  for (const { side } of ranked) {
    const found = findNearestEdgepointOnSpecifiedEdge(edgepoints, g, side);
    if (found !== NOWHERE) return found;
  }
  return NOWHERE;
}

export function findDoorAtGridNoOrAdjacent(t: TacticalState, g: number): number {
  for (const candidate of [g, g + (DIRECTION_INCREMENT[Direction.NORTH] ?? 0), g + (DIRECTION_INCREMENT[Direction.WEST] ?? 0)]) {
    const door = t.world.structures.find(candidate, StructureFlags.ANYDOOR);
    if (door) return t.world.structures.findBase(door)?.gridNo ?? candidate;
  }
  return NOWHERE;
}

function setDoorOpen(t: TacticalState, doorGridNo: number, open: boolean): void {
  if (!t.world.structures.find(doorGridNo, StructureFlags.ANYDOOR)) return;
  if (isDoorOpenAt(t, doorGridNo) !== open) toggleDoorAt(t, doorGridNo);
}

export function performActionOnDoorAdjacentToGridNo(t: TacticalState, action: number, g: number): void {
  const doorGridNo = findDoorAtGridNoOrAdjacent(t, g);
  if (doorGridNo === NOWHERE) return;
  switch (action) {
    case ScheduleAction.LOCKDOOR:
      if (findDoorInfo(t, doorGridNo)) updateDoor(t, doorGridNo, { locked: true });
      setDoorOpen(t, doorGridNo, false);
      break;
    case ScheduleAction.UNLOCKDOOR:
      if (findDoorInfo(t, doorGridNo)) updateDoor(t, doorGridNo, { locked: false });
      break;
    case ScheduleAction.OPENDOOR:
      setDoorOpen(t, doorGridNo, true);
      break;
    case ScheduleAction.CLOSEDOOR:
      setDoorOpen(t, doorGridNo, false);
      break;
  }
}

function dontAddToSector(t: TacticalState, profile: number, flagsOf: 'miscFlags' | 'miscFlags2'): boolean {
  if (profile === NO_PROFILE) return false;
  const p = profileProgress(t, profile);
  return p !== null && (p[flagsOf] & DONT_ADD_TO_SECTOR) !== 0;
}

export function profileDontAddToSector(t: TacticalState, s: Soldier): boolean {
  return dontAddToSector(t, s.profile, 'miscFlags2');
}

export function profileRecruitedFlagTestedAsDontAdd(t: TacticalState, s: Soldier): boolean {
  return dontAddToSector(t, s.profile, 'miscFlags');
}

function goOffMap(t: TacticalState, s: Soldier, g: number): void {
  s.offWorldGridNo = g;
  moveSoldierFromMercToAwaySlot(t, s);
}

function teleportTo(t: TacticalState, s: Soldier, g: number): void {
  bumpAnyExistingMerc(t, g);
  setSoldierPositionNoCenter(t, s, g);
}

function autoProcessSchedule(t: TacticalState, node: ScheduleNode, index: number): void {
  const s = soldierOf(t, node);
  if (!s) return;
  s.ai.asleep = false;
  const data1 = asGridNo(node.data1[index] ?? UNSET_SCHEDULE_VALUE);
  const data2 = asGridNo(node.data2[index] ?? UNSET_SCHEDULE_VALUE);
  switch (node.actions[index]) {
    case ScheduleAction.LOCKDOOR:
    case ScheduleAction.UNLOCKDOOR:
    case ScheduleAction.OPENDOOR:
    case ScheduleAction.CLOSEDOOR:
      performActionOnDoorAdjacentToGridNo(t, node.actions[index] ?? ScheduleAction.NONE, data1);
      teleportTo(t, s, data2);
      if (gridNoOnEdgeOfMap(t, data2) !== null) goOffMap(t, s, data2);
      else s.ai.patrolGrid[0] = data2;
      break;
    case ScheduleAction.GRIDNO:
      teleportTo(t, s, data1);
      s.ai.patrolGrid[0] = data1;
      break;
    case ScheduleAction.ENTERSECTOR:
      if (profileDontAddToSector(t, s)) break;
      teleportTo(t, s, data1);
      returnFromAwaySlot(t, s);
      s.ai.patrolGrid[0] = data1;
      break;
    case ScheduleAction.WAKE:
      teleportTo(t, s, s.initialGridNo);
      s.ai.patrolGrid[0] = s.initialGridNo;
      break;
    case ScheduleAction.SLEEP:
      s.ai.asleep = true;
      teleportTo(t, s, data1);
      s.ai.patrolGrid[0] = data1;
      break;
    case ScheduleAction.LEAVESECTOR: {
      let g = findNearestEdgePoint(t, s.gridNo);
      if (g !== NOWHERE) teleportTo(t, s, g);
      else g = s.gridNo;
      goOffMap(t, s, g);
      break;
    }
  }
}

function prepareScheduleForAutoProcessing(t: TacticalState, node: ScheduleNode, start: number, end: number, apply: boolean): void {
  const process = (index: number) => {
    if (apply) autoProcessSchedule(t, node, index);
  };
  const day = dayStartMinute(t);
  let posted = false;
  if (start > end) {
    for (let i = 0; i < MAX_SCHEDULE_ACTIONS; i++) {
      const time = node.times[i] ?? UNSET_SCHEDULE_VALUE;
      if (time === UNSET_SCHEDULE_VALUE) break;
      if (time >= start) process(i);
    }
    for (let i = 0; i < MAX_SCHEDULE_ACTIONS; i++) {
      const time = node.times[i] ?? UNSET_SCHEDULE_VALUE;
      if (time === UNSET_SCHEDULE_VALUE) break;
      if (time <= end) process(i);
      else {
        addEvent(t, day + time, node);
        posted = true;
        break;
      }
    }
  } else {
    for (let i = 0; i < MAX_SCHEDULE_ACTIONS; i++) {
      const time = node.times[i] ?? UNSET_SCHEDULE_VALUE;
      if (time === UNSET_SCHEDULE_VALUE) break;
      if (time >= start && time <= end) process(i);
      else if (time >= end) {
        posted = true;
        addEvent(t, day + time, node);
        break;
      }
    }
  }
  const first = node.times[0] ?? UNSET_SCHEDULE_VALUE;
  if (!posted && first !== UNSET_SCHEDULE_VALUE) addEvent(t, day + MINUTES_PER_DAY + first, node);
}

function kingpinGuardsTonys(t: TacticalState, s: Soldier): boolean {
  if (s.civilianGroup !== CivilianGroup.KINGPIN) return false;
  const alerted =
    civGroupHostility(t.civGroups, CivilianGroup.KINGPIN) !== 0 ||
    (t.narrative.questStatus(QUEST_KINGPIN_MONEY) === QUEST_IN_PROGRESS &&
      t.narrative.fact(FACT_KINGPIN_CAN_SEND_ASSASSINS, PROFILE_KINGPIN));
  if (!alerted) return false;
  const sector = t.sector;
  return (
    sector !== null &&
    sector.x === KINGPIN_SECTOR.x &&
    sector.y === KINGPIN_SECTOR.y &&
    sector.z === KINGPIN_SECTOR.z &&
    s.profile === NO_PROFILE
  );
}

function hasPermanentInsertionCode(t: TacticalState, s: Soldier): boolean {
  if (s.profile === NO_PROFILE) return false;
  const p = profileProgress(t, s.profile);
  return p !== null && (p.miscFlags3 & PERMANENT_INSERTION_CODE) !== 0;
}

function scheduleHasMorningNonSleepEntries(node: ScheduleNode): boolean {
  return node.actions.some(
    (action, i) => action !== ScheduleAction.NONE && action !== ScheduleAction.SLEEP && (node.times[i] ?? UNSET_SCHEDULE_VALUE) < NOON,
  );
}

function findSleepSpot(node: ScheduleNode): number {
  const at = node.actions.indexOf(ScheduleAction.SLEEP);
  return at < 0 ? UNSET_SCHEDULE_VALUE : (node.data1[at] ?? UNSET_SCHEDULE_VALUE);
}

function replaceSleepSpot(node: ScheduleNode, spot: number): void {
  const at = node.actions.indexOf(ScheduleAction.SLEEP);
  if (at >= 0) node.data1[at] = u16(spot);
}

const LAST_CIV_ID = (TEAM_FIRST_ID[Team.CIV] ?? 0) + (TEAM_SIZES[Team.CIV] ?? 0) - 1;

function secureSleepSpot(t: TacticalState, s: Soldier, spot: number): void {
  for (let id = s.id + 1; id <= LAST_CIV_ID; id++) {
    const other = t.soldiers[id];
    if (!activeSoldier(other) || !inSector(other) || other.scheduleId === 0) continue;
    const node = getSchedule(t.schedules, other.scheduleId);
    if (!node) continue;
    const otherSpot = findSleepSpot(node);
    if (otherSpot !== spot) continue;
    const replacement = findGridNoFromSweetSpotExcludingSweetSpot(t, other, asGridNo(otherSpot), SLEEP_SPOT_RADIUS);
    if (replacement === NOWHERE) continue;
    replaceSleepSpot(node, replacement);
  }
}

function swapEntries(node: ScheduleNode, a: number, b: number): void {
  for (const field of [node.actions, node.times, node.data1, node.data2]) {
    const keep = field[a] ?? 0;
    field[a] = field[b] ?? 0;
    field[b] = keep;
  }
}

function assignSleepTime(t: TacticalState, node: ScheduleNode, sleep: number): void {
  node.times[sleep] = SLEEP_TIME_BASE + t.rng.int(SLEEP_TIME_RANGE);
  if (scheduleHasMorningNonSleepEntries(node)) return;
  const empty = node.actions.indexOf(ScheduleAction.NONE);
  if (empty < 0) return;
  node.actions[empty] = ScheduleAction.WAKE;
  node.times[empty] = ((node.times[sleep] ?? 0) + SLEEP_LENGTH) % MINUTES_PER_DAY;
  swapEntries(node, empty, sleep);
}

export function postSchedule(t: TacticalState, s: Soldier, options: PostOptions): void {
  if (kingpinGuardsTonys(t, s)) return;
  const node = getSchedule(t.schedules, s.scheduleId);
  if (!node) return;
  if (hasPermanentInsertionCode(t, s)) return;
  for (let i = 0; i < MAX_SCHEDULE_ACTIONS; i++) {
    if (node.actions[i] !== ScheduleAction.SLEEP) continue;
    secureSleepSpot(t, s, node.data1[i] ?? UNSET_SCHEDULE_VALUE);
    if (node.times[i] === UNSET_SCHEDULE_VALUE) {
      assignSleepTime(t, node, i);
      break;
    }
  }
  node.soldier = s.id;
  const now = t.scheduleClock.worldMinutes();
  const end = u32(now) % MINUTES_PER_DAY;
  const start = u32(now - (MINUTES_PER_DAY - 1)) % MINUTES_PER_DAY;
  prepareScheduleForAutoProcessing(t, node, start, end, !options.loadingSave);
}

function postDefaultSchedule(t: TacticalState, s: Soldier, options: PostOptions): void {
  if (t.sector && t.sector.z !== 0) return;
  const list = t.schedules;
  list.lastId++;
  const unset = () => Array.from({ length: MAX_SCHEDULE_ACTIONS }, () => UNSET_SCHEDULE_VALUE);
  const node: ScheduleNode = {
    id: list.lastId,
    times: unset(),
    data1: unset(),
    data2: unset(),
    actions: Array.from({ length: MAX_SCHEDULE_ACTIONS }, () => ScheduleAction.NONE),
    flags: ScheduleFlags.TEMPORARY,
    soldier: s.id,
  };
  list.nodes.unshift(node);
  s.scheduleId = node.id;
  node.actions[0] = ScheduleAction.ENTERSECTOR;
  node.times[0] = DEFAULT_ENTER_BASE + t.rng.int(DEFAULT_ENTER_RANGE);
  node.data1[0] = u16(s.initialGridNo);
  node.actions[1] = ScheduleAction.LEAVESECTOR;
  node.times[1] = DEFAULT_LEAVE_BASE + t.rng.int(DEFAULT_LEAVE_RANGE);
  if (list.lastId === MAX_SCHEDULE_ID) optimizeSchedules(t);
  postSchedule(t, s, options);
}

function defaultSchedulesPossible(t: TacticalState): boolean {
  const info = t.world.map?.info;
  if (!info) return false;
  return [info.northGridNo, info.eastGridNo, info.southGridNo, info.westGridNo].some((g) => g !== ENTRY_POINT_ABSENT);
}

export function postSchedules(t: TacticalState, options: PostOptions): void {
  const defaults = defaultSchedulesPossible(t);
  for (const node of t.initList) {
    if (!node.hasSoldier) continue;
    const s = t.soldiers[node.soldierId];
    if (!activeSoldier(s) || s.team !== Team.CIV) continue;
    if (node.detail && node.detail.scheduleId !== 0) postSchedule(t, s, options);
    else if (defaults && !NO_DEFAULT_SCHEDULE_BODIES.has(s.bodyType)) postDefaultSchedule(t, s, options);
  }
}

export function postNextSchedule(t: TacticalState, s: Soldier): void {
  const node = getSchedule(t.schedules, s.scheduleId);
  if (!node) return;
  const now = minuteOfDay(t);
  let best = NO_ENTRY;
  let bestTime = UNSET_SCHEDULE_VALUE;
  node.times.forEach((time, i) => {
    if (time === UNSET_SCHEDULE_VALUE || time === now) return;
    const wait = time > now ? time - now : MINUTES_PER_DAY - (now - time);
    if (wait < bestTime) {
      bestTime = wait;
      best = i;
    }
  });
  if (best === NO_ENTRY) return;
  addEvent(t, dayStartMinute(t) + (node.times[best] ?? 0), node);
}

export interface ScheduleShopHours {
  readonly open: number;
  readonly close: number;
}

export function extractScheduleDoorLockAndUnlockInfo(t: TacticalState, s: Soldier): ScheduleShopHours | null {
  const node = getSchedule(t.schedules, s.scheduleId);
  if (!node) return null;
  let open: number | null = null;
  let close: number | null = null;
  node.actions.forEach((action, i) => {
    if (action === ScheduleAction.UNLOCKDOOR) open = node.times[i] ?? 0;
    else if (action === ScheduleAction.LOCKDOOR) close = node.times[i] ?? 0;
  });
  return open !== null && close !== null ? { open, close } : null;
}

export function activeScheduleIndex(node: ScheduleNode): number {
  for (let i = 0; i < MAX_SCHEDULE_ACTIONS; i++) if (node.flags & (ScheduleFlags.ACTIVE1 << i)) return i;
  return NO_ENTRY;
}
