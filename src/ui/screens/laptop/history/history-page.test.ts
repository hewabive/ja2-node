import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clickWidget,
  findWidget,
  type LaptopUiKit,
  laptopUiKit,
  openLaptopHarness,
  openProgram,
  shownWidget,
} from '../../../../../tests/support/laptop-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../../tests/support/sectors.ts';
import type { LaptopHistoryView } from '../../../../protocol/view.ts';
import { addHistory } from '../../../../sim/campaign/laptop/records.ts';
import { LaptopMode } from '../laptop-modes.ts';
import {
  HISTORY_CHEAT_ENABLED,
  hasPage,
  historyPageCount,
  historyRows,
  NUM_RECORDS_PER_PAGE,
  pageRange,
  recordsOfPage,
  rowColour,
} from './history-page.ts';

const SCREEN_TEST_TIMEOUT_MS = 120_000;
const MINUTES_PER_DAY = 1440;
const QUEST_STARTED = 15;
const SETTLED_ACCOUNTS = 4;

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

function row(day: number, overrides: Partial<LaptopHistoryView> = {}): LaptopHistoryView {
  return {
    code: SETTLED_ACCOUNTS,
    secondCode: 0,
    date: { day, hour: 0, minute: 0 },
    sector: null,
    text: `event ${day}`,
    location: 'N/A',
    questInProgress: false,
    ...overrides,
  };
}

const COLUMN = { centre: (text: string) => 100 - text.length, cut: (text: string) => text.slice(0, 4) };

describe('the history page', () => {
  it('counts pages of twenty-two rows with one page for an empty log', () => {
    expect(historyPageCount(0)).toBe(1);
    expect(historyPageCount(NUM_RECORDS_PER_PAGE)).toBe(1);
    expect(historyPageCount(NUM_RECORDS_PER_PAGE + 1)).toBe(2);
    expect(hasPage(NUM_RECORDS_PER_PAGE, 2)).toBe(false);
    expect(hasPage(NUM_RECORDS_PER_PAGE + 1, 2)).toBe(true);
    expect(hasPage(5, 0)).toBe(false);
    expect(recordsOfPage([1, 2, 3], 0)).toEqual([]);
  });

  it('shows 1 / 1 and 1 - 1 for a page without records and the first and last day of a page otherwise', () => {
    expect(pageRange([], 1)).toEqual({ current: 1, count: 1, first: 1, last: 1 });
    const records = Array.from({ length: 30 }, (_, i) => row(i + 2));
    expect(pageRange(records, 1)).toEqual({ current: 1, count: 2, first: 2, last: 23 });
    expect(pageRange(records, 2)).toEqual({ current: 2, count: 2, first: 24, last: 31 });
    expect(pageRange(records, 3)).toEqual({ current: 1, count: 1, first: 1, last: 1 });
  });

  it('colours the cheat and the quests in progress red', () => {
    expect(rowColour({ code: HISTORY_CHEAT_ENABLED, questInProgress: false })).toBe('red');
    expect(rowColour({ code: QUEST_STARTED, questInProgress: true })).toBe('red');
    expect(rowColour({ code: QUEST_STARTED, questInProgress: false })).toBe('black');
  });

  it('centres the uncut location and cuts it afterwards', () => {
    const rows = historyRows([row(3, { location: 'A9: Somewhere far' })], 1, COLUMN);
    expect(rows).toHaveLength(NUM_RECORDS_PER_PAGE);
    expect(rows[0]).toMatchObject({ present: true, date: '3', location: 'A9: ', locationX: 100 - 'A9: Somewhere far'.length });
    expect(rows[1]?.present).toBe(false);
  });

  it(
    'pages through the log with the arrows and keeps the page across laptop sessions',
    async () => {
      const h = await openLaptopHarness(kit, ui);
      const l = h.session.campaign.state.laptop;
      const start = l.history.length;
      for (let i = 0; i < NUM_RECORDS_PER_PAGE + 3 - start; i++) addHistory(l, SETTLED_ACCOUNTS, 0, (i + 1) * MINUTES_PER_DAY, null);
      await openProgram(h, 'historyButton');
      expect(h.screen.shell.mode).toBe(LaptopMode.HISTORY);
      expect(shownWidget(h.t, 'historyPage').text).toMatch(/ {2}1 \/ 2$/);
      expect(shownWidget(h.t, 'historyText0').text).not.toBe('');
      expect(shownWidget(h.t, 'prevHistoryPage').enabled).toBe(false);
      await clickWidget(h.t, 'nextHistoryPage');
      expect(shownWidget(h.t, 'historyPage').text).toMatch(/ {2}2 \/ 2$/);
      expect(shownWidget(h.t, 'historyText0').text).toBe('Settled Accounts at M.E.R.C.');
      expect(shownWidget(h.t, 'historyLocation0').text).toBe('N/A');
      expect(findWidget(h.t, 'historyText3')?.visible).toBe(false);
      expect(shownWidget(h.t, 'nextHistoryPage').enabled).toBe(false);
      await clickWidget(h.t, 'nextHistoryPage');
      expect(shownWidget(h.t, 'historyPage').text).toMatch(/ {2}2 \/ 2$/);
      await clickWidget(h.t, 'prevHistoryPage');
      expect(shownWidget(h.t, 'historyPage').text).toMatch(/ {2}1 \/ 2$/);
      await clickWidget(h.t, 'nextHistoryPage');
      await openProgram(h, 'financesButton');
      await openProgram(h, 'historyButton');
      expect(shownWidget(h.t, 'historyPage').text).toMatch(/ {2}2 \/ 2$/);
    },
    SCREEN_TEST_TIMEOUT_MS,
  );
});
