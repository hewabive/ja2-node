// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Town_Loyalty.cc BuildListOfTownSectors, GetNumberOfWholeTownsUnderControl,
// @src IsTownUnderCompleteControlByPlayer; StrategicMap.cc GetTownIdForSector, GetTownSectorSize, GetTownSectorsUnderControl;
// @src Town_Militia.cc SectorOursAndPeaceful. See docs/18 §1.1, §3.5.

import type { Town } from '../../../content/strategic/map-tables.ts';
import { MAP_SIDE, type Sector, sameSector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { u8 } from '../../../core/int.ts';
import { numEnemiesInSector, numHostilesInSector } from '../forces/groups.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { FIRST_TOWN, NUM_TOWNS, Town as TownId } from './constants.ts';
import type { EconomyContext, TownSector } from './ports.ts';

export function buildTownSectors(towns: readonly Town[]): TownSector[] {
  const townOfSector = new Map<number, number>();
  for (const t of towns) for (const s of t.sectors) townOfSector.set(s, t.townId);
  const list: TownSector[] = [];
  for (let x = 1; x <= MAP_SIDE; x++) {
    for (let y = 1; y <= MAP_SIDE; y++) {
      const sector = sectorId({ x, y });
      const town = townOfSector.get(sector) ?? TownId.BLANK;
      if (town >= FIRST_TOWN && town < NUM_TOWNS) list.push({ town, sector });
    }
  }
  return list;
}

export function townOf(ctx: StrategicContext, s: { readonly x: number; readonly y: number }): number {
  return ctx.state.map.elements[strategicIndex(s)]?.nameId ?? TownId.BLANK;
}

export function sectorsOfTown(ctx: EconomyContext, town: number): readonly TownSector[] {
  return ctx.townSectors.filter((t) => t.town === town);
}

export function townSize(ctx: EconomyContext, town: number): number {
  return u8(sectorsOfTown(ctx, town).length);
}

export function sectorsUnderControl(ctx: EconomyContext, town: number): number {
  let n = 0;
  for (const t of sectorsOfTown(ctx, town)) {
    const s = sectorFromId(t.sector);
    if (ctx.state.map.elements[strategicIndex(s)]?.enemyControlled) continue;
    if (numEnemiesInSector(ctx, s) !== 0) continue;
    n++;
  }
  return u8(n);
}

export function isTownUnderCompleteControl(ctx: EconomyContext, town: number): boolean {
  return townSize(ctx, town) === sectorsUnderControl(ctx, town);
}

export function isTownUnderCompleteEnemyControl(ctx: EconomyContext, town: number): boolean {
  return sectorsUnderControl(ctx, town) === 0;
}

export function numberOfWholeTownsUnderControl(ctx: EconomyContext): number {
  let n = 0;
  for (let town = FIRST_TOWN; town < NUM_TOWNS; town++)
    if (isTownUnderCompleteControl(ctx, town) && ctx.economy.loyalty.usesLoyalty[town]) n++;
  return n;
}

export function isLoadedSector(ctx: StrategicContext, s: Sector): boolean {
  const w = ctx.state.worldSector;
  return w !== null && sameSector(w, s);
}

export function sectorOursAndPeaceful(ctx: StrategicContext, s: Sector): boolean {
  if (isLoadedSector(ctx, s) && (ctx.world.enemyInSector() || ctx.clock.inCombat())) return false;
  if (!s.z && ctx.state.map.elements[strategicIndex(s)]?.enemyControlled) return false;
  return numHostilesInSector(ctx, s) === 0;
}
