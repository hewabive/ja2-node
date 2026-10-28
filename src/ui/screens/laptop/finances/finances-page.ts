// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Finances.cc EnterFinances, RenderFinances (page 0 the summary, the ledger from page 1),
// @src DrawSummaryText (SPrintMoneyNoDollarOnZero; the debits red as absolute values, the balances red when negative),
// @src DrawRecordsText (NUM_RECORDS_PER_PAGE rows of the font height + 6; income black at the debit column, expenses red
// @src at the credit column, the balance red when negative and the transaction text in the balance's colour),
// @src SetLastPageInRecords, LoadPreviousPage, LoadNextPage, the first and last page buttons, SetFinanceButtonStates,
// @src DisplayFinancePageNumberAndDateRange ("<header> n / last + 2").

import type { LaptopFinanceSummaryView, LaptopFinanceView } from '../../../../protocol/view.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName } from '../../../text/fonts.ts';
import { sprintMoney, sprintMoneyNoDollarOnZero } from '../../../text/money.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const FINANCES_LAYOUT = 'laptop-finances';
export const NUM_RECORDS_PER_PAGE = 17;
const ROW_SPACING = 6;
const FINANCE_HEADERS = 'pFinanceHeaders';
const PAGE_HEADER = 5;
const FINANCE_TEXT_FONT = FontName.FONT12ARIAL;

export const FINANCES_CONTRACT: ControllerContract = {
  id: 'laptopFinances',
  actions: { prevPage: {}, nextPage: {}, firstPage: {}, lastPage: {} },
  bindings: {
    summary: 'boolean',
    ledger: 'boolean',
    amounts: 'list',
    rows: 'list',
    rowStep: 'number',
    pageText: 'string',
    prevEnabled: 'boolean',
    nextEnabled: 'boolean',
  },
};

interface Amount {
  readonly text: string;
  readonly red: boolean;
  readonly black: boolean;
}

interface LedgerRow {
  readonly present: boolean;
  readonly date: string;
  readonly income: string;
  readonly expense: string;
  readonly balance: string;
  readonly text: string;
  readonly negative: boolean;
  readonly positive: boolean;
}

const EMPTY_ROW: LedgerRow = { present: false, date: '', income: '', expense: '', balance: '', text: '', negative: false, positive: false };

function amount(value: number, red: boolean): Amount {
  return { text: sprintMoneyNoDollarOnZero(Math.abs(value)), red, black: !red };
}

export function summaryAmounts(s: LaptopFinanceSummaryView, balance: number): Amount[] {
  return [
    amount(s.yesterday.income, false),
    amount(s.yesterday.otherDeposits, false),
    amount(s.yesterday.debits, true),
    amount(s.yesterday.closingBalance, s.yesterday.closingBalance < 0),
    amount(s.today.income, false),
    amount(s.today.otherDeposits, false),
    amount(s.today.debits, true),
    amount(balance, balance < 0),
    amount(s.projectedIncome, false),
    amount(s.projectedBalance, s.projectedBalance < 0),
  ];
}

export function lastLedgerPage(records: number): number {
  return records < 1 ? 0 : Math.floor((records - 1) / NUM_RECORDS_PER_PAGE);
}

export function ledgerRows(records: readonly LaptopFinanceView[], page: number): LedgerRow[] {
  const first = NUM_RECORDS_PER_PAGE * (page - 1);
  return Array.from({ length: NUM_RECORDS_PER_PAGE }, (_, i): LedgerRow => {
    const r = page > 0 ? records[first + i] : undefined;
    if (!r) return EMPTY_ROW;
    const negative = r.balanceAfter < 0;
    return {
      present: true,
      date: String(r.date.day),
      income: r.amount >= 0 ? sprintMoney(r.amount) : '',
      expense: r.amount < 0 ? sprintMoney(-r.amount) : '',
      balance: sprintMoney(Math.abs(r.balanceAfter)),
      text: r.text,
      negative,
      positive: !negative,
    };
  });
}

export function financesPage(context: LaptopContext): LaptopPage {
  const model: Record<string, unknown> = {};
  const memory = context.memory;
  const records = () => context.view()?.finances ?? [];
  const last = () => lastLedgerPage(records().length);
  const load = (page: number) => {
    memory.financesPage = Math.max(0, Math.min(page, last() + 1));
  };
  const refresh = () => {
    const view = context.view();
    const page = Math.min(memory.financesPage, last() + 1);
    model.summary = page === 0;
    model.ledger = page > 0;
    model.amounts = view ? summaryAmounts(view.financeSummary, view.balance) : [];
    model.rows = ledgerRows(records(), page);
    model.rowStep = fontHeight(context.services.fonts.get(FINANCE_TEXT_FONT)) + ROW_SPACING;
    model.pageText = `${context.string(FINANCE_HEADERS, PAGE_HEADER)} ${page + 1} / ${last() + 2}`;
    model.prevEnabled = page !== 0;
    model.nextEnabled = page <= last();
  };
  const controller = new ViewModelController(FINANCES_CONTRACT, model, {
    prevPage: () => {
      if (memory.financesPage !== 0) load(memory.financesPage - 1);
    },
    nextPage: () => {
      if (memory.financesPage <= last()) load(memory.financesPage + 1);
    },
    firstPage: () => load(0),
    lastPage: () => load(last() + 1),
  });
  refresh();
  return { layouts: [{ name: FINANCES_LAYOUT, controller }], update: refresh };
}
