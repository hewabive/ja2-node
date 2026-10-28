import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clickWidget,
  findWidget,
  type LaptopUiKit,
  laptopUiKit,
  openLaptopHarness,
  openWebPage,
  shownWidget,
} from '../../../../../tests/support/laptop-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../../tests/support/sectors.ts';
import { Bookmark, LaptopMode } from '../laptop-modes.ts';
import { HISTORY_TOC_PAGE, HistoryMenu, historyMenuHeld, historyMenuTarget, NUM_AIM_HISTORY_PAGES } from './aim-history.ts';

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

describe('the A.I.M. history', () => {
  it('holds previous on the index and next on the last chapter and pages within the bounds', () => {
    expect(historyMenuHeld(HISTORY_TOC_PAGE)).toEqual([true, false, false, false]);
    expect(historyMenuHeld(NUM_AIM_HISTORY_PAGES)).toEqual([false, false, false, true]);
    expect(historyMenuHeld(2)).toEqual([false, false, false, false]);
    expect(historyMenuTarget(HISTORY_TOC_PAGE, HistoryMenu.PREVIOUS)).toBeNull();
    expect(historyMenuTarget(1, HistoryMenu.PREVIOUS)).toBe(HISTORY_TOC_PAGE);
    expect(historyMenuTarget(NUM_AIM_HISTORY_PAGES, HistoryMenu.NEXT)).toBeNull();
    expect(historyMenuTarget(4, HistoryMenu.NEXT)).toBe(NUM_AIM_HISTORY_PAGES);
  });

  it('opens a chapter from the index, pages to the signatures of the last chapters and links to the alumni', async () => {
    const h = await openLaptopHarness(kit, ui);
    await openWebPage(h, Bookmark.AIM);
    await clickWidget(h.t, 'historyLink');
    expect(h.screen.shell.mode).toBe(LaptopMode.AIM_HISTORY);
    expect(shownWidget(h.t, 'aimHistoryTitle').text).not.toBe('');
    expect(shownWidget(h.t, 'aimHistorySlogan').text).toMatch(/^Professional soldiers/);
    expect(shownWidget(h.t, 'aimHistoryTocTitle0').text).toBe('In the beginning');
    expect(shownWidget(h.t, 'aimHistoryTocTitle4').text).toBe('Incorporation');
    await clickWidget(h.t, 'aimHistoryToc0');
    expect(shownWidget(h.t, 'aimHistoryChapterTitle').text).toBe('In the beginning');
    expect(shownWidget(h.t, 'aimHistoryParagraph2').text).toMatch(/^Word spread/);
    expect(findWidget(h.t, 'aimHistoryToc0')?.visible ?? false).toBe(false);
    await clickWidget(h.t, `aimHistoryMenu${HistoryMenu.NEXT}`);
    await clickWidget(h.t, `aimHistoryMenu${HistoryMenu.NEXT}`);
    await clickWidget(h.t, `aimHistoryMenu${HistoryMenu.NEXT}`);
    expect(shownWidget(h.t, 'aimHistoryChapterTitle').text).toBe('A word from the founder');
    expect(shownWidget(h.t, 'aimHistoryFounderSignature').text).toBe('The founder, stub association');
    expect(findWidget(h.t, 'aimHistoryParagraph2')?.visible).toBe(false);
    await clickWidget(h.t, `aimHistoryMenu${HistoryMenu.NEXT}`);
    expect(shownWidget(h.t, 'aimHistoryAuditSignature').text).toBe('An invented auditing firm');
    expect(shownWidget(h.t, 'aimHistoryIncorporation3').text).toMatch(/^Today the association/);
    await clickWidget(h.t, `aimHistoryMenu${HistoryMenu.NEXT}`);
    expect(shownWidget(h.t, 'aimHistoryChapterTitle').text).toBe('Incorporation');
    await clickWidget(h.t, `aimHistoryMenu${HistoryMenu.ALUMNI}`);
    expect(h.screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS_ARCHIVES);
  });
});
