// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Status.cc CalcDeathRate, ModifyPlayerReputation, MercThinksDeathRateTooHigh,
// @src MercThinksBadReputationTooHigh, MercThinksHisMoraleIsTooLow; Strategic_Status.h REPUTATION_*.

import { clamp, i8, u8, u32 } from '../../../core/int.ts';
import type { StrategicStatus } from '../../strategic/ai/queen-state.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';

export const Reputation = {
  LOW_DEATHRATE: 5,
  HIGH_DEATHRATE: -5,
  GREAT_MORALE: 3,
  POOR_MORALE: -3,
  BATTLE_WON: 2,
  BATTLE_LOST: -2,
  TOWN_WON: 5,
  TOWN_LOST: -5,
  SOLDIER_DIED: -2,
  SOLDIER_CAPTURED: -1,
  KILLED_CIVILIAN: -5,
  EARLY_FIRING: -3,
  KILLED_MONSTER_QUEEN: 15,
  KILLED_DEIDRANNA: 25,
} as const;

const DEATH_RATE_PERCENT = 100;
const DOESNT_CARE = 101;
const SAINT = 0;
const SATAN = 100;
const MORALE_TOLERANCE_BASE = 100;
const MORALE_TOLERANCE_DIVISOR = 2;

export function calcDeathRate(status: Pick<StrategicStatus, 'mercDeaths' | 'manDaysPlayed'>): number {
  if (status.manDaysPlayed <= 0) return 0;
  const deaths = Math.fround(status.mercDeaths * DEATH_RATE_PERCENT);
  const rate = Math.fround(deaths / Math.fround(u32(status.manDaysPlayed)));
  return u8(u32(Math.trunc(rate)));
}

export function modifyPlayerReputation(status: Pick<StrategicStatus, 'badReputation'>, change: number): void {
  status.badReputation = clamp(status.badReputation - i8(change), SAINT, SATAN);
}

export function mercThinksDeathRateTooHigh(status: Pick<StrategicStatus, 'mercDeaths' | 'manDaysPlayed'>, p: ProfileProgress): boolean {
  return p.deathRate !== DOESNT_CARE && calcDeathRate(status) > p.deathRate;
}

export function mercThinksBadReputationTooHigh(status: Pick<StrategicStatus, 'badReputation'>, p: ProfileProgress): boolean {
  return p.reputationTolerance !== DOESNT_CARE && status.badReputation > p.reputationTolerance;
}

export function mercThinksHisMoraleIsTooLow(p: ProfileProgress, morale: number): boolean {
  if (p.reputationTolerance === DOESNT_CARE) return false;
  const tolerance = i8(Math.trunc((MORALE_TOLERANCE_BASE - p.reputationTolerance) / MORALE_TOLERANCE_DIVISOR));
  return morale < tolerance;
}
