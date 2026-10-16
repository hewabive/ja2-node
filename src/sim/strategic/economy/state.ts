// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Town_Loyalty.h TOWN_LOYALTY; Strategic_Mines.h MINE_STATUS_TYPE;
// @src Town_Militia.cc promotion counters. See docs/18 §0.

import { NUM_TOWNS } from './constants.ts';

export interface TownLoyalty {
  rating: number;
  change: number;
  started: boolean;
  liberatedAlready: boolean;
}

export interface MineStatus {
  mineType: number;
  maxRemovalRate: number;
  remainingOreSupply: number;
  oreRunningOutPoint: number;
  empty: boolean;
  runningOut: boolean;
  warnedOfRunningOut: boolean;
  shutDownIsPermanent: boolean;
  shutDown: boolean;
  prevInvadedByMonsters: boolean;
  spokeToHeadMiner: boolean;
  mineHasProducedForPlayer: boolean;
  queenRetookProducingMine: boolean;
  attackedHeadMiner: boolean;
  timePlayerProductionStarted: number;
}

export interface MilitiaPromotions {
  total: number;
  greenToElite: number;
  greenToRegular: number;
  regularToElite: number;
}

export interface MilitiaPaymentPrompt {
  readonly kind: 'militiaPayment';
  readonly trainer: number;
  readonly leader: number;
  readonly soldiers: readonly number[];
  readonly sectors: readonly number[];
  readonly cost: number;
  readonly balance: number;
}

export interface MilitiaContinuePrompt {
  readonly kind: 'militiaContinue';
  readonly trainer: number;
  readonly sector: number;
  readonly cost: number;
}

export type EconomyPrompt = MilitiaPaymentPrompt | MilitiaContinuePrompt;

export interface EconomyState {
  towns: TownLoyalty[];
  firstBattleSector: number;
  mines: MineStatus[];
  militiaPromotions: MilitiaPromotions;
  strategicMilitiaChangesMade: boolean;
  militiaTrainingCompletedBy: number[];
  prompts: EconomyPrompt[];
}

export function createTownLoyalty(): TownLoyalty {
  return { rating: 0, change: 0, started: false, liberatedAlready: false };
}

export function createMineStatus(): MineStatus {
  return {
    mineType: 0,
    maxRemovalRate: 0,
    remainingOreSupply: 0,
    oreRunningOutPoint: 0,
    empty: false,
    runningOut: false,
    warnedOfRunningOut: false,
    shutDownIsPermanent: false,
    shutDown: false,
    prevInvadedByMonsters: false,
    spokeToHeadMiner: false,
    mineHasProducedForPlayer: false,
    queenRetookProducingMine: false,
    attackedHeadMiner: false,
    timePlayerProductionStarted: 0,
  };
}

export function createMilitiaPromotions(): MilitiaPromotions {
  return { total: 0, greenToElite: 0, greenToRegular: 0, regularToElite: 0 };
}

export function createEconomyState(): EconomyState {
  return {
    towns: Array.from({ length: NUM_TOWNS }, createTownLoyalty),
    firstBattleSector: 0,
    mines: [],
    militiaPromotions: createMilitiaPromotions(),
    strategicMilitiaChangesMade: false,
    militiaTrainingCompletedBy: [],
    prompts: [],
  };
}
