// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc CommonEnterCombatModeCode (the sleeper's wake-up).

import { anim } from './anim-states.ts';
import { changeSoldierState } from './animation.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

const STATE_CHANGE_START_CODE = 1;

function changeStateFromSecondCode(t: TacticalState, s: Soldier, state: string): void {
  changeSoldierState(t, s, anim(t.content, state), STATE_CHANGE_START_CODE, true);
}

export function startWakingUp(t: TacticalState, s: Soldier): void {
  changeStateFromSecondCode(t, s, 'WKAEUP_FROM_SLEEP');
}
