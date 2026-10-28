// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Mines.cc GetTotalLeftInMine, GetMineIndexForSector, GetIdOfMineForSector,
// @src PlayerControlsMine, QueenHasRegainedMineSector, ShutOffMineProduction, RestartMineProduction, IsMineShutDown,
// @src GetMaxPeriodicRemovalFromMine, GetMaxDailyRemovalFromMine, GetTownAssociatedWithMine; DefaultContentManager.cc
// @src getMineForSector.

import type { MineDef } from '../../../content/strategic/economy-content.ts';
import { type Sector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { i32 } from '../../../core/int.ts';
import type { StrategicContext } from '../forces/ports.ts';
import type { EconomyContext } from './ports.ts';
import type { MineStatus } from './state.ts';

export const MINE_PRODUCTION_NUMBER_OF_PERIODS = 4;

export function mineDef(ctx: EconomyContext, mine: number): MineDef {
  const def = ctx.economy.mines[mine];
  if (!def) throw new RangeError(`no mine ${mine}`);
  return def;
}

export function mineStatus(ctx: EconomyContext, mine: number): MineStatus {
  const status = ctx.state.economy.mines[mine];
  if (!status) throw new RangeError(`no mine status ${mine}`);
  return status;
}

export function mineIdForSector(ctx: EconomyContext, s: Sector): number {
  const id = sectorId(s);
  for (const m of ctx.economy.mines) {
    if (s.z === 0 && id === m.entranceSector) return m.mineId;
    if (m.mineSectors.some((ms) => ms.sector === id && ms.z === s.z)) return m.mineId;
  }
  return -1;
}

export function mineIndexForSector(ctx: EconomyContext, sector: number): number {
  return mineIdForSector(ctx, sectorFromId(sector));
}

export function mineEntrance(ctx: EconomyContext, mine: number): Sector {
  return sectorFromId(mineDef(ctx, mine).entranceSector);
}

export function totalLeftInMine(ctx: EconomyContext, mine: number): number {
  return i32(mineStatus(ctx, mine).remainingOreSupply);
}

export function playerControlsMine(ctx: EconomyContext, mine: number): boolean {
  return !ctx.state.map.elements[strategicIndex(mineEntrance(ctx, mine))]?.enemyControlled && mineStatus(ctx, mine).spokeToHeadMiner;
}

export function queenHasRegainedMineSector(ctx: EconomyContext, mine: number): void {
  const m = mineStatus(ctx, mine);
  if (m.mineHasProducedForPlayer) m.queenRetookProducingMine = true;
}

export const MineHistory = { TALKED_TO_MINER: 17, MINE_RUNNING_OUT: 26, MINE_RAN_OUT: 27, MINE_SHUTDOWN: 28, MINE_REOPENED: 29 } as const;

export function addMineHistoryEvent(ctx: EconomyContext, code: number, mine: number): void {
  ctx.hooks.history(code, townAssociatedWithMine(ctx, mine), mineEntrance(ctx, mine));
}

export function shutOffMineProduction(ctx: EconomyContext, mine: number): void {
  const m = mineStatus(ctx, mine);
  if (m.shutDown) return;
  m.shutDown = true;
  addMineHistoryEvent(ctx, MineHistory.MINE_SHUTDOWN, mine);
  ctx.events.push({ type: 'mineShutDown', mine });
}

export function restartMineProduction(ctx: EconomyContext, mine: number): void {
  const m = mineStatus(ctx, mine);
  if (m.shutDownIsPermanent || !m.shutDown) return;
  m.shutDown = false;
  addMineHistoryEvent(ctx, MineHistory.MINE_REOPENED, mine);
  ctx.events.push({ type: 'mineReopened', mine });
}

export function maxPeriodicRemovalFromMine(ctx: EconomyContext, mine: number): number {
  const m = mineStatus(ctx, mine);
  return m.shutDown ? 0 : m.maxRemovalRate;
}

export function maxDailyRemovalFromMine(ctx: EconomyContext, mine: number): number {
  const m = mineStatus(ctx, mine);
  if (m.shutDown) return 0;
  return Math.min(MINE_PRODUCTION_NUMBER_OF_PERIODS * m.maxRemovalRate, m.remainingOreSupply);
}

export function townAssociatedWithMine(ctx: EconomyContext, mine: number): number {
  return mineDef(ctx, mine).associatedTownId;
}

export function mineSectorForTown(ctx: StrategicContext & Pick<EconomyContext, 'economy'>, town: number): number {
  const m = ctx.economy.mines.find((def) => def.associatedTownId === town);
  return m ? strategicIndex(sectorFromId(m.entranceSector)) : -1;
}
