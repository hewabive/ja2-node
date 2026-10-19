import { describe, expect, it } from 'vitest';
import type { LaptopFinanceSummaryView, LaptopFinanceView } from '../../../../protocol/view.ts';
import { lastLedgerPage, ledgerRows, NUM_RECORDS_PER_PAGE, summaryAmounts } from './finances-page.ts';

const SUMMARY: LaptopFinanceSummaryView = {
  yesterday: { income: 0, otherDeposits: 500, debits: -1200, closingBalance: -50 },
  today: { income: 300, otherDeposits: 0, debits: -40, balance: 260 },
  projectedIncome: 300,
  projectedBalance: 560,
};

function record(day: number, amount: number, balanceAfter: number): LaptopFinanceView {
  return {
    code: 0,
    secondCode: 0,
    date: { day, hour: 0, minute: 0 } as LaptopFinanceView['date'],
    amount,
    balanceAfter,
    text: `entry ${day}`,
  };
}

describe('the finances page', () => {
  it('shows the debits red as absolute values, the balances red when negative and zero without the dollar', () => {
    const amounts = summaryAmounts(SUMMARY, -10);
    expect(amounts.map((a) => a.red)).toEqual([false, false, true, true, false, false, true, true, false, false]);
    expect(amounts[2]?.text).toBe(amounts[2]?.text.replace('-', ''));
    expect(amounts[0]?.text).toBe('0');
    expect(amounts[7]?.black).toBe(false);
  });

  it('starts the ledger on page 1 with seventeen rows a page', () => {
    expect(lastLedgerPage(0)).toBe(0);
    expect(lastLedgerPage(NUM_RECORDS_PER_PAGE)).toBe(0);
    expect(lastLedgerPage(NUM_RECORDS_PER_PAGE + 1)).toBe(1);
    const records = Array.from({ length: NUM_RECORDS_PER_PAGE + 2 }, (_, i) =>
      record(i + 1, i % 2 === 0 ? 100 : -300, i === 1 ? -200 : 100),
    );
    expect(ledgerRows(records, 0).every((r) => !r.present)).toBe(true);
    const first = ledgerRows(records, 1);
    expect(first).toHaveLength(NUM_RECORDS_PER_PAGE);
    expect(first[0]).toMatchObject({ present: true, date: '1', expense: '', negative: false, text: 'entry 1' });
    expect(first[0]?.income).not.toBe('');
    expect(first[1]).toMatchObject({ income: '', negative: true, positive: false });
    expect(first[1]?.balance).not.toContain('-');
    const second = ledgerRows(records, 2);
    expect(second.filter((r) => r.present).map((r) => r.date)).toEqual(['18', '19']);
  });
});
