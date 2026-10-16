// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Mines.cc InitializeMines, HourlyMinesUpdate, ExtractOreFromMine,
// @src GetAvailableWorkForceForMineForPlayer/Enemy, GetCurrentWorkRateOfMineForPlayer/Enemy, MineAMine,
// @src PostEventsForMineProduction, HandleIncomeFromMines, PredictDailyIncomeFromAMine, PredictIncomeFromPlayerMines,
// @src CalcMaxPlayerIncomeFromMines, IssueHeadMinerQuote, GetHeadMinerIndexForMine, GetHeadMinersMineIndex,
// @src PlayerSpokeToHeadMiner, PlayerAttackedHeadMiner, HasAnyMineBeenAttackedByMonsters, AreThereMinersInsideThisMine;
// @src Strategic/StrategicMap.cc HandleQuestCodeOnSectorEntry (head miners); Tactical/Interface_Dialogue.cc
// @src NPC_ACTION_START_MINE. See docs/18 §3.

import { MineType } from '../../../content/strategic/economy-content.ts';
import { type Sector, sameSector, sectorFromId } from '../../../content/strategic/sector-ids.ts';
import { i32, idiv, u32 } from '../../../core/int.ts';
import { addTransaction, FinanceCode } from '../../campaign/finances.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent } from '../time/event-queue.ts';
import { CompressionStop, stopTimeCompression, worldDayInMinutes, worldTotalMinutes } from '../time/world-clock.ts';
import { FACT_MINERS_PLACED, HeadMinerQuote, OKLIFE } from './constants.ts';
import { decrementTownLoyalty } from './loyalty.ts';
import {
  addMineHistoryEvent,
  MINE_PRODUCTION_NUMBER_OF_PERIODS,
  MineHistory,
  maxDailyRemovalFromMine,
  mineDef,
  mineEntrance,
  mineIdForSector,
  mineStatus,
  playerControlsMine,
  restartMineProduction,
  shutOffMineProduction,
  townAssociatedWithMine,
} from './mine-status.ts';
import type { EconomyContext } from './ports.ts';
import { createMineStatus, type MineStatus } from './state.ts';
import { sectorsUnderControl, townSize } from './towns.ts';

const REMOVAL_RATE_INCREMENT = 250;
const MINE_PRODUCTION_START_TIME = 9 * 60;
const MINE_PRODUCTION_PERIOD = 3 * 60;
const MINE_PRODUCTION_DAYS_AFTER_HEAD_MINER_WARNING = 2.5;
const PRODUCTION_INCREASES_EASY_MEDIUM = 25;
const PRODUCTION_INCREASES_HARD = 20;
const PRODUCTION_INCREASE_DIVISOR = 5;
const DAYS_BEFORE_DELAYED_DEPLETION = 20;
const DAYS_BEFORE_DEPLETION = 10;
const UNLIMITED_ORE = 999999999;
const HARD_DIFFICULTY = 3;
const ROUND_UP = 0.9999;
const ORE_PER_RATE_UNIT = 10;
const FULL_WORKFORCE = 100;
const RANDOM_HEAD_MINERS = 4;
const PLACED = 0;
const ONE_DAY_MINUTES = 24 * 60;

export function initializeMines(ctx: EconomyContext): void {
  const defs = ctx.economy.mines;
  const status: MineStatus[] = defs.map((m) => {
    const s = createMineStatus();
    s.mineType = m.mineType;
    s.maxRemovalRate = m.minimumMineProduction;
    s.empty = s.maxRemovalRate === 0;
    return s;
  });
  ctx.state.economy.mines = status;
  let increases = ctx.state.options.difficulty >= HARD_DIFFICULTY ? PRODUCTION_INCREASES_HARD : PRODUCTION_INCREASES_EASY_MEDIUM;
  while (increases > 0) {
    let i: number;
    do i = ctx.random.int(defs.length);
    while (status[i]?.empty);
    const s = status[i] as MineStatus;
    s.maxRemovalRate = u32(s.maxRemovalRate + idiv(defs[i]?.minimumMineProduction ?? 0, PRODUCTION_INCREASE_DIVISOR));
    increases--;
  }
  let depleted: number;
  do depleted = ctx.random.int(defs.length);
  while (status[depleted]?.empty || defs[depleted]?.noDepletion);
  status.forEach((s, i) => {
    if (i === depleted) {
      const days = defs[i]?.delayDepletion ? DAYS_BEFORE_DELAYED_DEPLETION : DAYS_BEFORE_DEPLETION;
      s.remainingOreSupply = u32(days * MINE_PRODUCTION_NUMBER_OF_PERIODS * s.maxRemovalRate);
      s.oreRunningOutPoint = u32(
        Math.trunc(MINE_PRODUCTION_DAYS_AFTER_HEAD_MINER_WARNING * MINE_PRODUCTION_NUMBER_OF_PERIODS * s.maxRemovalRate),
      );
    } else if (!s.empty) {
      s.remainingOreSupply = UNLIMITED_ORE;
      s.oreRunningOutPoint = 0;
    } else {
      s.remainingOreSupply = 0;
      s.oreRunningOutPoint = 0;
    }
  });
}

export function workforceForPlayer(ctx: EconomyContext, mine: number): number {
  const m = mineStatus(ctx, mine);
  if (m.shutDown || !m.spokeToHeadMiner) return 0;
  const town = townAssociatedWithMine(ctx, mine);
  const rating = ctx.state.economy.towns[town]?.rating ?? 0;
  return idiv(rating * sectorsUnderControl(ctx, town), townSize(ctx, town));
}

export function workforceForEnemy(ctx: EconomyContext, mine: number): number {
  const m = mineStatus(ctx, mine);
  if (m.shutDown) return 0;
  const town = townAssociatedWithMine(ctx, mine);
  const size = townSize(ctx, town);
  const rating = ctx.state.economy.towns[town]?.rating ?? 0;
  return idiv((FULL_WORKFORCE - rating) * (size - sectorsUnderControl(ctx, town)), size);
}

export function workRate(ctx: EconomyContext, mine: number, workforce: number): number {
  return i32(idiv(u32(mineStatus(ctx, mine).maxRemovalRate * workforce), FULL_WORKFORCE));
}

export function runningOutRemovalRate(supply: number): number {
  return u32(
    Math.trunc(Math.fround(Math.fround(Math.fround(supply) / ORE_PER_RATE_UNIT) / REMOVAL_RATE_INCREMENT) + ROUND_UP) *
      REMOVAL_RATE_INCREMENT,
  );
}

export function issueHeadMinerQuote(ctx: EconomyContext, mine: number, kind: number): void {
  const town = townAssociatedWithMine(ctx, mine);
  const miner =
    ctx.economy.headMiners.headMiners.find((h) => ctx.hooks.headMinerTown(h.profile) === town) ?? ctx.economy.headMiners.headMiners[0];
  if (!miner || !ctx.hooks.headMinerAlive(miner.profile)) return;
  ctx.events.push({ type: 'headMinerQuote', mine, profile: miner.profile, quote: miner.quotes[kind] ?? -1 });
  stopTimeCompression(ctx.clock, CompressionStop.MINE_EVENT);
}

function extractOreFromMine(ctx: EconomyContext, mine: number, amount: number): number {
  const m = mineStatus(ctx, mine);
  if (m.shutDown || amount === 0) return 0;
  if (amount >= m.remainingOreSupply) {
    const extracted = m.remainingOreSupply;
    m.remainingOreSupply = 0;
    m.maxRemovalRate = 0;
    m.empty = true;
    m.runningOut = false;
    ctx.hooks.queenMineRanOut(mineEntrance(ctx, mine));
    addMineHistoryEvent(ctx, MineHistory.MINE_RAN_OUT, mine);
    ctx.events.push({ type: 'mineEmpty', mine });
    return extracted;
  }
  m.remainingOreSupply = u32(m.remainingOreSupply - amount);
  if (m.remainingOreSupply < m.oreRunningOutPoint) {
    m.runningOut = true;
    m.maxRemovalRate = runningOutRemovalRate(m.remainingOreSupply);
    if (playerControlsMine(ctx, mine) && !m.warnedOfRunningOut) {
      issueHeadMinerQuote(ctx, mine, HeadMinerQuote.RUNNING_OUT);
      m.warnedOfRunningOut = true;
      addMineHistoryEvent(ctx, MineHistory.MINE_RUNNING_OUT, mine);
      ctx.events.push({ type: 'mineRunningOut', mine });
    }
  }
  return amount;
}

export function mineAMine(ctx: EconomyContext, mine: number): number {
  const m = mineStatus(ctx, mine);
  if (m.empty || m.shutDown) return 0;
  if (playerControlsMine(ctx, mine)) {
    const extracted = extractOreFromMine(ctx, mine, workRate(ctx, mine, workforceForPlayer(ctx, mine)));
    if (extracted > 0 && !m.mineHasProducedForPlayer) {
      m.mineHasProducedForPlayer = true;
      m.timePlayerProductionStarted = worldTotalMinutes(ctx.state.clock);
    }
    return i32(extracted);
  }
  if (m.mineHasProducedForPlayer) extractOreFromMine(ctx, mine, workRate(ctx, mine, workforceForEnemy(ctx, mine)));
  return 0;
}

export function postEventsForMineProduction(ctx: EconomyContext): void {
  const day = worldDayInMinutes(ctx.state.clock);
  for (let shift = 0; shift < MINE_PRODUCTION_NUMBER_OF_PERIODS; shift++)
    addStrategicEvent(ctx.state.queue, EventKind.HANDLE_MINE_INCOME, day + MINE_PRODUCTION_START_TIME + shift * MINE_PRODUCTION_PERIOD, 0);
}

export function handleIncomeFromMines(ctx: EconomyContext): void {
  let income = 0;
  for (let mine = 0; mine < ctx.state.economy.mines.length; mine++) income = i32(income + mineAMine(ctx, mine));
  if (!income) return;
  const record = addTransaction(ctx.state.finances, FinanceCode.DEPOSIT_FROM_SILVER_MINE, 0, worldTotalMinutes(ctx.state.clock), income);
  ctx.events.push({ type: 'mineIncome', amount: income });
  ctx.events.push({ type: 'moneyChanged', code: record.code, amount: record.amount, balance: record.balanceAfter });
}

export function predictDailyIncomeFromAMine(ctx: EconomyContext, mine: number): number {
  if (!playerControlsMine(ctx, mine)) return 0;
  const amount = u32(MINE_PRODUCTION_NUMBER_OF_PERIODS * workRate(ctx, mine, workforceForPlayer(ctx, mine)));
  return Math.min(amount, mineStatus(ctx, mine).remainingOreSupply);
}

export function predictIncomeFromPlayerMines(ctx: EconomyContext): number {
  let total = 0;
  for (let mine = 0; mine < ctx.state.economy.mines.length; mine++) total = i32(total + predictDailyIncomeFromAMine(ctx, mine));
  return total;
}

export function calcMaxPlayerIncomeFromMines(ctx: EconomyContext): number {
  let total = 0;
  for (const m of ctx.state.economy.mines) total = i32(total + MINE_PRODUCTION_NUMBER_OF_PERIODS * m.maxRemovalRate);
  return total;
}

export function hourlyMinesUpdate(ctx: EconomyContext): void {
  ctx.state.economy.mines.forEach((m, mine) => {
    if (m.empty) return;
    if (ctx.hooks.mineClearOfMonsters(mine)) {
      if (m.shutDown && !m.shutDownIsPermanent) {
        if (playerControlsMine(ctx, mine)) issueHeadMinerQuote(ctx, mine, HeadMinerQuote.CREATURES_GONE);
        restartMineProduction(ctx, mine);
      }
      return;
    }
    if (m.shutDown) return;
    if (playerControlsMine(ctx, mine)) {
      let quote: number = HeadMinerQuote.CREATURES_AGAIN;
      if (!m.prevInvadedByMonsters) {
        quote = HeadMinerQuote.CREATURES_ATTACK;
        m.prevInvadedByMonsters = true;
        ctx.hooks.startCreatureQuest(mineEntrance(ctx, mine));
      }
      issueHeadMinerQuote(ctx, mine, quote);
    }
    shutOffMineProduction(ctx, mine);
  });
}

export function hasAnyMineBeenAttackedByMonsters(ctx: EconomyContext): boolean {
  return ctx.state.economy.mines.some((m, mine) => !ctx.hooks.mineClearOfMonsters(mine) || m.prevInvadedByMonsters);
}

export function areThereMinersInsideThisMine(ctx: EconomyContext, mine: number): boolean {
  return !mineStatus(ctx, mine).empty && ctx.hooks.mineClearOfMonsters(mine);
}

export function headMinersMineIndex(ctx: EconomyContext, profile: number): number {
  const town = ctx.hooks.headMinerTown(profile);
  return ctx.economy.mines.find((m) => m.associatedTownId === town)?.mineId ?? 0;
}

export function playerSpokeToHeadMiner(ctx: EconomyContext, profile: number): void {
  const mine = headMinersMineIndex(ctx, profile);
  const m = mineStatus(ctx, mine);
  if (m.spokeToHeadMiner) return;
  addMineHistoryEvent(ctx, MineHistory.TALKED_TO_MINER, mine);
  m.spokeToHeadMiner = true;
}

export function playerAttackedHeadMiner(ctx: EconomyContext, profile: number): void {
  const mine = headMinersMineIndex(ctx, profile);
  const m = mineStatus(ctx, mine);
  if (m.attackedHeadMiner) return;
  shutOffMineProduction(ctx, mine);
  m.shutDownIsPermanent = true;
  decrementTownLoyalty(ctx, townAssociatedWithMine(ctx, mine), ctx.economy.loyalty.amounts.PENALTY_HEAD_MINER_ATTACKED ?? 0);
  m.attackedHeadMiner = true;
}

export function resetQueenRetookMine(ctx: EconomyContext, profile: number): void {
  mineStatus(ctx, headMinersMineIndex(ctx, profile)).queenRetookProducingMine = false;
}

export function hasMineBeenProducingForPlayerForSomeTime(ctx: EconomyContext, mine: number): boolean {
  const m = mineStatus(ctx, mine);
  return m.mineHasProducedForPlayer && worldTotalMinutes(ctx.state.clock) - m.timePlayerProductionStarted >= ONE_DAY_MINUTES;
}

export function isAbandonedMine(ctx: EconomyContext, mine: number): boolean {
  return mineDef(ctx, mine).minimumMineProduction === 0;
}

export function placeHeadMinersOnSectorEntry(ctx: EconomyContext, sector: Sector): void {
  if (sector.z !== 0 || ctx.world.fact(FACT_MINERS_PLACED)) return;
  const thisMine = mineIdForSector(ctx, sector);
  if (thisMine === -1 || isAbandonedMine(ctx, thisMine)) return;
  const pool = [...ctx.economy.headMiners.randomMinerProfiles];
  const fred = ctx.economy.headMiners.headMiners[0];
  let placed = 0;
  if (!mineDef(ctx, thisMine).headMinerAssigned && fred) {
    ctx.hooks.placeHeadMiner(fred.profile, sector, townAssociatedWithMine(ctx, thisMine));
    pool[0] = PLACED;
    placed++;
  }
  for (const m of ctx.economy.mines) {
    if (m.mineId === thisMine || m.headMinerAssigned || m.minimumMineProduction === 0) continue;
    let pick: number;
    do pick = ctx.random.int(RANDOM_HEAD_MINERS);
    while (pool[pick] === PLACED);
    ctx.hooks.placeHeadMiner(pool[pick] ?? PLACED, sectorFromId(m.entranceSector), m.associatedTownId);
    pool[pick] = PLACED;
    placed++;
    if (placed === RANDOM_HEAD_MINERS) break;
  }
  ctx.hooks.setFact(FACT_MINERS_PLACED);
}

export type StartMineResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unknownMine' | 'abandoned' | 'noMercThere' | 'headMinerDead' };

export function startMineStandIn(ctx: EconomyContext, mine: number): StartMineResult {
  const def = ctx.economy.mines[mine];
  if (!def) return { ok: false, reason: 'unknownMine' };
  if (def.minimumMineProduction === 0) return { ok: false, reason: 'abandoned' };
  const entrance = mineEntrance(ctx, mine);
  const present = ctx.crew.all().some((m) => !m.betweenSectors && m.life >= OKLIFE && sameSector(m.sector, entrance));
  if (!present) return { ok: false, reason: 'noMercThere' };
  const miner = ctx.economy.headMiners.headMiners.find((h) => ctx.hooks.headMinerTown(h.profile) === def.associatedTownId);
  if (miner && !ctx.hooks.headMinerAlive(miner.profile)) return { ok: false, reason: 'headMinerDead' };
  const m = mineStatus(ctx, mine);
  if (!m.spokeToHeadMiner) addMineHistoryEvent(ctx, MineHistory.TALKED_TO_MINER, mine);
  m.spokeToHeadMiner = true;
  restartMineProduction(ctx, mine);
  return { ok: true };
}

export function mineProductionPercent(ctx: EconomyContext, mine: number): number {
  const max = maxDailyRemovalFromMine(ctx, mine);
  return max === 0 ? 0 : idiv(predictDailyIncomeFromAMine(ctx, mine) * 100, max);
}

export function isGoldMine(ctx: EconomyContext, mine: number): boolean {
  return mineDef(ctx, mine).mineType === MineType.GOLD;
}
