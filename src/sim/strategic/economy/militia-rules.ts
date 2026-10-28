// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Town_Militia.cc MilitiaTrainingAllowedInSector, MilitiaTrainingAllowedInTown, IsAreaFullOfMilitia,
// @src CountAllMilitiaInSector, MilitiaInSectorOfRank, CanNearbyMilitiaScoutThisSector; Strategic/Assignments.cc
// @src CanSectorContainMilita, DoesSectorMercIsInHaveSufficientLoyaltyToTrainMilitia.

import { MAP_SIDE, type Sector, sectorFromId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { u8 } from '../../../core/int.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { isThisSectorASamSector } from '../map/control.ts';
import { sectorInfo } from '../map/sectors.ts';
import { MAX_ALLOWABLE_MILITIA_PER_SECTOR, MAX_MILITIA_LEVELS, MIN_RATING_TO_TRAIN_TOWN, MilitiaRank, Town } from './constants.ts';
import type { EconomyContext } from './ports.ts';
import { sectorOursAndPeaceful, sectorsOfTown, townOf } from './towns.ts';

const SCOUT_RANGE = 1;

export function militiaInSectorOfRank(ctx: StrategicContext, s: { readonly x: number; readonly y: number }, rank: number): number {
  return sectorInfo(ctx.state.map, s).militia[rank] ?? 0;
}

export function countAllMilitiaInSector(ctx: StrategicContext, s: { readonly x: number; readonly y: number }): number {
  let total = 0;
  for (let rank = 0; rank < MAX_MILITIA_LEVELS; rank++) total = u8(total + militiaInSectorOfRank(ctx, s, rank));
  return total;
}

export function canSectorContainMilitia(ctx: StrategicContext, s: Sector): boolean {
  return (s.z === 0 && (ctx.state.map.elements[strategicIndex(s)]?.nameId ?? Town.BLANK) !== Town.BLANK) || isThisSectorASamSector(ctx, s);
}

export function militiaTrainingAllowedInTown(ctx: StrategicContext, town: number): boolean {
  return ctx.content.towns.find((t) => t.townId === town)?.isMilitiaTrainingAllowed === true;
}

export function militiaTrainingAllowedInSector(ctx: StrategicContext, s: Sector): boolean {
  if (s.z !== 0) return false;
  if (isThisSectorASamSector(ctx, s)) return true;
  return militiaTrainingAllowedInTown(ctx, townOf(ctx, s));
}

export function sectorHasSufficientLoyaltyToTrainMilitia(ctx: EconomyContext, s: Sector): boolean {
  if (s.z !== 0) return false;
  const town = townOf(ctx, s);
  if (town !== Town.BLANK) return (ctx.state.economy.towns[town]?.rating ?? 0) >= MIN_RATING_TO_TRAIN_TOWN;
  return isThisSectorASamSector(ctx, s);
}

function trainedMilitia(ctx: StrategicContext, s: { readonly x: number; readonly y: number }): number {
  return militiaInSectorOfRank(ctx, s, MilitiaRank.REGULAR) + militiaInSectorOfRank(ctx, s, MilitiaRank.ELITE);
}

export function isAreaFullOfMilitia(ctx: EconomyContext, s: Sector): boolean {
  if (s.z !== 0) return true;
  let count = 0;
  let max = 0;
  const town = townOf(ctx, s);
  if (town !== Town.BLANK) {
    for (const ts of sectorsOfTown(ctx, town)) {
      const sector = sectorFromId(ts.sector);
      if (!sectorOursAndPeaceful(ctx, sector)) continue;
      count += trainedMilitia(ctx, sector);
      max += MAX_ALLOWABLE_MILITIA_PER_SECTOR;
    }
  } else if (isThisSectorASamSector(ctx, s)) {
    count += trainedMilitia(ctx, s);
    max += MAX_ALLOWABLE_MILITIA_PER_SECTOR;
  }
  return count >= max;
}

export function canNearbyMilitiaScoutThisSector(ctx: StrategicContext, s: Sector): boolean {
  const x0 = s.x > SCOUT_RANGE ? s.x - SCOUT_RANGE : 1;
  const y0 = s.y > SCOUT_RANGE ? s.y - SCOUT_RANGE : 1;
  const x1 = s.x < MAP_SIDE - SCOUT_RANGE ? s.x + SCOUT_RANGE : MAP_SIDE;
  const y1 = s.y < MAP_SIDE - SCOUT_RANGE ? s.y + SCOUT_RANGE : MAP_SIDE;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (countAllMilitiaInSector(ctx, { x, y }) !== 0) return true;
  return false;
}
