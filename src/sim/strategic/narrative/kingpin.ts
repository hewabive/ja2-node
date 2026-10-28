// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Event_Handler.cc CheckForKingpinsMoneyMissing and the FACT_KINGPIN_KNOWS_MONEY_GONE
// @src branch of HandleNPCSystemEvent.

import { u32 } from '../../../core/int.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { SectorPosition } from '../state.ts';
import { Fact } from './fact-ids.ts';
import { NarrativeHistory } from './history-codes.ts';

export const KINGPIN_MONEY_AMOUNT = 30000;
export const KINGPIN_DISCOVERY_SPREAD_MINUTES = 120;
const DAYS_TILL_KINGPIN_LOOKS = 1;
const DAYS_TILL_KINGPIN_ACTS = 2;

export interface KingpinMoneyContext {
  worldMoney(): number;
  removeAllWorldMoney(): void;
  checkFact(id: number): boolean;
  setFactTrue(id: number): void;
  history(code: number, sector: SectorPosition | null): void;
  worldSector(): SectorPosition | null;
  addFutureDayNpcEvent(minuteOfDay: number, param: number, days: number): void;
  random(n: number): number;
  kingpin(): ProfileProgress | null;
}

export function checkForKingpinsMoneyMissing(ctx: KingpinMoneyContext, firstCheck: boolean): void {
  const total = u32(ctx.worldMoney());
  if (firstCheck) {
    if (ctx.checkFact(Fact.KINGPIN_WILL_LEARN_OF_MONEY_GONE)) return;
    if (total < KINGPIN_MONEY_AMOUNT) {
      ctx.history(NarrativeHistory.FOUND_MONEY, ctx.worldSector());
      ctx.setFactTrue(Fact.KINGPIN_WILL_LEARN_OF_MONEY_GONE);
    }
  }
  if (ctx.checkFact(Fact.KINGPIN_DEAD)) return;
  if (total >= KINGPIN_MONEY_AMOUNT) return;
  if (firstCheck) {
    ctx.addFutureDayNpcEvent(ctx.random(KINGPIN_DISCOVERY_SPREAD_MINUTES), Fact.KINGPIN_KNOWS_MONEY_GONE, DAYS_TILL_KINGPIN_LOOKS);
    const kingpin = ctx.kingpin();
    if (kingpin) kingpin.balance = -(KINGPIN_MONEY_AMOUNT - total) | 0;
    ctx.removeAllWorldMoney();
    return;
  }
  ctx.setFactTrue(Fact.KINGPIN_KNOWS_MONEY_GONE);
  ctx.addFutureDayNpcEvent(ctx.random(KINGPIN_DISCOVERY_SPREAD_MINUTES), Fact.KINGPIN_KNOWS_MONEY_GONE, DAYS_TILL_KINGPIN_ACTS);
}
