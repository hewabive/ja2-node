// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Clock.cc UpdateClock, AdvanceClock, WarpGameTime, SetClockResolutionToCompressMode,
// @src StartTimeCompression, StopTimeCompression, PauseGame, LockPauseState, InterruptTime, UpdateGameClockGlobals.

import { u32 } from '../../../core/int.ts';
import {
  COMPRESS_SPEEDS,
  CompressMode,
  DAY_START_HOUR,
  MAX_CLOCK_RESOLUTION,
  NIGHT_START_HOUR,
  NUM_MIN_IN_DAY,
  NUM_MIN_IN_HOUR,
  NUM_SEC_IN_DAY,
  NUM_SEC_IN_HOUR,
  NUM_SEC_IN_MIN,
  REAL_MS_PER_SECOND,
  SECONDS_PER_SLICE,
  STARTING_TIME,
  Warp,
  type WarpCode,
} from './constants.ts';
import { type EventQueue, gameEventsPending, processPendingGameEvents, type StrategicEvent } from './event-queue.ts';

const MICROS_PER_SECOND = 1_000_000;

export interface ClockDriver {
  lastSecondMs: number;
  lastProcessed: number;
  lastResolution: number;
  timesThisSecond: number;
}

export interface WorldClock {
  seconds: number;
  previousSeconds: number;
  mode: number;
  secondsPerRealSecond: number;
  resolution: number;
  compressionOn: boolean;
  paused: boolean;
  pauseLocked: boolean;
  pauseLockReason: number;
  timeInterrupt: boolean;
  timeInterruptPause: boolean;
  playerPause: boolean;
  lastEventQuerySeconds: number;
  compressedSinceMapEntry: boolean;
  stopReason: CompressionStopReason | null;
  driver: ClockDriver;
}

export const CompressionStop = {
  ARRIVED: 'arrived',
  HALTED: 'halted',
  BATTLE: 'battle',
  MERC_ARRIVED: 'mercArrived',
  MERC_DIED: 'mercDied',
  MERC_LEFT: 'mercLeft',
  ASSIGNMENT_DONE: 'assignmentDone',
  MILITIA_TRAINING: 'militiaTraining',
  MINE_EVENT: 'mineEvent',
  COMPLAINT: 'complaint',
  CONTRACT: 'contract',
  REQUESTED: 'requested',
  MAP_EXIT: 'mapExit',
  HELICOPTER: 'helicopter',
  SHIPMENT: 'shipment',
  WORLD_TIME: 'worldTime',
  PAUSED: 'paused',
  MEANWHILE: 'meanwhile',
} as const;
export type CompressionStopReason = (typeof CompressionStop)[keyof typeof CompressionStop];

export type ClockScreen = 'tactical' | 'strategic' | 'other';

export interface ClockContext {
  readonly clock: WorldClock;
  readonly queue: EventQueue;
  screen(): ClockScreen;
  inCombat(): boolean;
  execute(event: StrategicEvent): boolean;
  afterAdvance(): void;
  compressionModeSet(mode: number): void;
  firstCompressionSinceMapEntry(): void;
  compressionRefusal(): string | null;
}

export function createWorldClock(seconds = STARTING_TIME): WorldClock {
  return {
    seconds,
    previousSeconds: seconds,
    mode: CompressMode.X0,
    secondsPerRealSecond: 0,
    resolution: 0,
    compressionOn: false,
    paused: false,
    pauseLocked: false,
    pauseLockReason: 0,
    timeInterrupt: false,
    timeInterruptPause: false,
    playerPause: false,
    lastEventQuerySeconds: 0,
    compressedSinceMapEntry: false,
    stopReason: null,
    driver: { lastSecondMs: 0, lastProcessed: 0, lastResolution: 1, timesThisSecond: 0 },
  };
}

export function worldDay(c: WorldClock): number {
  return Math.trunc(c.seconds / NUM_SEC_IN_DAY);
}

export function worldHour(c: WorldClock): number {
  return Math.trunc((c.seconds - worldDay(c) * NUM_SEC_IN_DAY) / NUM_SEC_IN_HOUR);
}

export function worldMinute(c: WorldClock): number {
  return Math.trunc((c.seconds - worldDay(c) * NUM_SEC_IN_DAY - worldHour(c) * NUM_SEC_IN_HOUR) / NUM_SEC_IN_MIN);
}

export function worldTotalMinutes(c: WorldClock): number {
  return Math.trunc(c.seconds / NUM_SEC_IN_MIN);
}

export function worldMinutesInDay(c: WorldClock): number {
  return worldHour(c) * NUM_MIN_IN_HOUR + worldMinute(c);
}

export function worldDayInMinutes(c: WorldClock): number {
  return worldDay(c) * NUM_MIN_IN_DAY;
}

export function midnightOfFutureDayInMinutes(c: WorldClock, days: number): number {
  return worldTotalMinutes(c) + days * NUM_MIN_IN_DAY - worldMinutesInDay(c);
}

export function isDayTime(c: WorldClock): boolean {
  const h = worldHour(c);
  return h >= DAY_START_HOUR && h < NIGHT_START_HOUR;
}

export function setClockResolutionToCompressMode(ctx: ClockContext, mode: number): void {
  const c = ctx.clock;
  c.secondsPerRealSecond = COMPRESS_SPEEDS[mode] ?? 0;
  c.resolution =
    c.secondsPerRealSecond === 0 ? 0 : Math.min(MAX_CLOCK_RESOLUTION, Math.max(1, Math.trunc(c.secondsPerRealSecond / SECONDS_PER_SLICE)));
  c.compressionOn = mode > CompressMode.X1;
  if (c.compressionOn) c.stopReason = null;
  if (mode > CompressMode.X1) ctx.compressionModeSet(mode);
}

export function isTimeBeingCompressed(c: WorldClock): boolean {
  return c.compressionOn && c.mode !== CompressMode.X0 && !c.paused;
}

export function compressionStopReason(c: WorldClock): CompressionStopReason {
  return c.compressionOn ? CompressionStop.PAUSED : (c.stopReason ?? CompressionStop.REQUESTED);
}

export function stopTimeCompression(ctx: ClockContext, reason: CompressionStopReason): void {
  if (!ctx.clock.compressionOn) return;
  ctx.clock.stopReason = reason;
  setClockResolutionToCompressMode(ctx, CompressMode.X0);
}

export function startTimeCompression(ctx: ClockContext): string | null {
  const c = ctx.clock;
  if (c.compressionOn) return null;
  if (c.paused && !unPauseGame(c)) return 'the game is paused';
  const refusal = ctx.compressionRefusal();
  if (refusal) return refusal;
  if (c.mode <= CompressMode.X1) {
    const raised = increaseGameTimeCompressionRate(ctx);
    if (raised) return raised;
  }
  setClockResolutionToCompressMode(ctx, c.mode);
  if (!c.compressedSinceMapEntry) {
    c.compressedSinceMapEntry = true;
    ctx.firstCompressionSinceMapEntry();
  }
  return null;
}

export function increaseGameTimeCompressionRate(ctx: ClockContext): string | null {
  const c = ctx.clock;
  if (c.mode >= CompressMode.MIN60) return null;
  const refusal = ctx.compressionRefusal();
  if (refusal) return refusal;
  c.mode++;
  if (ctx.screen() === 'strategic' && c.mode === CompressMode.X1) c.mode++;
  setClockResolutionToCompressMode(ctx, c.mode);
  return null;
}

export function decreaseGameTimeCompressionRate(ctx: ClockContext): string | null {
  const c = ctx.clock;
  if (c.mode <= CompressMode.X0) return null;
  const refusal = ctx.compressionRefusal();
  if (refusal) return refusal;
  c.mode--;
  if (ctx.screen() === 'strategic' && c.mode === CompressMode.X1) c.mode--;
  setClockResolutionToCompressMode(ctx, c.mode);
  return null;
}

export function setGameTimeCompressionLevel(ctx: ClockContext, requested: number): string | null {
  const screen = ctx.screen();
  let mode = requested;
  if (screen === 'tactical' && mode !== CompressMode.X1) mode = CompressMode.X1;
  if (screen === 'strategic' && mode === CompressMode.X1) mode = CompressMode.X0;
  if (mode >= CompressMode.MIN5) {
    const refusal = ctx.compressionRefusal();
    if (refusal) return refusal;
  }
  ctx.clock.mode = mode;
  setClockResolutionToCompressMode(ctx, mode);
  return null;
}

export function pauseGame(c: WorldClock): void {
  c.paused = true;
}

export function unPauseGame(c: WorldClock): boolean {
  if (c.pauseLocked) return false;
  c.paused = false;
  return true;
}

export function lockPauseState(c: WorldClock, reason: number): void {
  c.pauseLocked = true;
  c.pauseLockReason = reason;
}

export function unLockPauseState(c: WorldClock): void {
  c.pauseLocked = false;
}

export function interruptTime(c: WorldClock): void {
  c.timeInterrupt = true;
}

export function pauseTimeForInterrupt(c: WorldClock): void {
  c.timeInterruptPause = true;
}

export function warpGameTime(ctx: ClockContext, adjust: number, code: WarpCode): void {
  const c = ctx.clock;
  const saved = c.secondsPerRealSecond;
  c.secondsPerRealSecond = adjust;
  advanceClock(ctx, code);
  c.secondsPerRealSecond = saved;
}

export function advanceClock(ctx: ClockContext, code: WarpCode): void {
  const c = ctx.clock;
  if (code !== Warp.NO_PROCESSING) {
    c.lastEventQuerySeconds = c.seconds;
    if (gameEventsPending(ctx.queue, c.seconds, c.secondsPerRealSecond)) processPendingGameEvents(ctx, c.secondsPerRealSecond, code);
    else c.seconds = u32(c.seconds + c.secondsPerRealSecond);
  } else c.seconds = u32(c.seconds + c.secondsPerRealSecond);
  if (c.seconds < c.previousSeconds) c.seconds = c.previousSeconds;
  c.previousSeconds = c.seconds;
  ctx.afterAdvance();
}

export function updateClock(ctx: ClockContext, realMs: number): void {
  const c = ctx.clock;
  const d = c.driver;
  const screen = ctx.screen();
  if (screen === 'other' || c.paused || c.timeInterruptPause || c.resolution === 0 || c.secondsPerRealSecond === 0) {
    d.lastSecondMs = realMs;
    c.timeInterruptPause = false;
    return;
  }
  if (ctx.inCombat()) return;
  const oneRealSecondAgo = realMs - REAL_MS_PER_SECOND;
  d.lastSecondMs = Math.max(oneRealSecondAgo, d.lastSecondMs);
  const elapsedMs = realMs - d.lastSecondMs;
  if (c.resolution === 1) {
    if (elapsedMs >= REAL_MS_PER_SECOND) advanceOneSecond(ctx, realMs);
    return;
  }
  advanceDueSlices(ctx, realMs, elapsedMs);
}

function advanceOneSecond(ctx: ClockContext, realMs: number): void {
  const d = ctx.clock.driver;
  d.lastSecondMs = realMs;
  d.timesThisSecond = 0;
  d.lastProcessed = 0;
  advanceClock(ctx, Warp.NORMAL);
}

function rescaleToResolution(d: ClockDriver, resolution: number): void {
  d.timesThisSecond = Math.trunc((d.timesThisSecond * resolution) / d.lastResolution);
  d.lastProcessed = Math.trunc((d.lastProcessed * resolution) / d.lastResolution);
  d.lastResolution = resolution;
}

function advanceDueSlices(ctx: ClockContext, realMs: number, elapsedMs: number): void {
  const c = ctx.clock;
  const d = c.driver;
  if (c.resolution !== d.lastResolution) rescaleToResolution(d, c.resolution);
  const microsPerSlice = Math.trunc(MICROS_PER_SECOND / c.resolution);
  const nextSliceDueMs = Math.trunc((microsPerSlice * (d.timesThisSecond + 1)) / REAL_MS_PER_SECOND);
  if (elapsedMs < nextSliceDueMs) return;
  d.timesThisSecond = Math.trunc((elapsedMs * REAL_MS_PER_SECOND) / microsPerSlice);
  const secondsDue = Math.max(Math.trunc((c.secondsPerRealSecond * d.timesThisSecond) / c.resolution), d.lastProcessed);
  warpGameTime(ctx, secondsDue - d.lastProcessed, Warp.NORMAL);
  if (secondsDue < c.secondsPerRealSecond) {
    d.lastProcessed = secondsDue;
    return;
  }
  const compressionStoppedInWarp = c.resolution === 0;
  d.lastProcessed = secondsDue % c.secondsPerRealSecond;
  d.timesThisSecond = compressionStoppedInWarp ? 0 : d.timesThisSecond % c.resolution;
  d.lastSecondMs = realMs;
}
