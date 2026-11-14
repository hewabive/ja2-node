// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc HandleMilitiaRedistributionClick (the refusals before the militia panel opens);
// @src Map_Screen_Interface_Map.cc PickUpATownPersonFromSector, DropAPersonInASector (their rules checked on the final
// @src state of a whole redistribution, 2026-11-14), HandleEveningOutOfTroopsAmongstSectors
// @src (the AUTO button, with its quirk: militia counted in sectors with hostiles are not dealt back),
// @src CanMilitiaAutoDistribute, CanRedistributeMilitiaInSector, GetBaseSectorForCurrentTown;
// @src Strategic/StrategicMap_Secrets.cc IsTownFound; externalized/strategic/TownModel.cc getBaseSector.

import type { Town as TownContent } from '../../../content/strategic/map-tables.ts';
import { MAP_SIDE, type Sector, sameSector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { idiv } from '../../../core/int.ts';
import { numHostilesInSector } from '../forces/groups.ts';
import { isSecretFoundAt, isThisSectorASamSector } from '../map/control.ts';
import { sectorInfo } from '../map/sectors.ts';
import { MAX_ALLOWABLE_MILITIA_PER_SECTOR, MAX_MILITIA_LEVELS, Town } from './constants.ts';
import { countAllMilitiaInSector, militiaTrainingAllowedInSector, militiaTrainingAllowedInTown } from './militia-rules.ts';
import type { EconomyContext } from './ports.ts';
import { sectorOursAndPeaceful, sectorsOfTown, sectorsUnderControl, townOf } from './towns.ts';

export const MilitiaMoveRefusal = {
  BAD_RANK: 'badRank',
  BAD_COUNT: 'badCount',
  BAD_TOWN: 'badTown',
  UNDERGROUND: 'underground',
  NOT_A_TOWN: 'notATown',
  SAM_SITE: 'samSite',
  NO_MILITIA_ALLOWED: 'noMilitiaAllowed',
  COMBAT: 'militiaInCombat',
  OTHER_TOWN: 'otherTown',
  NOT_PEACEFUL: 'sectorNotPeaceful',
  NOT_ENOUGH: 'notEnoughMilitia',
  SECTOR_FULL: 'sectorFull',
  NO_MILITIA: 'noMilitia',
  TOTALS_CHANGED: 'militiaTotalsChanged',
  LISTED_TWICE: 'sectorListedTwice',
} as const;
export type MilitiaMoveRefusal = (typeof MilitiaMoveRefusal)[keyof typeof MilitiaMoveRefusal];

export const MILITIA_RANKS: readonly string[] = ['green', 'regular', 'elite'];

const BOX_ROWS = 3;
const BOX_CELLS = BOX_ROWS * BOX_ROWS;
const RANK_INDICES: readonly number[] = Array.from({ length: MAX_MILITIA_LEVELS }, (_, rank) => rank);

export type MilitiaMoveResult = { readonly ok: true } | { readonly ok: false; readonly refusal: MilitiaMoveRefusal };

const refused = (refusal: MilitiaMoveRefusal): MilitiaMoveResult => ({ ok: false, refusal });
const OK: MilitiaMoveResult = { ok: true };

function townContent(ctx: EconomyContext, town: number): TownContent | undefined {
  return ctx.content.towns.find((t) => t.townId === town);
}

export function isTownFound(ctx: EconomyContext, town: number): boolean {
  const content = townContent(ctx, town);
  if (!content || content.sectors.length === 0) return false;
  return isSecretFoundAt(ctx, Math.min(...content.sectors));
}

function boxSectors(ctx: EconomyContext, town: number): Sector[] {
  const base = townContent(ctx, town)?.militiaMapBaseSector ?? 0;
  return Array.from({ length: BOX_CELLS }, (_, i) => sectorFromId(base + (i % BOX_ROWS) + idiv(i, BOX_ROWS) * MAP_SIDE));
}

export function canRedistributeMilitiaInTown(ctx: EconomyContext, town: number): boolean {
  const world = ctx.state.worldSector;
  if (!world) return true;
  if (!ctx.clock.inCombat() && !ctx.world.enemyInSector()) return true;
  if (world.z !== 0) return true;
  return !boxSectors(ctx, town).some((s) => townOf(ctx, s) === town && sameSector(s, world));
}

export function militiaPanelRefusal(ctx: EconomyContext, s: Sector): MilitiaMoveRefusal | null {
  if (s.z !== 0) return MilitiaMoveRefusal.UNDERGROUND;
  const town = townOf(ctx, s);
  if (town === Town.BLANK || !isTownFound(ctx, town))
    return isThisSectorASamSector(ctx, s) && isSecretFoundAt(ctx, sectorId(s))
      ? MilitiaMoveRefusal.SAM_SITE
      : MilitiaMoveRefusal.NOT_A_TOWN;
  if (!militiaTrainingAllowedInSector(ctx, s)) return MilitiaMoveRefusal.NO_MILITIA_ALLOWED;
  return canRedistributeMilitiaInTown(ctx, town) ? null : MilitiaMoveRefusal.COMBAT;
}

function markLoadedSectorChanged(ctx: EconomyContext, sectors: readonly Sector[]): void {
  const world = ctx.state.worldSector;
  if (world && sectors.some((s) => sameSector(s, world))) ctx.state.economy.strategicMilitiaChangesMade = true;
}

export function moveMilitia(ctx: EconomyContext, from: Sector, to: Sector, rank: number, count: number): MilitiaMoveResult {
  if (!Number.isInteger(rank) || rank < 0 || rank >= MAX_MILITIA_LEVELS) return refused(MilitiaMoveRefusal.BAD_RANK);
  if (!Number.isInteger(count) || count < 1) return refused(MilitiaMoveRefusal.BAD_COUNT);
  const panel = militiaPanelRefusal(ctx, from);
  if (panel) return refused(panel);
  if (to.z !== 0 || townOf(ctx, to) !== townOf(ctx, from)) return refused(MilitiaMoveRefusal.OTHER_TOWN);
  if (!sectorOursAndPeaceful(ctx, from) || !sectorOursAndPeaceful(ctx, to)) return refused(MilitiaMoveRefusal.NOT_PEACEFUL);
  const source = sectorInfo(ctx.state.map, from).militia;
  if ((source[rank] ?? 0) < count) return refused(MilitiaMoveRefusal.NOT_ENOUGH);
  if (sameSector(from, to)) return OK;
  if (countAllMilitiaInSector(ctx, to) + count > MAX_ALLOWABLE_MILITIA_PER_SECTOR) return refused(MilitiaMoveRefusal.SECTOR_FULL);
  const target = sectorInfo(ctx.state.map, to).militia;
  source[rank] = (source[rank] ?? 0) - count;
  target[rank] = (target[rank] ?? 0) + count;
  markLoadedSectorChanged(ctx, [from, to]);
  return OK;
}

function enemyControlled(ctx: EconomyContext, s: Sector): boolean {
  return ctx.state.map.elements[strategicIndex(s)]?.enemyControlled === true;
}

export function canMilitiaAutoDistribute(ctx: EconomyContext, town: number): boolean {
  if (town === Town.BLANK) return false;
  return sectorsOfTown(ctx, town).some((t) => {
    const s = sectorFromId(t.sector);
    return !enemyControlled(ctx, s) && countAllMilitiaInSector(ctx, s) !== 0;
  });
}

function townPanelRefusal(ctx: EconomyContext, town: number): MilitiaMoveRefusal | null {
  if (!Number.isInteger(town) || !townContent(ctx, town) || town === Town.BLANK) return MilitiaMoveRefusal.BAD_TOWN;
  if (!isTownFound(ctx, town)) return MilitiaMoveRefusal.NOT_A_TOWN;
  if (!militiaTrainingAllowedInTown(ctx, town)) return MilitiaMoveRefusal.NO_MILITIA_ALLOWED;
  return canRedistributeMilitiaInTown(ctx, town) ? null : MilitiaMoveRefusal.COMBAT;
}

function distributeRefusal(ctx: EconomyContext, town: number): MilitiaMoveRefusal | null {
  const panel = townPanelRefusal(ctx, town);
  if (panel) return panel;
  return canMilitiaAutoDistribute(ctx, town) ? null : MilitiaMoveRefusal.NO_MILITIA;
}

function sumOverBox(ctx: EconomyContext, town: number): number[] {
  const totals = new Array<number>(MAX_MILITIA_LEVELS).fill(0);
  for (const s of boxSectors(ctx, town)) {
    if (townOf(ctx, s) !== town || enemyControlled(ctx, s)) continue;
    const militia = sectorInfo(ctx.state.map, s).militia;
    for (let rank = 0; rank < MAX_MILITIA_LEVELS; rank++) totals[rank] = (totals[rank] ?? 0) + (militia[rank] ?? 0);
  }
  return totals;
}

export function distributeMilitia(ctx: EconomyContext, town: number): MilitiaMoveResult {
  const refusal = distributeRefusal(ctx, town);
  if (refusal) return refused(refusal);
  const controlled = sectorsUnderControl(ctx, town);
  if (controlled === 0) return OK;
  const totals = sumOverBox(ctx, town);
  if (totals.every((n) => n === 0)) return OK;
  const perSector = totals.map((n) => idiv(n, controlled));
  const leftOver = totals.map((n) => n % controlled);
  const changed: Sector[] = [];
  for (const t of sectorsOfTown(ctx, town)) {
    const s = sectorFromId(t.sector);
    if (enemyControlled(ctx, s) || numHostilesInSector(ctx, s) !== 0) continue;
    const militia = sectorInfo(ctx.state.map, s).militia;
    let total = 0;
    for (let rank = 0; rank < MAX_MILITIA_LEVELS; rank++) {
      militia[rank] = perSector[rank] ?? 0;
      total += militia[rank] ?? 0;
    }
    for (let rank = 0; rank < MAX_MILITIA_LEVELS; rank++) {
      if ((leftOver[rank] ?? 0) === 0 || total >= MAX_ALLOWABLE_MILITIA_PER_SECTOR) continue;
      militia[rank] = (militia[rank] ?? 0) + 1;
      total++;
      leftOver[rank] = (leftOver[rank] ?? 0) - 1;
    }
    changed.push(s);
  }
  markLoadedSectorChanged(ctx, changed);
  return OK;
}

export interface MilitiaPlanEntry {
  readonly sector: Sector;
  readonly militia: readonly number[];
}

function currentMilitia(ctx: EconomyContext, entry: MilitiaPlanEntry): number[] {
  return sectorInfo(ctx.state.map, entry.sector).militia;
}

function changesSector(ctx: EconomyContext, entry: MilitiaPlanEntry): boolean {
  const current = currentMilitia(ctx, entry);
  return RANK_INDICES.some((rank) => (entry.militia[rank] ?? 0) !== (current[rank] ?? 0));
}

function onlyLoses(current: readonly number[], planned: readonly number[]): boolean {
  return RANK_INDICES.every((rank) => (planned[rank] ?? 0) <= (current[rank] ?? 0));
}

function overfills(ctx: EconomyContext, entry: MilitiaPlanEntry): boolean {
  const planned = entry.militia.reduce((sum, n) => sum + n, 0);
  return planned > MAX_ALLOWABLE_MILITIA_PER_SECTOR && !onlyLoses(currentMilitia(ctx, entry), entry.militia);
}

function keepsTotals(ctx: EconomyContext, plan: readonly MilitiaPlanEntry[]): boolean {
  return RANK_INDICES.every((rank) => {
    const before = plan.reduce((sum, e) => sum + (currentMilitia(ctx, e)[rank] ?? 0), 0);
    const after = plan.reduce((sum, e) => sum + (e.militia[rank] ?? 0), 0);
    return before === after;
  });
}

function listsSectorTwice(plan: readonly MilitiaPlanEntry[]): boolean {
  return plan.some((e, i) => plan.findIndex((other) => sameSector(other.sector, e.sector)) !== i);
}

function redistributeRefusal(ctx: EconomyContext, town: number, plan: readonly MilitiaPlanEntry[]): MilitiaMoveRefusal | null {
  const panel = townPanelRefusal(ctx, town);
  if (panel) return panel;
  if (listsSectorTwice(plan)) return MilitiaMoveRefusal.LISTED_TWICE;
  if (plan.some((e) => e.sector.z !== 0 || townOf(ctx, e.sector) !== town)) return MilitiaMoveRefusal.OTHER_TOWN;
  const changed = plan.filter((e) => changesSector(ctx, e));
  if (changed.some((e) => !sectorOursAndPeaceful(ctx, e.sector))) return MilitiaMoveRefusal.NOT_PEACEFUL;
  if (!keepsTotals(ctx, changed)) return MilitiaMoveRefusal.TOTALS_CHANGED;
  return changed.some((e) => overfills(ctx, e)) ? MilitiaMoveRefusal.SECTOR_FULL : null;
}

export function redistributeMilitia(ctx: EconomyContext, town: number, plan: readonly MilitiaPlanEntry[]): MilitiaMoveResult {
  const refusal = redistributeRefusal(ctx, town, plan);
  if (refusal) return refused(refusal);
  const changed = plan.filter((e) => changesSector(ctx, e));
  for (const entry of changed) {
    const militia = currentMilitia(ctx, entry);
    for (const rank of RANK_INDICES) militia[rank] = entry.militia[rank] ?? 0;
  }
  markLoadedSectorChanged(
    ctx,
    changed.map((e) => e.sector),
  );
  return OK;
}
