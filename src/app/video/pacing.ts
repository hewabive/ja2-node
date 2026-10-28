// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Cinematics.cc SmkPlayFlic (milliseconds_per_frame), SmkSkipFrames (late frames are decoded, not
// @src shown), SmkPollFlics (the video ends when the frame after the last one is due).

const MICROS_PER_SECOND = 1_000_000;
const MILLIS_PER_SECOND = 1000;

export interface FrameTiming {
  readonly frameCount: number;
  readonly microsPerFrame: number;
}

export function frameDueAt(timing: FrameTiming, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  return Math.floor((elapsedSeconds * MICROS_PER_SECOND) / timing.microsPerFrame);
}

export function videoDurationSeconds(timing: FrameTiming): number {
  return (timing.frameCount * timing.microsPerFrame) / MICROS_PER_SECOND;
}

export function videoFinished(timing: FrameTiming, elapsedSeconds: number): boolean {
  return frameDueAt(timing, elapsedSeconds) >= timing.frameCount;
}

export function frameToRequest(timing: FrameTiming, lastRequested: number, inFlight: boolean, elapsedSeconds: number): number | null {
  if (inFlight || videoFinished(timing, elapsedSeconds)) return null;
  const due = Math.min(timing.frameCount - 1, frameDueAt(timing, elapsedSeconds));
  return due > lastRequested ? due : null;
}

export type ClockSource = 'audio' | 'wall';

export interface VideoClock {
  readonly source: ClockSource;
  elapsed(): number;
  stop(): void;
}

export function wallClock(nowMs: () => number): VideoClock {
  const started = nowMs();
  return { source: 'wall', elapsed: () => (nowMs() - started) / MILLIS_PER_SECOND, stop: () => undefined };
}
