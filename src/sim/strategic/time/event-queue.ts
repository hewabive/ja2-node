// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Events.cc AddAdvancedStrategicEvent and the Add*StrategicEvent variants,
// @src ProcessPendingGameEvents, AdjustClockToEventStamp, DeleteStrategicEvent, DeleteAllStrategicEventsOfType. See docs/15 §2.

import { u32 } from '../../../core/int.ts';
import { Frequency, NUM_MIN_IN_DAY, NUM_SEC_IN_DAY, NUM_SEC_IN_MIN, Warp, type WarpCode } from './constants.ts';
import type { ClockContext, WorldClock } from './world-clock.ts';

export interface StrategicEvent {
  readonly stamp: number;
  readonly kind: number;
  readonly frequency: number;
  readonly param: number;
  offset: number;
  readonly seq: number;
}

export interface EventQueue {
  readonly events: StrategicEvent[];
  nextSeq: number;
  processing: boolean;
  executingStamp: number;
}

export function createEventQueue(): EventQueue {
  return { events: [], nextSeq: 0, processing: false, executingStamp: 0 };
}

const before = (a: StrategicEvent, stamp: number, seq: number) => a.stamp < stamp || (a.stamp === stamp && a.seq < seq);

export function addAdvancedStrategicEvent(
  q: EventQueue,
  frequency: number,
  kind: number,
  stamp: number,
  param: number,
): StrategicEvent | null {
  if (q.processing && stamp <= q.executingStamp) return null;
  const event: StrategicEvent = { stamp: u32(stamp), kind, frequency, param: u32(param), offset: 0, seq: q.nextSeq++ };
  let at = q.events.findIndex((e) => event.stamp < e.stamp);
  if (at < 0) at = q.events.length;
  q.events.splice(at, 0, event);
  return event;
}

const dayInSeconds = (c: WorldClock) => Math.trunc(c.seconds / NUM_SEC_IN_DAY) * NUM_SEC_IN_DAY;
const dayInMinutes = (c: WorldClock) => Math.trunc(c.seconds / NUM_SEC_IN_DAY) * NUM_MIN_IN_DAY;

export function addStrategicEvent(q: EventQueue, kind: number, minute: number, param: number): boolean {
  return addAdvancedStrategicEvent(q, Frequency.ONETIME, kind, minute * NUM_SEC_IN_MIN, param) !== null;
}

export function addStrategicEventUsingSeconds(q: EventQueue, kind: number, seconds: number, param: number): boolean {
  return addAdvancedStrategicEvent(q, Frequency.ONETIME, kind, seconds, param) !== null;
}

export function addSameDayStrategicEvent(q: EventQueue, c: WorldClock, kind: number, minuteOfDay: number, param: number): boolean {
  return addStrategicEvent(q, kind, minuteOfDay + dayInMinutes(c), param);
}

export function addFutureDayStrategicEvent(
  q: EventQueue,
  c: WorldClock,
  kind: number,
  minuteOfDay: number,
  param: number,
  days: number,
): boolean {
  return addStrategicEvent(q, kind, minuteOfDay + (Math.trunc(c.seconds / NUM_SEC_IN_DAY) + days) * NUM_MIN_IN_DAY, param);
}

export function addSameDayRangedStrategicEvent(
  q: EventQueue,
  c: WorldClock,
  kind: number,
  startMinute: number,
  lengthMinutes: number,
  param: number,
): boolean {
  const event = addAdvancedStrategicEvent(q, Frequency.RANGED, kind, (startMinute + dayInMinutes(c)) * NUM_SEC_IN_MIN, param);
  if (!event) return false;
  event.offset = lengthMinutes * NUM_SEC_IN_MIN;
  return true;
}

export function addEveryDayStrategicEvent(q: EventQueue, c: WorldClock, kind: number, minuteOfDay: number, param: number): boolean {
  return addAdvancedStrategicEvent(q, Frequency.EVERYDAY, kind, dayInSeconds(c) + minuteOfDay * NUM_SEC_IN_MIN, param) !== null;
}

export function addPeriodStrategicEvent(q: EventQueue, c: WorldClock, kind: number, everyMinutes: number, param: number): boolean {
  return addPeriodStrategicEventWithOffset(q, c, kind, everyMinutes, everyMinutes, param);
}

export function addPeriodStrategicEventWithOffset(
  q: EventQueue,
  c: WorldClock,
  kind: number,
  everyMinutes: number,
  offsetMinutes: number,
  param: number,
): boolean {
  const event = addAdvancedStrategicEvent(q, Frequency.PERIODIC, kind, dayInSeconds(c) + offsetMinutes * NUM_SEC_IN_MIN, param);
  if (!event) return false;
  event.offset = everyMinutes * NUM_SEC_IN_MIN;
  return true;
}

export function deleteStrategicEvent(q: EventQueue, kind: number, param: number): boolean {
  const at = q.events.findIndex((e) => e.kind === kind && e.param === param);
  if (at < 0) return false;
  q.events.splice(at, 1);
  return true;
}

export function deleteAllStrategicEventsOfType(q: EventQueue, kind: number): void {
  for (let k = q.events.length - 1; k >= 0; k--) if (q.events[k]?.kind === kind) q.events.splice(k, 1);
}

export function deleteAllStrategicEvents(q: EventQueue): void {
  q.events.length = 0;
}

export function gameEventsPending(q: EventQueue, clockSeconds: number, adjust: number): boolean {
  const head = q.events[0];
  return head !== undefined && head.stamp <= clockSeconds + adjust;
}

function nextAfter(q: EventQueue, cursor: StrategicEvent | null): StrategicEvent | undefined {
  if (!cursor) return q.events[0];
  return q.events.find((e) => !before(e, cursor.stamp, cursor.seq) && e !== cursor);
}

function repost(q: EventQueue, e: StrategicEvent): void {
  if (e.frequency === Frequency.RANGED) addAdvancedStrategicEvent(q, Frequency.ENDRANGED, e.kind, e.stamp + e.offset, e.param);
  else if (e.frequency === Frequency.PERIODIC) {
    const next = addAdvancedStrategicEvent(q, Frequency.PERIODIC, e.kind, e.stamp + e.offset, e.param);
    if (next) next.offset = e.offset;
  } else if (e.frequency === Frequency.EVERYDAY)
    addAdvancedStrategicEvent(q, Frequency.EVERYDAY, e.kind, e.stamp + NUM_SEC_IN_DAY, e.param);
}

function isLastAtItsStamp(q: EventQueue, e: StrategicEvent): boolean {
  const at = q.events.indexOf(e);
  const next = q.events[at + 1];
  return next === undefined || next.stamp > e.stamp;
}

export function processPendingGameEvents(ctx: ClockContext, adjustment: number, code: WarpCode): void {
  const c = ctx.clock;
  const q = ctx.queue;
  let adjust = adjustment;
  c.timeInterrupt = false;
  q.processing = true;
  let cursor: StrategicEvent | null = null;
  for (let e = nextAfter(q, cursor); !c.timeInterrupt && e && e.stamp <= c.seconds + adjust; e = nextAfter(q, cursor)) {
    const targetOnly = code === Warp.TARGET_TIME_FIRST;
    if (targetOnly && (e.stamp !== c.seconds + adjust || !isLastAtItsStamp(q, e))) {
      cursor = e;
      continue;
    }
    if (e.stamp > c.seconds) {
      adjust -= e.stamp - c.seconds;
      c.seconds = e.stamp;
    }
    const at = q.events.indexOf(e);
    if (at >= 0) q.events.splice(at, 1);
    q.executingStamp = e.stamp;
    if (ctx.execute(e)) repost(q, e);
    cursor = e;
  }
  q.processing = false;
  if (adjust && !c.timeInterrupt) c.seconds = u32(c.seconds + adjust);
}
