// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Scheduling.h SCHEDULENODE, the SCHEDULE_ACTION_* enum and SCHEDULE_FLAGS_*; Scheduling.cc
// @src gpScheduleList, gubScheduleID, LoadSchedules, LoadSchedulesFromSave, GetSchedule. See docs/25 §5.1, §5.6.

import type { MapSchedule } from '../../../content/formats/map.ts';

export const ScheduleAction = {
  NONE: 0,
  LOCKDOOR: 1,
  UNLOCKDOOR: 2,
  OPENDOOR: 3,
  CLOSEDOOR: 4,
  GRIDNO: 5,
  LEAVESECTOR: 6,
  ENTERSECTOR: 7,
  STAYINSECTOR: 8,
  SLEEP: 9,
  WAKE: 10,
} as const;

export const ScheduleFlags = { ACTIVE1: 0x0010, ACTIVE_ALL: 0x00f0, TEMPORARY: 0x0100 } as const;

export const MAX_SCHEDULE_ACTIONS = 4;
export const UNSET_SCHEDULE_VALUE = 0xffff;
export const NO_SCHEDULE_SOLDIER = -1;
const FIRST_LOADED_ID = 1;

export interface ScheduleNode {
  id: number;
  readonly times: number[];
  readonly data1: number[];
  readonly data2: number[];
  readonly actions: number[];
  flags: number;
  soldier: number;
}

export interface ScheduleList {
  nodes: ScheduleNode[];
  lastId: number;
}

export interface ScheduleClock {
  worldMinutes(): number;
  lastEventQueryMinutes(): number;
  addEvent(minute: number, id: number): void;
  deleteEvent(id: number): void;
  deleteAllEvents(): void;
}

export const NO_SCHEDULE_CLOCK: ScheduleClock = {
  worldMinutes: () => 0,
  lastEventQueryMinutes: () => 0,
  addEvent: () => {},
  deleteEvent: () => {},
  deleteAllEvents: () => {},
};

export function createScheduleList(): ScheduleList {
  return { nodes: [], lastId: 0 };
}

export function scheduleNodeFrom(s: MapSchedule, id: number, soldier = NO_SCHEDULE_SOLDIER): ScheduleNode {
  return {
    id,
    times: [...s.times],
    data1: [...s.data1],
    data2: [...s.data2],
    actions: [...s.actions],
    flags: s.flags,
    soldier,
  };
}

export function loadMapSchedules(schedules: readonly MapSchedule[]): ScheduleList {
  let next = FIRST_LOADED_ID;
  const nodes = schedules.map((s) => scheduleNodeFrom(s, next++));
  return { nodes, lastId: next };
}

export interface SavedScheduleNode extends MapSchedule {
  readonly id: number;
  readonly soldier: number;
}

export function loadSavedSchedules(saved: readonly SavedScheduleNode[], soldierExists: (id: number) => boolean): ScheduleList {
  const nodes = saved.map((s) => scheduleNodeFrom(s, s.id, soldierExists(s.soldier) ? s.soldier : NO_SCHEDULE_SOLDIER));
  return { nodes, lastId: FIRST_LOADED_ID + saved.length };
}

export function getSchedule(list: ScheduleList, id: number): ScheduleNode | null {
  return list.nodes.find((n) => n.id === id) ?? null;
}

export function deleteScheduleNode(list: ScheduleList, clock: ScheduleClock, id: number): void {
  const at = list.nodes.findIndex((n) => n.id === id);
  if (at < 0) return;
  list.nodes.splice(at, 1);
  clock.deleteEvent(id);
}
