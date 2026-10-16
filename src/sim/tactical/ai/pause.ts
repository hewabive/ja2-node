// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc gfPauseAllAI, guiPauseAllAITimer, PAUSE_ALL_AI_DELAY, PauseAITemporarily,
// @src PauseAIUntilManuallyUnpaused, UnPauseAI, ExecuteOverhead (the end of a timed pause). See docs/24 §3.6, §10.2.

import type { TacticalState } from '../state.ts';

export const PAUSE_ALL_AI_DELAY_MS = 1500;

export function pauseAiTemporarily(t: TacticalState): void {
  t.turn.pauseAllAi = true;
  t.turn.pauseAllAiSinceMs = t.clockMs;
}

export function pauseAiUntilManuallyUnpaused(t: TacticalState): void {
  t.turn.pauseAllAi = true;
  t.turn.pauseAllAiSinceMs = null;
}

export function unPauseAi(t: TacticalState): void {
  t.turn.pauseAllAi = false;
  t.turn.pauseAllAiSinceMs = null;
}

export function endTimedAiPause(t: TacticalState): void {
  const since = t.turn.pauseAllAiSinceMs;
  if (t.turn.pauseAllAi && since !== null && t.clockMs - since > PAUSE_ALL_AI_DELAY_MS) t.turn.pauseAllAi = false;
}
