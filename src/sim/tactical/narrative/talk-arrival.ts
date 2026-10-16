// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/Soldier.cc (MERC_TALK pending action on arrival). See docs/24 §6.2.

import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

export function handlePendingTalkOnArrival(t: TacticalState, s: Soldier): boolean {
  const target = s.pendingTalk;
  if (target === null) return false;
  s.pendingTalk = null;
  t.narrative.startTalking(s, target);
  return true;
}
