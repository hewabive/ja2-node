// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc CreateAutoResolveInterface (militia rank fill),
// @src AssociateEnemiesWithStrategicGroups, AutoResolveScreenHandle (entry order). See docs/19 §2.3–§2.5.

import { u8 } from '../../../../core/int.ts';
import type { RandomStream } from '../../../tactical/combat/context.ts';
import { calculateAttackValues, determineTeamLeaders } from './ratings.ts';
import { type ArCell, type AutoresolveEnv, type AutoresolveState, CellFlag, hasFlag, updateRobotController } from './state.ts';

export interface RankCounts {
  readonly green: number;
  readonly regular: number;
  readonly elite: number;
}

export function fillMilitiaRanks(pre: RandomStream, counts: RankCounts, civs: number): RankCounts {
  let { green, regular, elite } = counts;
  while (elite + regular + green < civs) {
    switch (pre.int(3)) {
      case 0:
        elite++;
        break;
      case 1:
        regular++;
        break;
      default:
        green++;
    }
  }
  return { green, regular, elite };
}

export interface EnemyCounts {
  readonly admins: number;
  readonly troops: number;
  readonly elites: number;
}

export interface EnemyGroupCounts extends EnemyCounts {
  readonly id: number;
}

const STATIONARY_GROUP = 0;

interface Remaining {
  admins: number;
  troops: number;
  elites: number;
}

function takeStationary(c: ArCell, left: Remaining): boolean {
  if (hasFlag(c, CellFlag.ELITE) && left.elites !== 0) left.elites--;
  else if (hasFlag(c, CellFlag.TROOP) && left.troops !== 0) left.troops--;
  else if (hasFlag(c, CellFlag.ADMIN) && left.admins !== 0) left.admins--;
  else return false;
  return true;
}

function takeGroupSlot(mobile: Remaining, group: Remaining): boolean {
  if (mobile.elites !== 0 && group.elites !== 0) {
    mobile.elites--;
    group.elites--;
  } else if (mobile.troops !== 0 && group.troops !== 0) {
    mobile.troops--;
    group.troops--;
  } else if (mobile.admins !== 0 && group.admins !== 0) {
    mobile.admins--;
    group.admins--;
  } else return false;
  return true;
}

function assign(c: ArCell, groupId: number): void {
  c.flags |= CellFlag.ASSIGNED;
  c.groupId = groupId;
}

export function associateEnemiesWithStrategicGroups(
  enemies: readonly ArCell[],
  totals: EnemyCounts,
  stationary: EnemyCounts,
  groups: readonly EnemyGroupCounts[],
): void {
  const garrison: Remaining = { ...stationary };
  for (const c of enemies) if (takeStationary(c, garrison)) assign(c, STATIONARY_GROUP);
  const mobile: Remaining = {
    admins: u8(totals.admins - stationary.admins),
    troops: u8(totals.troops - stationary.troops),
    elites: u8(totals.elites - stationary.elites),
  };
  if (!mobile.elites && !mobile.troops && !mobile.admins) return;
  for (const g of groups) {
    const left: Remaining = { admins: g.admins, troops: g.troops, elites: g.elites };
    for (const c of enemies) {
      if (hasFlag(c, CellFlag.ASSIGNED)) continue;
      if (takeGroupSlot(mobile, left)) assign(c, g.id);
    }
  }
}

export function enterAutoresolve(env: AutoresolveEnv, ar: AutoresolveState): void {
  updateRobotController(env, ar);
  determineTeamLeaders(ar);
  calculateAttackValues(env.rng.pre, ar);
}
