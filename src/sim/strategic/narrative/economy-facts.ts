// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc CheckFact (the inputs it reads from the strategic layer: gTownLoyalty, gfTownUsesLoyalty,
// @src GetNumberOfWholeTownsUnderControl, IsTownUnderCompleteControlByPlayer, the head miner and mine helpers of
// @src Strategic_Mines.cc, StrategicMap fEnemyControlled, SectorInfo bBloodCats, NumEnemiesInAnySector).

import { strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { mineIdForSector } from '../economy/mine-status.ts';
import {
  hasHisMineBeenProducingForPlayerForSomeTime,
  isHisMineAtMaxProduction,
  isHisMineDisloyal,
  isHisMineEmpty,
  isHisMineInfested,
  isHisMineLostAndRegained,
  isHisMineRunningOut,
  predictDailyIncomeFromAMine,
  spokenToHeadMiner,
} from '../economy/mines.ts';
import type { EconomyContext } from '../economy/ports.ts';
import { isTownUnderCompleteControl, numberOfWholeTownsUnderControl } from '../economy/towns.ts';
import { SectorFlag } from '../forces/constants.ts';
import { numEnemiesInAnySector } from '../forces/groups.ts';
import { townIdOfSector } from '../map/control.ts';
import { getSectorFlagStatus, sectorInfo } from '../map/sectors.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import {
  type FactCampaign,
  type FactContext,
  type FactMines,
  type FactTowns,
  NO_FACT_BOXING,
  NO_FACT_DIALOGUE,
  NO_FACT_ITEMS,
  NO_FACT_REPAIRS,
  NO_FACT_WORLD,
  NO_TALK,
} from './check-fact.ts';
import { civGroupHostility } from './civ-groups.ts';

export function economyFactCampaign(ctx: EconomyContext, overrides: Partial<FactCampaign> = {}): FactCampaign {
  const s = ctx.state;
  return {
    sciFi: s.options.sciFi,
    now: () => worldTotalMinutes(s.clock),
    profile: (id) => s.profiles.get(id) ?? null,
    civGroupHostility: (group) => civGroupHostility(s.civGroups, group),
    currentProgress: () => 0,
    sectorEnemyControlled: (sector) => s.map.elements[strategicIndex(sector)]?.enemyControlled ?? true,
    sectorVisited: (sector) => getSectorFlagStatus(s.map, sector, SectorFlag.ALREADY_VISITED),
    bloodCats: (sector) => sectorInfo(s.map, sector).bloodCats,
    numEnemiesInAnySector: (sector) => numEnemiesInAnySector(ctx, sector),
    bobbyRayOrdersInTransit: () => 0,
    primaryDelivery: () => null,
    timeQuestWasStarted: () => 0,
    skyriderTalkState: () => 0,
    lastSkyriderMonologue: () => 0,
    ...overrides,
  };
}

export function economyFactTowns(ctx: EconomyContext): FactTowns {
  return {
    loyalty: (town) => {
      const t = ctx.state.economy.towns[town];
      return { rating: t?.rating ?? 0, started: t?.started ?? false, usesLoyalty: ctx.economy.loyalty.usesLoyalty[town] ?? false };
    },
    townIdOfSector: (sector) => townIdOfSector(ctx, { x: sector.x, y: sector.y, z: 0 }),
    wholeTownsUnderControl: () => numberOfWholeTownsUnderControl(ctx),
    townUnderCompleteControl: (town) => isTownUnderCompleteControl(ctx, town),
  };
}

export function economyFactMines(ctx: EconomyContext): FactMines {
  const any = ctx.economy.mines.length > 0;
  return {
    empty: (p) => any && isHisMineEmpty(ctx, p),
    runningOut: (p) => any && isHisMineRunningOut(ctx, p),
    producingForSomeTime: (p) => any && hasHisMineBeenProducingForPlayerForSomeTime(ctx, p),
    disloyal: (p) => any && isHisMineDisloyal(ctx, p),
    infested: (p) => any && isHisMineInfested(ctx, p),
    lostAndRegained: (p) => any && isHisMineLostAndRegained(ctx, p),
    atMaxProduction: (p) => any && isHisMineAtMaxProduction(ctx, p),
    predictedDailyIncome: (mine) => (mine < ctx.economy.mines.length ? predictDailyIncomeFromAMine(ctx, mine) : 0),
    spokenToHeadMiner: (mine) => mine < ctx.state.economy.mines.length && spokenToHeadMiner(ctx, mine),
    mineIdOfSector: (sector) => mineIdForSector(ctx, sector),
  };
}

export function economyFactContext(ctx: EconomyContext, overrides: Partial<FactContext> = {}): FactContext {
  return {
    narrative: ctx.state.narrative,
    campaign: economyFactCampaign(ctx),
    towns: economyFactTowns(ctx),
    mines: economyFactMines(ctx),
    world: NO_FACT_WORLD,
    talk: NO_TALK,
    boxing: NO_FACT_BOXING,
    repairs: NO_FACT_REPAIRS,
    dialogue: NO_FACT_DIALOGUE,
    items: NO_FACT_ITEMS,
    ...overrides,
  };
}
