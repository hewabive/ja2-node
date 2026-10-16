import { describe, expect, it } from 'vitest';
import { EventKind, Frequency, NUM_SEC_IN_DAY, Warp } from './constants.ts';
import {
  addAdvancedStrategicEvent,
  addEveryDayStrategicEvent,
  addPeriodStrategicEvent,
  addSameDayRangedStrategicEvent,
  addStrategicEventUsingSeconds,
  createEventQueue,
  deleteAllStrategicEventsOfType,
  type StrategicEvent,
} from './event-queue.ts';
import { type ClockContext, createWorldClock, interruptTime, warpGameTime } from './world-clock.ts';

const DAY1 = NUM_SEC_IN_DAY;

function context(onEvent: (ctx: ClockContext, e: StrategicEvent) => void = () => {}) {
  const log: { kind: number; param: number; stamp: number; clock: number; frequency: number }[] = [];
  const ctx: ClockContext = {
    clock: createWorldClock(DAY1),
    queue: createEventQueue(),
    screen: () => 'strategic',
    inCombat: () => false,
    execute: (e) => {
      log.push({ kind: e.kind, param: e.param, stamp: e.stamp, clock: ctx.clock.seconds, frequency: e.frequency });
      onEvent(ctx, e);
      return true;
    },
    afterAdvance: () => {},
    compressionModeSet: () => {},
    firstCompressionSinceMapEntry: () => {},
    compressionRefusal: () => null,
  };
  return { ctx, log };
}

describe('strategic event queue', () => {
  it('keeps equal stamps in posting order and puts reposts after them', () => {
    const { ctx, log } = context();
    addStrategicEventUsingSeconds(ctx.queue, EventKind.GROUP_ARRIVAL, DAY1 + 60, 1);
    addStrategicEventUsingSeconds(ctx.queue, EventKind.GROUP_ARRIVAL, DAY1 + 30, 2);
    addStrategicEventUsingSeconds(ctx.queue, EventKind.GROUP_ARRIVAL, DAY1 + 60, 3);
    warpGameTime(ctx, 120, Warp.NORMAL);
    expect(log.map((e) => e.param)).toEqual([2, 1, 3]);
    expect(log.map((e) => e.clock)).toEqual([DAY1 + 30, DAY1 + 60, DAY1 + 60]);
    expect(ctx.clock.seconds).toBe(DAY1 + 120);
  });

  it('reposts periodic, everyday and ranged events from their own stamps', () => {
    const { ctx, log } = context();
    addPeriodStrategicEvent(ctx.queue, ctx.clock, EventKind.HOURLY_UPDATE, 60, 0);
    addEveryDayStrategicEvent(ctx.queue, ctx.clock, EventKind.MERC_DAILY_UPDATE, 0, 0);
    addSameDayRangedStrategicEvent(ctx.queue, ctx.clock, EventKind.AMBIENT, 90, 30, 7);
    warpGameTime(ctx, NUM_SEC_IN_DAY + 1, Warp.NORMAL);
    const hourly = log.filter((e) => e.kind === EventKind.HOURLY_UPDATE).map((e) => e.stamp - DAY1);
    expect(hourly.slice(0, 3)).toEqual([3600, 7200, 10800]);
    expect(hourly).toHaveLength(24);
    expect(log.filter((e) => e.kind === EventKind.MERC_DAILY_UPDATE).map((e) => e.stamp)).toEqual([DAY1, 2 * DAY1]);
    const ambient = log.filter((e) => e.kind === EventKind.AMBIENT);
    expect(ambient.map((e) => [e.frequency, e.stamp - DAY1])).toEqual([
      [Frequency.RANGED, 5400],
      [Frequency.ENDRANGED, 7200],
    ]);
    expect(ctx.queue.events.find((e) => e.kind === EventKind.AMBIENT)).toBeUndefined();
  });

  it('catches up every missed period after a jump without processing', () => {
    const { ctx, log } = context();
    addPeriodStrategicEvent(ctx.queue, ctx.clock, EventKind.QUARTER_HOUR_UPDATE, 15, 0);
    warpGameTime(ctx, 3600, Warp.NO_PROCESSING);
    expect(log).toHaveLength(0);
    warpGameTime(ctx, 1, Warp.NORMAL);
    expect(log.map((e) => e.stamp - DAY1)).toEqual([900, 1800, 2700, 3600]);
    expect(log.every((e) => e.clock === DAY1 + 3600)).toBe(true);
  });

  it('rejects posts at or before the running event from inside a callback', () => {
    let accepted: boolean[] = [];
    const { ctx } = context((c, e) => {
      if (e.param !== 1) return;
      accepted = [
        addStrategicEventUsingSeconds(c.queue, EventKind.GROUP_ARRIVAL, e.stamp, 9),
        addStrategicEventUsingSeconds(c.queue, EventKind.GROUP_ARRIVAL, e.stamp - 5, 9),
        addStrategicEventUsingSeconds(c.queue, EventKind.GROUP_ARRIVAL, e.stamp + 5, 2),
      ];
    });
    addStrategicEventUsingSeconds(ctx.queue, EventKind.GROUP_ARRIVAL, DAY1 + 10, 1);
    warpGameTime(ctx, 60, Warp.NORMAL);
    expect(accepted).toEqual([false, false, true]);
    expect(ctx.queue.events).toHaveLength(0);
  });

  it('accepts past stamps outside processing and runs them without moving the clock back', () => {
    const { ctx, log } = context();
    ctx.clock.seconds = DAY1 + 1000;
    ctx.clock.previousSeconds = ctx.clock.seconds;
    expect(addAdvancedStrategicEvent(ctx.queue, Frequency.ONETIME, EventKind.HOURLY_UPDATE, DAY1, 0)).not.toBeNull();
    warpGameTime(ctx, 10, Warp.NORMAL);
    expect(log[0]?.clock).toBe(DAY1 + 1000);
    expect(ctx.clock.seconds).toBe(DAY1 + 1010);
  });

  it('stops after an interrupting event and leaves equal-stamp successors for the next advance', () => {
    const { ctx, log } = context((c, e) => {
      if (e.param === 1) interruptTime(c.clock);
    });
    addStrategicEventUsingSeconds(ctx.queue, EventKind.GROUP_ARRIVAL, DAY1 + 20, 1);
    addStrategicEventUsingSeconds(ctx.queue, EventKind.GROUP_ARRIVAL, DAY1 + 20, 2);
    warpGameTime(ctx, 60, Warp.NORMAL);
    expect(log.map((e) => e.param)).toEqual([1]);
    expect(ctx.clock.seconds).toBe(DAY1 + 20);
    warpGameTime(ctx, 60, Warp.NORMAL);
    expect(log.map((e) => e.param)).toEqual([1, 2]);
    expect(ctx.clock.seconds).toBe(DAY1 + 80);
  });

  it('runs only the last event at the target second when warping to the target first', () => {
    const { ctx, log } = context();
    addStrategicEventUsingSeconds(ctx.queue, EventKind.HOURLY_UPDATE, DAY1 + 100, 1);
    addStrategicEventUsingSeconds(ctx.queue, EventKind.GROUP_ARRIVAL, DAY1 + 300, 2);
    addStrategicEventUsingSeconds(ctx.queue, EventKind.GROUP_ARRIVAL, DAY1 + 300, 3);
    warpGameTime(ctx, 300, Warp.TARGET_TIME_FIRST);
    expect(log.map((e) => e.param)).toEqual([3]);
    expect(ctx.clock.seconds).toBe(DAY1 + 300);
    warpGameTime(ctx, 1, Warp.NORMAL);
    expect(log.map((e) => e.param)).toEqual([3, 1, 2]);
  });

  it('lets a callback delete events of its own kind without stopping its repost', () => {
    const { ctx, log } = context((c, e) => {
      if (e.kind === EventKind.HOURLY_UPDATE) deleteAllStrategicEventsOfType(c.queue, EventKind.HOURLY_UPDATE);
    });
    addPeriodStrategicEvent(ctx.queue, ctx.clock, EventKind.HOURLY_UPDATE, 60, 0);
    addStrategicEventUsingSeconds(ctx.queue, EventKind.HOURLY_UPDATE, DAY1 + 3700, 5);
    warpGameTime(ctx, 3 * 3600, Warp.NORMAL);
    expect(log.filter((e) => e.param === 0).map((e) => e.stamp - DAY1)).toEqual([3600, 7200, 10800]);
    expect(log.some((e) => e.param === 5)).toBe(false);
  });

  it('anchors periodic events at midnight, so a mid-day post catches up first', () => {
    const { ctx, log } = context();
    ctx.clock.seconds = DAY1 + 15 * 3600;
    ctx.clock.previousSeconds = ctx.clock.seconds;
    addPeriodStrategicEvent(ctx.queue, ctx.clock, EventKind.CREATURE_SPREAD, 450, 0);
    warpGameTime(ctx, 8 * 3600, Warp.NORMAL);
    expect(log.map((e) => (e.stamp - DAY1) / 60)).toEqual([450, 900, 1350]);
  });
});
