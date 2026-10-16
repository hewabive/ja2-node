// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Merc_Handler.cc MercDailyUpdate (the RPC salary), NUM_DAYS_TILL_UNPAID_RPC_QUITS,
// @src RPCWhineAboutNoPay. See docs/22 §4.8.

import { i32 } from '../../../core/int.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import { addSameDayStrategicEvent } from '../../strategic/time/event-queue.ts';
import { worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { ContractContext } from './context.ts';
import { MERC_ARRIVE_TIME_SLOTS } from './contract-times.ts';
import { mercsContractIsFinished } from './merc-account.ts';

const NUM_DAYS_TILL_UNPAID_RPC_QUITS = 3;

export function rpcDailyPay(ctx: ContractContext, m: RosterMerc, p: ProfileProgress): void {
  const s = ctx.state;
  const salary = p.salary;
  const owed = salary + (p.balance < 0 ? -p.balance : 0);
  if (owed === 0) return;
  if (s.finances.balance >= owed) {
    addTransaction(s.finances, FinanceCode.PAYMENT_TO_NPC, m.profile, worldTotalMinutes(s.clock), -owed);
    if (p.balance < 0) p.balance = 0;
    return;
  }
  ctx.emit({ type: 'rpcUnpaid', soldier: m.id, amount: salary });
  if (p.balance - salary <= -(salary * NUM_DAYS_TILL_UNPAID_RPC_QUITS)) {
    mercsContractIsFinished(ctx, m);
    return;
  }
  p.balance = i32(p.balance - salary);
  addSameDayStrategicEvent(s.queue, s.clock, EventKind.RPC_WHINE_ABOUT_PAY, MERC_ARRIVE_TIME_SLOTS[0], m.id);
}

export function rpcWhineAboutNoPay(ctx: ContractContext, soldierId: number): void {
  const m = ctx.roster.get(soldierId);
  if (m && m.kind === MercKind.NPC) ctx.say(m, 'NOT_GETTING_PAID');
}
