import { describe, expect, it } from 'vitest';
import { CompressMode, EventKind, STARTING_TIME } from './constants.ts';
import { addStrategicEventUsingSeconds, createEventQueue, type StrategicEvent } from './event-queue.ts';
import {
  type ClockContext,
  type ClockScreen,
  CompressionStop,
  createWorldClock,
  isDayTime,
  midnightOfFutureDayInMinutes,
  pauseGame,
  setGameTimeCompressionLevel,
  startTimeCompression,
  stopTimeCompression,
  unPauseGame,
  updateClock,
  worldDay,
  worldHour,
  worldMinute,
} from './world-clock.ts';

const TICK_MS = 5;

interface Harness extends ClockContext {
  realMs: number;
  screenNow: ClockScreen;
  combat: boolean;
  executed: StrategicEvent[];
  tick(): void;
  ticks(n: number): void;
}

function harness(onEvent: (h: Harness, e: StrategicEvent) => void = () => {}): Harness {
  const h: Harness = {
    clock: createWorldClock(),
    queue: createEventQueue(),
    realMs: 0,
    screenNow: 'tactical',
    combat: false,
    executed: [],
    screen: () => h.screenNow,
    inCombat: () => h.combat,
    execute: (e) => {
      h.executed.push(e);
      onEvent(h, e);
      return true;
    },
    afterAdvance: () => {},
    compressionModeSet: () => {},
    firstCompressionSinceMapEntry: () => {},
    compressionRefusal: () => null,
    tick: () => {
      h.realMs += TICK_MS;
      updateClock(h, h.realMs);
    },
    ticks: (n) => {
      for (let i = 0; i < n; i++) h.tick();
    },
  };
  return h;
}

function changeTicks(h: Harness, n: number): number[] {
  const at: number[] = [];
  let last = h.clock.seconds;
  for (let i = 1; i <= n; i++) {
    h.tick();
    if (h.clock.seconds !== last) at.push(i);
    last = h.clock.seconds;
  }
  return at;
}

describe('world clock helpers', () => {
  it('splits world seconds into day, hour and minute', () => {
    const c = createWorldClock(0);
    expect([worldDay(c), worldHour(c), worldMinute(c)]).toEqual([0, 0, 0]);
    c.seconds = 86399;
    expect([worldDay(c), worldHour(c), worldMinute(c)]).toEqual([0, 23, 59]);
    c.seconds = 90000;
    expect([worldDay(c), worldHour(c), worldMinute(c)]).toEqual([1, 1, 0]);
    expect(midnightOfFutureDayInMinutes(c, 1)).toBe(2 * 1440);
  });

  it('starts a campaign on day 1 at 01:00 and calls 07:00–20:59 day time', () => {
    const c = createWorldClock();
    expect(c.seconds).toBe(STARTING_TIME);
    c.seconds = 86400 + 6 * 3600 + 59 * 60;
    expect(isDayTime(c)).toBe(false);
    c.seconds += 60;
    expect(isDayTime(c)).toBe(true);
    c.seconds = 86400 + 21 * 3600;
    expect(isDayTime(c)).toBe(false);
  });
});

describe('UpdateClock on 5 ms ticks', () => {
  it('advances one world second every 200 ticks in tactical real time', () => {
    const h = harness();
    setGameTimeCompressionLevel(h, CompressMode.X1);
    const start = h.clock.seconds;
    h.ticks(200 * 30);
    expect(h.clock.seconds - start).toBe(30);
  });

  it('moves in 60-second slices at 5, 30 and 60 minutes per second', () => {
    for (const [mode, expected] of [
      [CompressMode.MIN5, [40, 80, 120, 160, 200]],
      [CompressMode.MIN30, [7, 14, 20, 27, 34, 40]],
      [CompressMode.MIN60, [4, 7, 10, 14, 17, 20]],
    ] as const) {
      const h = harness();
      h.screenNow = 'strategic';
      h.tick();
      setGameTimeCompressionLevel(h, mode);
      expect(changeTicks(h, expected.at(-1) ?? 0).slice(0, expected.length)).toEqual(expected);
      const before = h.clock.seconds;
      h.ticks(200);
      expect(h.clock.seconds - before).toBe([0, 0, 300, 1800, 3600][mode]);
    }
  });

  it('freezes the clock in turn-based combat and adds one second right after it', () => {
    const h = harness();
    setGameTimeCompressionLevel(h, CompressMode.X1);
    h.ticks(100);
    h.combat = true;
    const frozen = h.clock.seconds;
    h.ticks(2000);
    expect(h.clock.seconds).toBe(frozen);
    h.combat = false;
    h.tick();
    expect(h.clock.seconds).toBe(frozen + 1);
  });

  it('stops while paused or on another screen and re-phases afterwards', () => {
    const h = harness();
    setGameTimeCompressionLevel(h, CompressMode.X1);
    h.ticks(150);
    pauseGame(h.clock);
    const at = h.clock.seconds;
    h.ticks(1000);
    expect(h.clock.seconds).toBe(at);
    unPauseGame(h.clock);
    h.ticks(199);
    expect(h.clock.seconds).toBe(at);
    h.tick();
    expect(h.clock.seconds).toBe(at + 1);
  });

  it('runs events at their stamps inside a slice and keeps the slice end', () => {
    const h = harness();
    h.screenNow = 'strategic';
    h.tick();
    setGameTimeCompressionLevel(h, CompressMode.MIN5);
    const start = h.clock.seconds;
    addStrategicEventUsingSeconds(h.queue, EventKind.HOURLY_UPDATE, start + 30, 0);
    const seen: number[] = [];
    const h2 = harness((x, e) => seen.push(x.clock.seconds - e.stamp));
    h2.screenNow = 'strategic';
    h2.tick();
    setGameTimeCompressionLevel(h2, CompressMode.MIN5);
    addStrategicEventUsingSeconds(h2.queue, EventKind.HOURLY_UPDATE, h2.clock.seconds + 30, 0);
    const s2 = h2.clock.seconds;
    h2.ticks(40);
    expect(seen).toEqual([0]);
    expect(h2.clock.seconds).toBe(s2 + 60);
    h.ticks(40);
    expect(h.executed.map((e) => e.stamp)).toEqual([start + 30]);
  });

  it('finishes the slice when an event stops compression and then stays put', () => {
    const h = harness((x) => stopTimeCompression(x, CompressionStop.ARRIVED));
    h.screenNow = 'strategic';
    h.tick();
    expect(startTimeCompression(h)).toBeNull();
    expect(h.clock.mode).toBe(CompressMode.MIN5);
    const start = h.clock.seconds;
    addStrategicEventUsingSeconds(h.queue, EventKind.GROUP_ARRIVAL, start + 10, 0);
    h.ticks(40);
    expect(h.clock.seconds).toBe(start + 60);
    expect(h.clock.compressionOn).toBe(false);
    expect(h.clock.mode).toBe(CompressMode.MIN5);
    h.ticks(400);
    expect(h.clock.seconds).toBe(start + 60);
  });

  it('refuses compression when the context forbids it', () => {
    const h = harness();
    h.screenNow = 'strategic';
    h.compressionRefusal = () => 'enemies in sector';
    expect(startTimeCompression(h)).toBe('enemies in sector');
    expect(h.clock.compressionOn).toBe(false);
  });
});
