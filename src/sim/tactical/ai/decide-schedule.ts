// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/DecideAction.cc DoneScheduleAction, DecideActionSchedule; TacticalAI/FindLocations.cc
// @src FindNearbyPointOnEdgeOfMap.

import { pythSpacesAway, WORLD_COLS, WORLD_MAX } from '../../../content/world/grid.ts';
import { has, StructureFlags } from '../../../content/world/structures.ts';
import { i16 } from '../../../core/int.ts';
import { findDoorInfo, updateDoor } from '../doors/door-table.ts';
import { getSchedule, ScheduleAction, type ScheduleNode, UNSET_SCHEDULE_VALUE } from '../narrative/schedule-state.ts';
import {
  activeScheduleIndex,
  findDoorAtGridNoOrAdjacent,
  findNearestEdgePoint,
  gridNoOnEdgeOfMap,
  postNextSchedule,
  profileRecruitedFlagTestedAsDontAdd,
  returnFromAwaySlot,
  setSoldierPositionCentred,
} from '../narrative/schedules.ts';
import { findBestPath, NOWHERE, PathCopy } from '../pathfinding.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { AiAction } from './actions.ts';
import { traversalQuoteActionID } from './cover.ts';

const EDGE_OF_MAP_SEARCH = 5;
const NO_DIRECTION = -1;

function doneScheduleAction(t: TacticalState, s: Soldier): void {
  s.ai.checkSchedule = false;
  s.ai.scheduleProgress = 0;
  postNextSchedule(t, s);
}

function scheduleMove(s: Soldier, g: number): number {
  s.ai.actionData = g;
  s.absoluteFinalDestination = g;
  return AiAction.SCHEDULE_MOVE;
}

function finishAtCurrentSpot(t: TacticalState, s: Soldier): void {
  doneScheduleAction(t, s);
  if (s.gridNo !== NOWHERE) s.ai.patrolGrid[0] = s.gridNo;
}

function moveToFinalSpot(t: TacticalState, s: Soldier, data2: number): number {
  if (s.gridNo === data2 || s.gridNo === NOWHERE) {
    finishAtCurrentSpot(t, s);
    return AiAction.NONE;
  }
  const edge = gridNoOnEdgeOfMap(t, data2);
  if (edge !== null) s.quoteActionId = traversalQuoteActionID(edge);
  return scheduleMove(s, data2);
}

function lockDecision(t: TacticalState, s: Soldier, doorGridNo: number): boolean {
  const structure = t.world.structures.find(doorGridNo, StructureFlags.ANYDOOR);
  if (!structure) return false;
  if (has(structure.flags, StructureFlags.OPEN)) {
    s.ai.lockDoorIncludesClose = true;
    return true;
  }
  const door = findDoorInfo(t, doorGridNo);
  if (!door || door.locked) return false;
  updateDoor(t, doorGridNo, { locked: true });
  return true;
}

function otherDoorDecision(t: TacticalState, action: number, doorGridNo: number): boolean {
  const structure = t.world.structures.find(doorGridNo, StructureFlags.ANYDOOR);
  if (!structure) return false;
  const open = has(structure.flags, StructureFlags.OPEN);
  switch (action) {
    case ScheduleAction.UNLOCKDOOR: {
      if (open) return false;
      const door = findDoorInfo(t, doorGridNo);
      if (!door?.locked) return false;
      updateDoor(t, doorGridNo, { locked: false });
      return true;
    }
    case ScheduleAction.OPENDOOR:
      return !open;
    case ScheduleAction.CLOSEDOOR:
      return open;
    default:
      return true;
  }
}

function doorActionFor(action: number): number {
  if (action === ScheduleAction.LOCKDOOR) return AiAction.LOCK_DOOR;
  if (action === ScheduleAction.UNLOCKDOOR) return AiAction.UNLOCK_DOOR;
  return AiAction.OPEN_OR_CLOSE_DOOR;
}

function decideDoorSchedule(t: TacticalState, s: Soldier, action: number, data1: number, data2: number): number {
  const ai = s.ai;
  if (ai.scheduleProgress === 0) {
    if (s.gridNo !== data1) return scheduleMove(s, data1);
    ai.scheduleProgress++;
  }
  if (ai.scheduleProgress === 1) {
    const doorGridNo = findDoorAtGridNoOrAdjacent(t, data1);
    if (doorGridNo === NOWHERE) return AiAction.NONE;
    const useDoor = action === ScheduleAction.LOCKDOOR ? lockDecision(t, s, doorGridNo) : otherDoorDecision(t, action, doorGridNo);
    if (useDoor) {
      ai.actionData = doorGridNo;
      return doorActionFor(action);
    }
    ai.scheduleProgress++;
  }
  if (ai.scheduleProgress === 2) return moveToFinalSpot(t, s, data2);
  return AiAction.NONE;
}

export function findNearbyPointOnEdgeOfMap(t: TacticalState, s: Soldier): { readonly gridNo: number; readonly direction: number } {
  const col = s.gridNo % WORLD_COLS;
  const row = Math.trunc(s.gridNo / WORLD_COLS);
  const maxLeft = Math.min(EDGE_OF_MAP_SEARCH, col);
  const maxRight = Math.min(EDGE_OF_MAP_SEARCH, WORLD_COLS - (col + 1));
  const maxUp = Math.min(EDGE_OF_MAP_SEARCH, row);
  const maxDown = Math.min(EDGE_OF_MAP_SEARCH, WORLD_COLS - (row + 1));
  const flood = findBestPath(t.pathEnv, s, NOWHERE, s.level, { copy: PathCopy.REACHABLE, distLimit: EDGE_OF_MAP_SEARCH });
  let closest = NOWHERE;
  let closestCost = 1000;
  let closestDirection = NO_DIRECTION;
  for (let dy = -maxUp; dy <= maxDown; dy++) {
    for (let dx = -maxLeft; dx <= maxRight; dx++) {
      const g = s.gridNo + dx + WORLD_COLS * dy;
      if (g < 0 || g >= WORLD_MAX || g === s.gridNo || !flood.reachable?.[g]) continue;
      const direction = gridNoOnEdgeOfMap(t, g);
      if (direction === null) continue;
      const cost = pythSpacesAway(s.gridNo, g);
      if (cost < closestCost) {
        closest = g;
        closestCost = cost;
        closestDirection = direction;
      }
    }
  }
  return { gridNo: closest, direction: closestDirection };
}

function decideLeaveSector(t: TacticalState, s: Soldier): number {
  const ai = s.ai;
  if (ai.scheduleProgress === 0) {
    ai.actionData = findNearestEdgePoint(t, s.gridNo);
    if (ai.actionData === NOWHERE) {
      doneScheduleAction(t, s);
      return AiAction.NONE;
    }
    if (s.gridNo !== ai.actionData) {
      s.absoluteFinalDestination = ai.actionData;
      return AiAction.SCHEDULE_MOVE;
    }
    ai.scheduleProgress++;
  }
  if (ai.scheduleProgress === 1) {
    const edge = findNearbyPointOnEdgeOfMap(t, s);
    ai.actionData = edge.gridNo;
    if (edge.gridNo === NOWHERE) {
      doneScheduleAction(t, s);
      return AiAction.NONE;
    }
    s.quoteActionId = traversalQuoteActionID(edge.direction);
    ai.scheduleProgress++;
    s.absoluteFinalDestination = edge.gridNo;
    return AiAction.SCHEDULE_MOVE;
  }
  if (ai.scheduleProgress === 2) doneScheduleAction(t, s);
  return AiAction.NONE;
}

function decideEnterSector(t: TacticalState, s: Soldier, data1: number): number {
  if (profileRecruitedFlagTestedAsDontAdd(t, s)) {
    doneScheduleAction(t, s);
    return AiAction.NONE;
  }
  const ai = s.ai;
  if (ai.scheduleProgress === 0) {
    setSoldierPositionCentred(t, s, s.offWorldGridNo);
    returnFromAwaySlot(t, s);
    ai.scheduleProgress++;
    return scheduleMove(s, data1);
  }
  if (ai.scheduleProgress === 1) {
    if (s.gridNo !== data1) return scheduleMove(s, data1);
    finishAtCurrentSpot(t, s);
  }
  return AiAction.NONE;
}

function decideActionFor(t: TacticalState, s: Soldier, node: ScheduleNode, index: number): number {
  const action = node.actions[index] ?? ScheduleAction.NONE;
  const data1 = i16(node.data1[index] ?? UNSET_SCHEDULE_VALUE);
  const data2 = i16(node.data2[index] ?? UNSET_SCHEDULE_VALUE);
  switch (action) {
    case ScheduleAction.LOCKDOOR:
    case ScheduleAction.UNLOCKDOOR:
    case ScheduleAction.OPENDOOR:
    case ScheduleAction.CLOSEDOOR:
      return decideDoorSchedule(t, s, action, data1, data2);
    case ScheduleAction.GRIDNO:
      if (s.gridNo !== data1) return scheduleMove(s, data1);
      finishAtCurrentSpot(t, s);
      return AiAction.NONE;
    case ScheduleAction.LEAVESECTOR:
      return decideLeaveSector(t, s);
    case ScheduleAction.ENTERSECTOR:
      return decideEnterSector(t, s, data1);
    case ScheduleAction.WAKE:
      if (s.gridNo !== s.initialGridNo) return scheduleMove(s, s.initialGridNo);
      doneScheduleAction(t, s);
      s.ai.patrolGrid[0] = s.gridNo;
      return AiAction.NONE;
    case ScheduleAction.SLEEP:
      if (s.gridNo !== data1) return scheduleMove(s, data1);
      s.ai.asleep = true;
      finishAtCurrentSpot(t, s);
      return AiAction.NONE;
    default:
      return AiAction.NONE;
  }
}

export function decideActionSchedule(t: TacticalState, s: Soldier): number {
  const node = getSchedule(t.schedules, s.scheduleId);
  if (!node) return AiAction.NONE;
  const index = activeScheduleIndex(node);
  if (index < 0) return AiAction.NONE;
  s.ai.asleep = false;
  return decideActionFor(t, s, node, index);
}
