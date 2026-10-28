// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Status.cc TrackEnemiesKilled, SoldierClassToRankIndex; Strategic_Status.h.

import { u16 } from '../../../core/int.ts';
import { SoldierClass } from '../../tactical/soldier.ts';
import type { StrategicStatus } from './queen-state.ts';

export const EnemyKilled = { IN_TACTICAL: 0, IN_AUTO_RESOLVE: 1, TOTAL: 2 } as const;

const NO_RANK = -1;

export function soldierClassToRankIndex(soldierClass: number): number {
  if (soldierClass === SoldierClass.ADMINISTRATOR) return 0;
  if (soldierClass === SoldierClass.ARMY) return 1;
  if (soldierClass === SoldierClass.ELITE) return 2;
  return NO_RANK;
}

function bump(status: StrategicStatus, how: number, rank: number): void {
  const row = status.enemiesKilled[how];
  if (row) row[rank] = u16((row[rank] ?? 0) + 1);
}

export function trackEnemiesKilled(status: StrategicStatus, how: number, soldierClass: number): void {
  const rank = soldierClassToRankIndex(soldierClass);
  if (rank === NO_RANK) return;
  bump(status, how, rank);
  if (how !== EnemyKilled.TOTAL) bump(status, EnemyKilled.TOTAL, rank);
}

export function recordPlayerKill(status: StrategicStatus): void {
  status.playerKills = u16(status.playerKills + 1);
}
