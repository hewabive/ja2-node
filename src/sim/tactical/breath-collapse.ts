// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CheckForBreathCollapse, EVENT_BeginMercTurn (the low breath quote flag's
// @src reset).

import { AnimHeight, endHeight } from './animation.ts';
import { clearQuoteSaid, MercQuote, markQuoteSaid, QuoteSaidFlag, quoteSaid } from './narrative/merc-quotes.ts';
import { isVehicleBody } from './person-structure.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

const WARNED_ABOVE_BREATH_MAX = 70;
const WARNED_BELOW_BREATH = 20;
const WARNING_RESET_ABOVE_BREATH = 80;

function warnsOfLowBreath(t: TacticalState, s: Soldier): boolean {
  if (s.breathMax <= WARNED_ABOVE_BREATH_MAX || s.breath >= WARNED_BELOW_BREATH) return false;
  if (quoteSaid(t, s).quoteSaidFlags & QuoteSaidFlag.LOW_BREATH) return false;
  return endHeight(t.content, s.state) === AnimHeight.STAND;
}

export function checkForBreathCollapse(t: TacticalState, s: Soldier): boolean {
  if (warnsOfLowBreath(t, s)) {
    t.narrative.sayQuote(s, MercQuote.OUT_OF_BREATH);
    markQuoteSaid(t, s, QuoteSaidFlag.LOW_BREATH);
  }
  if (s.breath !== 0 || s.collapsed || isVehicleBody(s) || s.monsterOrAnimal) return false;
  s.breathCollapsed = true;
  return true;
}

export function resetLowBreathWarning(t: TacticalState, s: Soldier): void {
  if (s.breath > WARNING_RESET_ABOVE_BREATH) clearQuoteSaid(t, s, QuoteSaidFlag.LOW_BREATH);
}
