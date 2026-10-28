// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Finances.cc AddTransactionToPlayersBook, GetCurrentBalance, ProcessAndEnterAFinancialRecord;
// @src Laptop/Finances.h transaction codes.

import { i32, u8, u32 } from '../../core/int.ts';

export const FinanceCode = {
  ACCRUED_INTEREST: 0,
  ANONYMOUS_DEPOSIT: 1,
  TRANSACTION_FEE: 2,
  HIRED_MERC: 3,
  BOBBYR_PURCHASE: 4,
  PAY_SPECK_FOR_MERC: 5,
  MEDICAL_DEPOSIT: 6,
  IMP_PROFILE: 7,
  PURCHASED_INSURANCE: 8,
  REDUCED_INSURANCE: 9,
  EXTENDED_INSURANCE: 10,
  CANCELLED_INSURANCE: 11,
  INSURANCE_PAYOUT: 12,
  EXTENDED_CONTRACT_BY_1_DAY: 13,
  EXTENDED_CONTRACT_BY_1_WEEK: 14,
  EXTENDED_CONTRACT_BY_2_WEEKS: 15,
  DEPOSIT_FROM_GOLD_MINE: 16,
  DEPOSIT_FROM_SILVER_MINE: 17,
  PURCHASED_FLOWERS: 18,
  FULL_MEDICAL_REFUND: 19,
  PARTIAL_MEDICAL_REFUND: 20,
  NO_MEDICAL_REFUND: 21,
  PAYMENT_TO_NPC: 22,
  TRANSFER_FUNDS_TO_MERC: 23,
  TRANSFER_FUNDS_FROM_MERC: 24,
  TRAIN_TOWN_MILITIA: 25,
  PURCHASED_ITEM_FROM_DEALER: 26,
  MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT: 27,
} as const;

const PROFILE_COST_CODES: ReadonlySet<number> = new Set([
  FinanceCode.HIRED_MERC,
  FinanceCode.IMP_PROFILE,
  FinanceCode.PAYMENT_TO_NPC,
  FinanceCode.EXTENDED_CONTRACT_BY_1_DAY,
  FinanceCode.EXTENDED_CONTRACT_BY_1_WEEK,
  FinanceCode.EXTENDED_CONTRACT_BY_2_WEEKS,
]);

export interface FinanceRecord {
  readonly code: number;
  readonly secondCode: number;
  readonly minute: number;
  readonly amount: number;
  readonly balanceAfter: number;
}

export interface FinanceState {
  balance: number;
  ledger: FinanceRecord[];
  readonly profileCostToDate: Map<number, number>;
}

export function createFinanceState(balance = 0): FinanceState {
  return { balance: i32(balance), ledger: [], profileCostToDate: new Map() };
}

export function addTransaction(f: FinanceState, code: number, secondCode: number, minute: number, amount: number): FinanceRecord {
  if (PROFILE_COST_CODES.has(code)) {
    const profile = u8(secondCode);
    f.profileCostToDate.set(profile, u32((f.profileCostToDate.get(profile) ?? 0) - amount));
  }
  f.balance = i32(f.balance + amount);
  const record: FinanceRecord = {
    code: u8(code),
    secondCode: u8(secondCode),
    minute: u32(minute),
    amount: i32(amount),
    balanceAfter: f.balance,
  };
  f.ledger.push(record);
  return record;
}

export function currentBalance(f: FinanceState): number {
  return f.balance;
}
