import { describe, expect, it } from 'vitest';
import {
  financeSummary,
  previousDaysBalance,
  previousDaysIncome,
  todaysBalance,
  todaysIncome,
  todaysOtherDeposits,
  yesterdaysOtherDeposits,
} from './finance-summary.ts';
import { FinanceCode, type FinanceRecord } from './finances.ts';

const DAY = 1440;
const HOUR = 60;

function ledger(rows: readonly (readonly [day: number, hour: number, code: number, amount: number])[]): FinanceRecord[] {
  let balance = 0;
  return rows.map(([day, hour, code, amount]) => {
    balance += amount;
    return { code, secondCode: 0, minute: day * DAY + hour * HOUR, amount, balanceAfter: balance };
  });
}

const MINE = FinanceCode.DEPOSIT_FROM_SILVER_MINE;
const WEEK = ledger([
  [2, 9, FinanceCode.ANONYMOUS_DEPOSIT, 1000],
  [2, 10, MINE, 500],
  [3, 8, MINE, 60],
  [4, 8, MINE, 400],
  [4, 9, FinanceCode.HIRED_MERC, -200],
  [4, 10, FinanceCode.PAYMENT_TO_NPC, 50],
  [4, 11, MINE, 100],
  [5, 8, FinanceCode.ANONYMOUS_DEPOSIT, 20],
  [5, 9, MINE, 300],
  [5, 10, FinanceCode.BOBBYR_PURCHASE, -100],
  [5, 11, FinanceCode.ANONYMOUS_DEPOSIT, 5],
]);
const NOON_OF_DAY_5 = 5 * DAY + 12 * HOUR;
const BALANCE = 2135;

describe('the finance summary page (Finances.cc, quirks included)', () => {
  it("compares yesterday's opening balance with a record three days back", () => {
    expect(previousDaysBalance(WEEK, NOON_OF_DAY_5)).toBe(1500);
    expect(previousDaysBalance(ledger([[1, 2, MINE, 7]]), 3 * DAY + HOUR)).toBe(0);
    expect(previousDaysBalance(WEEK, 2 * DAY + 23 * HOUR)).toBe(0);
  });

  it("takes yesterday's closing balance from its newest record, or zero on a day without records", () => {
    expect(todaysBalance(WEEK, NOON_OF_DAY_5)).toBe(1910);
    expect(todaysBalance(WEEK, 7 * DAY)).toBe(0);
  });

  it('counts the first record of the day before yesterday when it is a mine deposit', () => {
    expect(previousDaysIncome(WEEK, NOON_OF_DAY_5)).toBe(560);
    expect(yesterdaysOtherDeposits(WEEK, NOON_OF_DAY_5)).toBe(50);
  });

  it("adds yesterday's newest mine deposit to today's income when today's oldest record is not one", () => {
    expect(todaysIncome(WEEK, NOON_OF_DAY_5)).toBe(400);
    expect(todaysOtherDeposits(WEEK, NOON_OF_DAY_5)).toBe(25);
  });

  it('derives the debits and the forecast from the other figures', () => {
    expect(financeSummary(WEEK, NOON_OF_DAY_5, BALANCE, 77)).toEqual({
      yesterday: { income: 560, otherDeposits: 50, debits: -200, closingBalance: 1910 },
      today: { income: 400, otherDeposits: 25, debits: -200, balance: BALANCE },
      projectedIncome: 77,
      projectedBalance: BALANCE + 77,
    });
  });

  it('wraps the unsigned day arithmetic on day 1 and day 0', () => {
    const start = ledger([
      [1, 1, FinanceCode.ANONYMOUS_DEPOSIT, 35000],
      [1, 1, FinanceCode.HIRED_MERC, -1000],
    ]);
    expect(financeSummary(start, DAY + HOUR, 34000, 0)).toEqual({
      yesterday: { income: 0, otherDeposits: 0, debits: 0, closingBalance: 0 },
      today: { income: 0, otherDeposits: 35000, debits: -1000, balance: 34000 },
      projectedIncome: 0,
      projectedBalance: 34000,
    });
    const dayZero = ledger([[0, 0, MINE, 90]]);
    expect(financeSummary(dayZero, HOUR, 90, 0).today).toEqual({ income: 0, otherDeposits: 0, debits: 90, balance: 90 });
  });
});
