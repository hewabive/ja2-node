// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Morale.cc gbMoraleEvent, RefreshSoldierMorale, UpdateSoldierMorale, HandleMoraleEvent
// @src (soldier-only tactical events; the phobic ones and PHOBIC_LIMIT, the EPC and assignment checks and the
// @src low-morale quote of UpdateSoldierMorale 2026-11-01; the drug term of RefreshSoldierMorale and the crash events
// @src 2026-11-04).

import { idiv } from '../../../core/int.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { drugMoraleBonus } from '../drugs.ts';
import { soldierAssignment } from '../narrative/assignment.ts';
import { clearQuoteSaid, MercQuote, markQuoteSaid, QuoteSaidFlag, quoteSaid } from '../narrative/merc-quotes.ts';
import { profileProgress } from '../profiles.ts';
import { Body, NO_PROFILE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { CONSCIOUSNESS } from './types.ts';

export const MoraleEvent = {
  KILLED_ENEMY: 0,
  SUPPRESSED: 2,
  DID_LOTS_OF_DAMAGE: 4,
  TOOK_LOTS_OF_DAMAGE: 5,
  DRUGS_CRASH: 24,
  ALCOHOL_CRASH: 25,
  CLAUSTROPHOBE_UNDERGROUND: 28,
  INSECT_PHOBIC_SEES_CREATURE: 29,
  NERVOUS_ALONE: 30,
} as const;

const TACTICAL_CHANGE: Readonly<Record<number, number>> = {
  [MoraleEvent.KILLED_ENEMY]: 4,
  [MoraleEvent.SUPPRESSED]: -1,
  [MoraleEvent.DID_LOTS_OF_DAMAGE]: 2,
  [MoraleEvent.TOOK_LOTS_OF_DAMAGE]: -3,
  [MoraleEvent.DRUGS_CRASH]: -10,
  [MoraleEvent.ALCOHOL_CRASH]: -10,
  [MoraleEvent.CLAUSTROPHOBE_UNDERGROUND]: -1,
  [MoraleEvent.INSECT_PHOBIC_SEES_CREATURE]: -5,
  [MoraleEvent.NERVOUS_ALONE]: -1,
};

const PHOBIC_EVENTS: ReadonlySet<number> = new Set([
  MoraleEvent.CLAUSTROPHOBE_UNDERGROUND,
  MoraleEvent.INSECT_PHOBIC_SEES_CREATURE,
  MoraleEvent.NERVOUS_ALONE,
]);
const PHOBIC_LIMIT = -20;

const Attitude = { OPTIMIST: 3, PESSIMIST: 4, AGGRESSIVE: 5, COWARD: 9 } as const;
const MORALE_MOD_MAX = 50;
const DEFAULT_MORALE = 50;
const LOW_MORALE_QUOTE_BELOW = 35;
const LOW_MORALE_FLAG_RESET_ABOVE = 65;
const MORALE_FROZEN_ASSIGNMENTS: ReadonlySet<number> = new Set([
  Assignment.ASSIGNMENT_DEAD,
  Assignment.ASSIGNMENT_POW,
  Assignment.IN_TRANSIT,
]);

const isMechanical = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON || (s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP);

export function refreshSoldierMorale(t: TacticalState, s: Soldier): void {
  if (t.narrative.mercAsleep(s)) return;
  const mods = s.teamMoraleMod + s.tacticalMoraleMod + s.strategicMoraleMod;
  const m = DEFAULT_MORALE + mods + idiv(t.campaign.progress, 5) + drugMoraleBonus(s);
  s.morale = Math.min(100, Math.max(0, m));
}

function moraleCounts(t: TacticalState, s: Soldier): boolean {
  if (!s.placed || s.life < CONSCIOUSNESS || isMechanical(s) || t.narrative.isEpc(s)) return false;
  return !MORALE_FROZEN_ASSIGNMENTS.has(soldierAssignment(t, s)) && s.profile !== NO_PROFILE;
}

function lowMoraleQuote(t: TacticalState, s: Soldier): void {
  const said = quoteSaid(t, s).quoteSaidFlags & QuoteSaidFlag.LOW_MORAL;
  if (!t.narrative.mercAsleep(s) && s.morale < LOW_MORALE_QUOTE_BELOW && !said) {
    t.narrative.sayQuote(s, MercQuote.STARTING_TO_WHINE, true);
    markQuoteSaid(t, s, QuoteSaidFlag.LOW_MORAL);
  }
  if (s.morale > LOW_MORALE_FLAG_RESET_ABOVE) clearQuoteSaid(t, s, QuoteSaidFlag.LOW_MORAL);
}

export function handleMoraleEvent(t: TacticalState, s: Soldier, event: number): void {
  const base = TACTICAL_CHANGE[event];
  if (base === undefined || !moraleCounts(t, s)) return;
  if (PHOBIC_EVENTS.has(event) && s.tacticalMoraleMod <= PHOBIC_LIMIT) return;
  const p = profileProgress(t, s.profile);
  if (!p) return;
  let mod = base;
  if (mod > 0) {
    if (p.attitude === Attitude.OPTIMIST || p.attitude === Attitude.AGGRESSIVE) mod++;
    else if (p.attitude === Attitude.PESSIMIST) mod--;
  } else {
    if (p.attitude === Attitude.OPTIMIST) mod++;
    else if (p.attitude === Attitude.PESSIMIST) mod--;
    else if (p.attitude === Attitude.COWARD) mod -= 2;
    if (s.level === 1) mod--;
    else if (s.level > 5) mod++;
    if (mod > 0) mod = 0;
  }
  s.tacticalMoraleMod = Math.min(MORALE_MOD_MAX, Math.max(-MORALE_MOD_MAX, s.tacticalMoraleMod + mod));
  refreshSoldierMorale(t, s);
  lowMoraleQuote(t, s);
}
