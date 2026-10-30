// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/History.cc EnterHistory and ExitHistory (the page kept in LaptopSaveInfo.iCurrentHistoryPage, 1 when
// @src not positive), DrawHistoryRecordsText (NUM_RECORDS_PER_PAGE rows; the day; the location centred by
// @src FindFontCenterCoordinates over RECORD_LOCATION_WIDTH + 10 and then cut by ReduceStringLength; the text; red for a
// @src cheat or a quest started and still in progress), DisplayPageNumberAndDateRange (1 / 1 and 1 - 1 without records;
// @src the first and the last day of the page), GetNumberOfHistoryPages, LoadInHistoryRecords, LoadNextHistoryPage,
// @src LoadPreviousHistoryPage, SetHistoryButtonStates, ScrollRegionCallback; Laptop/History.h HISTORY_CHEAT_ENABLED.

import { idiv } from '../../../../core/int.ts';
import type { LaptopHistoryView } from '../../../../protocol/view.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { FontName } from '../../../text/fonts.ts';
import { centerAlign } from '../../../text/measure.ts';
import { reduceStringLength } from '../../../text/wrap.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const HISTORY_LAYOUT = 'laptop-history';
export const NUM_RECORDS_PER_PAGE = 22;
export const HISTORY_CHEAT_ENABLED = 19;
const FIRST_PAGE = 1;
const LOCATION_MARGIN = 10;
const HISTORY_HEADERS = 'pHistoryHeaders';
const PAGE_HEADER = 1;
const DAY_HEADER = 2;
const HISTORY_TEXT_FONT = FontName.FONT12ARIAL;

export const HISTORY_CONTRACT: ControllerContract = {
  id: 'laptopHistory',
  actions: { prevPage: {}, nextPage: {} },
  bindings: { rows: 'list', pageText: 'string', dateText: 'string', prevEnabled: 'boolean', nextEnabled: 'boolean' },
};

export type HistoryColour = 'red' | 'black';

export interface HistoryRow {
  readonly present: boolean;
  readonly date: string;
  readonly location: string;
  readonly locationX: number;
  readonly text: string;
  readonly colour: HistoryColour;
}

export interface PageRange {
  readonly current: number;
  readonly count: number;
  readonly first: number;
  readonly last: number;
}

export interface LocationColumn {
  centre(text: string): number;
  cut(text: string): string;
}

const EMPTY_ROW: HistoryRow = { present: false, date: '', location: '', locationX: 0, text: '', colour: 'black' };

export function historyPageCount(records: number): number {
  return records === 0 ? FIRST_PAGE : idiv(records + NUM_RECORDS_PER_PAGE - 1, NUM_RECORDS_PER_PAGE);
}

export function recordsOfPage<T>(records: readonly T[], page: number): readonly T[] {
  if (page < FIRST_PAGE) return [];
  return records.slice((page - 1) * NUM_RECORDS_PER_PAGE, page * NUM_RECORDS_PER_PAGE);
}

export function hasPage(records: number, page: number): boolean {
  return page >= FIRST_PAGE && records > (page - 1) * NUM_RECORDS_PER_PAGE;
}

export function pageRange(records: readonly LaptopHistoryView[], page: number): PageRange {
  const shown = recordsOfPage(records, page);
  const first = shown[0];
  const last = shown[shown.length - 1];
  if (!first || !last) return { current: FIRST_PAGE, count: FIRST_PAGE, first: FIRST_PAGE, last: FIRST_PAGE };
  return { current: page, count: historyPageCount(records.length), first: first.date.day, last: last.date.day };
}

export function rowColour(row: Pick<LaptopHistoryView, 'code' | 'questInProgress'>): HistoryColour {
  return row.code === HISTORY_CHEAT_ENABLED || row.questInProgress ? 'red' : 'black';
}

export function historyRows(records: readonly LaptopHistoryView[], page: number, column: LocationColumn): HistoryRow[] {
  const shown = recordsOfPage(records, page);
  return Array.from({ length: NUM_RECORDS_PER_PAGE }, (_, i): HistoryRow => {
    const r = shown[i];
    if (!r) return EMPTY_ROW;
    return {
      present: true,
      date: String(r.date.day),
      location: column.cut(r.location),
      locationX: column.centre(r.location),
      text: r.text,
      colour: rowColour(r),
    };
  });
}

export function historyPage(context: LaptopContext): LaptopPage {
  const memory = context.memory.pages;
  const constant = (name: string) => context.constant(HISTORY_LAYOUT, name);
  const font = context.services.fonts.get(HISTORY_TEXT_FONT);
  const left = constant('RECORD_DATE_X') + constant('RECORD_DATE_WIDTH');
  const width = constant('RECORD_LOCATION_WIDTH') + LOCATION_MARGIN;
  const column: LocationColumn = {
    centre: (text) => centerAlign(left, 0, width, text, font).x,
    cut: (text) => reduceStringLength(text, width, font),
  };
  const model: Record<string, unknown> = {};
  let page = memory.historyPage <= 0 ? FIRST_PAGE : memory.historyPage;
  const records = () => context.view()?.history ?? [];
  const setPage = (next: number) => {
    page = next;
    memory.historyPage = page;
  };
  const refresh = () => {
    const all = records();
    const range = pageRange(all, page);
    model.rows = historyRows(all, page, column);
    model.pageText = `${context.string(HISTORY_HEADERS, PAGE_HEADER)}  ${range.current} / ${range.count}`;
    model.dateText = `${context.string(HISTORY_HEADERS, DAY_HEADER)} ${range.first} - ${range.last}`;
    model.prevEnabled = page !== FIRST_PAGE;
    model.nextEnabled = page < historyPageCount(all.length);
  };
  const controller = new ViewModelController(HISTORY_CONTRACT, model, {
    prevPage: () => {
      if (page > FIRST_PAGE) setPage(page - 1);
    },
    nextPage: () => {
      if (hasPage(records().length, page + 1)) setPage(page + 1);
    },
  });
  setPage(page);
  refresh();
  return { layouts: [{ name: HISTORY_LAYOUT, controller }], update: refresh };
}
