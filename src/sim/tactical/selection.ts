// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc SelectSoldier (InternalSelectSoldier: its checks, the squad, PutMercInAwakeState and
// @src the psycho's personality quote), SelectNextAvailSoldier; Tactical/Soldier_Macros.h OK_CONTROLLABLE_MERC,
// @src OK_INTERRUPT_MERC; Tactical/Handle_UI.cc EndMultiSoldierSelection (the wake of the multi-selected mercs).

import { MercQuote, markQuoteSaid, okControllableMerc, QuoteSaidFlag, quoteSaid } from './narrative/merc-quotes.ts';
import type { Refusal } from './refusal.ts';
import { NO_PROFILE, OKLIFE, Personality, type Soldier, Team } from './soldier.ts';
import { okInterruptMerc } from './soldier-view.ts';
import { type TacticalState, teamMembers } from './state.ts';

export const NO_SELECTION = -1;

export const SelectFlags = { NONE: 0, FORCE_RESELECT: 1 } as const;

const PERSONALITY_QUOTE_ODDS = 50;

const NOT_CONTROLLABLE: Refusal = { token: 'cannotAct', reason: 'soldier cannot act' };
const ON_ASSIGNMENT: Refusal = { token: 'onAssignment', reason: 'the soldier is on an assignment, not on a squad' };
const UNAVAILABLE: Refusal = { token: 'mercUnavailable', reason: 'soldier has no move in this interrupt' };

export function selectedSoldier(t: TacticalState): Soldier | null {
  return t.soldiers[t.turn.selected] ?? null;
}

export function selectionRefusal(t: TacticalState, s: Soldier): Refusal | null {
  if (!okControllableMerc(t, s)) return s.life < OKLIFE ? NOT_CONTROLLABLE : ON_ASSIGNMENT;
  if (!okInterruptMerc(t, s)) return UNAVAILABLE;
  return null;
}

export function selectSoldier(t: TacticalState, s: Soldier, flags: number = SelectFlags.NONE): boolean {
  if (selectionRefusal(t, s)) return false;
  if (s.id === t.turn.selected && !(flags & SelectFlags.FORCE_RESELECT)) return false;
  t.turn.selected = s.id;
  t.narrative.setCurrentSquad(s);
  wakeIfAsleep(t, s);
  maySayPersonalityQuote(t, s);
  return true;
}

export function selectOrderedMerc(t: TacticalState, s: Soldier, multiSelected = false): void {
  if (multiSelected) wakeIfAsleep(t, s);
  else selectSoldier(t, s);
}

export function wakeIfAsleep(t: TacticalState, s: Soldier): void {
  if (t.narrative.mercAsleep(s)) t.narrative.putMercInAwakeState(s);
}

function maySayPersonalityQuote(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.OUR || s.profile === NO_PROFILE || t.narrative.isPlayerCharacter(s)) return;
  if (quoteSaid(t, s).quoteSaidFlags & QuoteSaidFlag.PERSONALITY) return;
  if (s.personalityTrait !== Personality.PSYCHO || t.rng.int(PERSONALITY_QUOTE_ODDS) !== 0) return;
  t.narrative.sayQuote(s, MercQuote.PERSONALITY_TRAIT);
  markQuoteSaid(t, s, QuoteSaidFlag.PERSONALITY);
}

export function selectNextAvailSoldier(t: TacticalState, last: Soldier): void {
  const next = teamMembers(t, last.team).find((s) => okControllableMerc(t, s));
  if (next) selectSoldier(t, next);
  else t.turn.selected = NO_SELECTION;
}

export function endMultiSoldierSelection(t: TacticalState, chosen: Soldier, members: readonly Soldier[]): void {
  for (const s of teamMembers(t, Team.OUR)) if (s === chosen || members.includes(s)) wakeIfAsleep(t, s);
  if (chosen.id !== t.turn.selected) selectSoldier(t, chosen, SelectFlags.FORCE_RESELECT);
}
