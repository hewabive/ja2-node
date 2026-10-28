// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Finances.cc DrawSummaryText (the figures), GetPreviousDaysBalance, GetTodaysBalance,
// @src GetPreviousDaysIncome, GetTodaysDaysIncome, GetTodaysOtherDeposits, GetYesterdaysOtherDeposits, GetTodaysDebits,
// @src GetYesterdaysDebits, GetProjectedTotalDailyIncome. The ledger is walked from the newest record backwards and the
// @src day arithmetic is UINT32, as in the original.

import { i32, u32 } from '../../core/int.ts';
import { FinanceCode, type FinanceRecord } from './finances.ts';

const MINUTES_PER_DAY = 24 * 60;

export interface FinanceDayFigures {
  readonly income: number;
  readonly otherDeposits: number;
  readonly debits: number;
}

export interface FinanceSummary {
  readonly yesterday: FinanceDayFigures & { readonly closingBalance: number };
  readonly today: FinanceDayFigures & { readonly balance: number };
  readonly projectedIncome: number;
  readonly projectedBalance: number;
}

function dayOf(record: FinanceRecord): number {
  return Math.trunc(u32(record.minute) / MINUTES_PER_DAY);
}

function dayNumber(minutes: number): number {
  return Math.trunc(u32(minutes) / MINUTES_PER_DAY);
}

function isMineDeposit(record: FinanceRecord): boolean {
  return record.code === FinanceCode.DEPOSIT_FROM_GOLD_MINE || record.code === FinanceCode.DEPOSIT_FROM_SILVER_MINE;
}

function isOtherDeposit(record: FinanceRecord): boolean {
  return !isMineDeposit(record) && record.amount > 0;
}

function newestFirst(ledger: readonly FinanceRecord[]): FinanceRecord[] {
  return [...ledger].reverse();
}

export function previousDaysBalance(ledger: readonly FinanceRecord[], now: number): number {
  const days = dayNumber(now - MINUTES_PER_DAY);
  if (days < 2) return 0;
  const target = days - 2;
  for (const record of newestFirst(ledger)) {
    const day = dayOf(record);
    if (day === target) return record.balanceAfter;
    if (day < target) break;
  }
  return 0;
}

export function todaysBalance(ledger: readonly FinanceRecord[], now: number): number {
  const yesterday = u32(dayNumber(now) - 1);
  for (const record of newestFirst(ledger)) if (dayOf(record) === yesterday) return record.balanceAfter;
  return 0;
}

function yesterdaysSum(ledger: readonly FinanceRecord[], now: number, counts: (record: FinanceRecord) => boolean): number {
  const days = dayNumber(now);
  const yesterday = u32(days - 1);
  const twoDaysAgo = u32(days - 2);
  let total = 0;
  let okToIncrement = false;
  for (const record of newestFirst(ledger)) {
    const day = dayOf(record);
    if (day === yesterday) okToIncrement = true;
    if (okToIncrement && counts(record)) total = i32(total + record.amount);
    if (day <= twoDaysAgo) break;
  }
  return total;
}

function todaysSum(ledger: readonly FinanceRecord[], now: number, counts: (record: FinanceRecord) => boolean): number {
  const yesterday = u32(dayNumber(now) - 1);
  let total = 0;
  let okToIncrement = false;
  for (const record of newestFirst(ledger)) {
    const day = dayOf(record);
    if (day > yesterday) okToIncrement = true;
    if (okToIncrement && counts(record)) {
      total = i32(total + record.amount);
      okToIncrement = false;
    }
    if (day === yesterday) break;
  }
  return total;
}

export function previousDaysIncome(ledger: readonly FinanceRecord[], now: number): number {
  return yesterdaysSum(ledger, now, isMineDeposit);
}

export function yesterdaysOtherDeposits(ledger: readonly FinanceRecord[], now: number): number {
  return yesterdaysSum(ledger, now, isOtherDeposit);
}

export function todaysIncome(ledger: readonly FinanceRecord[], now: number): number {
  return todaysSum(ledger, now, isMineDeposit);
}

export function todaysOtherDeposits(ledger: readonly FinanceRecord[], now: number): number {
  return todaysSum(ledger, now, isOtherDeposit);
}

export function financeSummary(ledger: readonly FinanceRecord[], now: number, balance: number, projectedIncome: number): FinanceSummary {
  const closing = todaysBalance(ledger, now);
  const yesterday = {
    income: previousDaysIncome(ledger, now),
    otherDeposits: yesterdaysOtherDeposits(ledger, now),
  };
  const today = { income: todaysIncome(ledger, now), otherDeposits: todaysOtherDeposits(ledger, now) };
  return {
    yesterday: {
      ...yesterday,
      debits: i32(closing - previousDaysBalance(ledger, now) - yesterday.income - yesterday.otherDeposits),
      closingBalance: closing,
    },
    today: { ...today, debits: i32(balance - closing - today.income - today.otherDeposits), balance },
    projectedIncome,
    projectedBalance: i32(balance + projectedIncome),
  };
}
