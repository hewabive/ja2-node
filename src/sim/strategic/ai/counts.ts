// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Queen_Command.cc NumStationaryEnemiesInSector, NumMobileEnemiesInSector,
// @src GetNumberOfMobileEnemiesInSector, GetNumberOfStationaryEnemiesInSector, GetNumberOfEnemiesInSector, PlayerSectorDefended.
// @src See docs/17 §1.6.

import { type Sector, sameSector, sectorFromId } from '../../../content/strategic/sector-ids.ts';
import { u8 } from '../../../core/int.ts';
import { findPlayerMovementGroupInSector, type Group } from '../forces/groups.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { type SectorInfo, sectorInfo, totalMilitia } from '../map/sectors.ts';
import { Composition, NO_GARRISON } from './constants.ts';

export interface EnemyCounts {
  admins: number;
  troops: number;
  elites: number;
}

export function garrisonEnemies(info: SectorInfo): number {
  return info.numAdmins + info.numTroops + info.numElites;
}

function enemyGroupsIn(ctx: StrategicContext, s: Sector): Group[] {
  return ctx.state.forces.groups.filter((g) => !g.player && !g.vehicle && sameSector(g.sector, s));
}

function garrisonIndexIsRoadblockComposition(info: SectorInfo): boolean {
  return info.garrisonId === Composition.ROADBLOCK;
}

export function numStationaryEnemiesInSector(ctx: StrategicContext, s: Sector): number {
  const info = sectorInfo(ctx.state.map, s);
  if (info.garrisonId === NO_GARRISON) return 0;
  if (ctx.state.queen.garrisons[info.garrisonId]?.composition === Composition.ROADBLOCK) return 0;
  return u8(garrisonEnemies(info));
}

export function numMobileEnemiesInSector(ctx: StrategicContext, s: Sector): number {
  let n = 0;
  for (const g of enemyGroupsIn(ctx, s)) n = u8(n + g.size);
  const info = sectorInfo(ctx.state.map, s);
  if (garrisonIndexIsRoadblockComposition(info)) n = u8(n + garrisonEnemies(info));
  return n;
}

export function getNumberOfMobileEnemiesInSector(ctx: StrategicContext, s: Sector): EnemyCounts {
  const counts: EnemyCounts = { admins: 0, troops: 0, elites: 0 };
  for (const g of enemyGroupsIn(ctx, s)) {
    const e = g.enemy;
    if (!e) continue;
    counts.troops = u8(counts.troops + e.numTroops);
    counts.elites = u8(counts.elites + e.numElites);
    counts.admins = u8(counts.admins + e.numAdmins);
  }
  const info = sectorInfo(ctx.state.map, s);
  if (garrisonIndexIsRoadblockComposition(info)) {
    counts.admins = u8(counts.admins + info.numAdmins);
    counts.troops = u8(counts.troops + info.numTroops);
    counts.elites = u8(counts.elites + info.numElites);
  }
  return counts;
}

export function getNumberOfStationaryEnemiesInSector(ctx: StrategicContext, s: Sector): EnemyCounts {
  const info = sectorInfo(ctx.state.map, s);
  return { admins: info.numAdmins, troops: info.numTroops, elites: info.numElites };
}

export function getNumberOfEnemiesInSector(ctx: StrategicContext, s: Sector): EnemyCounts {
  const stationary = getNumberOfStationaryEnemiesInSector(ctx, s);
  const mobile = getNumberOfMobileEnemiesInSector(ctx, s);
  return {
    admins: u8(stationary.admins + mobile.admins),
    troops: u8(stationary.troops + mobile.troops),
    elites: u8(stationary.elites + mobile.elites),
  };
}

export function playerSectorDefended(ctx: StrategicContext, id: number): boolean {
  const s = sectorFromId(id);
  if (totalMilitia(sectorInfo(ctx.state.map, s))) return true;
  return findPlayerMovementGroupInSector(ctx, s) !== undefined;
}
