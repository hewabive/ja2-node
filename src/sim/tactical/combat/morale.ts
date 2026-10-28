// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Morale.cc gbMoraleEvent, RefreshSoldierMorale, UpdateSoldierMorale, HandleMoraleEvent
// @src (soldier-only tactical events).

import { profileProgress } from '../profiles.ts';
import { Body, NO_PROFILE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { CONSCIOUSNESS } from './types.ts';

export const MoraleEvent = { KILLED_ENEMY: 0, SUPPRESSED: 2, DID_LOTS_OF_DAMAGE: 4, TOOK_LOTS_OF_DAMAGE: 5 } as const;

const TACTICAL_CHANGE: Readonly<Record<number, number>> = {
  [MoraleEvent.KILLED_ENEMY]: 4,
  [MoraleEvent.SUPPRESSED]: -1,
  [MoraleEvent.DID_LOTS_OF_DAMAGE]: 2,
  [MoraleEvent.TOOK_LOTS_OF_DAMAGE]: -3,
};

const Attitude = { OPTIMIST: 3, PESSIMIST: 4, AGGRESSIVE: 5, COWARD: 9 } as const;
const MORALE_MOD_MAX = 50;
const DEFAULT_MORALE = 50;

const isMechanical = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON || (s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP);

export function refreshSoldierMorale(t: TacticalState, s: Soldier): void {
  const m = DEFAULT_MORALE + s.teamMoraleMod + s.tacticalMoraleMod + s.strategicMoraleMod + Math.trunc(t.campaign.progress / 5);
  s.morale = Math.min(100, Math.max(0, m));
}

export function handleMoraleEvent(t: TacticalState, s: Soldier, event: number): void {
  const base = TACTICAL_CHANGE[event];
  if (base === undefined || !s.placed || s.life < CONSCIOUSNESS || isMechanical(s) || s.profile === NO_PROFILE) return;
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
}
