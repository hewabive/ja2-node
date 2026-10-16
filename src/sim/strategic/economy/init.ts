// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Init.cc InitStrategicLayer (InitTownLoyalty, InitializeMines), InitNewGame (starting cash).
// See docs/15 §4.2–§4.3, docs/18 §3.2.

import { addTransaction, createFinanceState, FinanceCode } from '../../campaign/finances.ts';
import { initTownLoyalty } from './loyalty.ts';
import { initializeMines } from './mines.ts';
import type { EconomyContext } from './ports.ts';

const NEW_GAME_LEDGER_MINUTE = 1500;

export function initEconomyStrategicLayer(ctx: EconomyContext): void {
  initTownLoyalty(ctx);
  initializeMines(ctx);
}

export function addStartingCash(ctx: EconomyContext, minute = NEW_GAME_LEDGER_MINUTE): void {
  const f = ctx.state.finances;
  Object.assign(f, createFinanceState());
  const cash = ctx.economy.policy.startingCash[ctx.state.options.difficulty - 1] ?? 0;
  addTransaction(f, FinanceCode.ANONYMOUS_DEPOSIT, 0, minute, cash);
}
