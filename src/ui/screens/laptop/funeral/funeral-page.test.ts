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
import { linkTextOffset } from './funeral-page.ts';

const SCREEN_TEST_TIMEOUT_MS = 120_000;

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

describe('the funeral page', () => {
  it('centres a link text in its carving', () => {
    expect(linkTextOffset(60, 24)).toBe(18);
    expect(linkTextOffset(60, 25)).toBe(17);
  });

  it(
    'bookmarks the site on the first visit, shows the closed sign for every link but the florist and hides it on a click',
    async () => {
      const h = await openLaptopHarness(kit, ui);
      expect(h.laptop().bookmarks).not.toContain('funeral');
      await openWebPage(h, Bookmark.FUNERAL);
      expect(h.commands).toContainEqual({ type: 'visitSite', site: 'funeral' });
      expect(h.laptop().bookmarks).toContain('funeral');
      expect(shownWidget(h.t, 'funeralSentence1').text).toMatch(/McGillicutty/);
      expect(findWidget(h.t, 'funeralCondolences')?.visible).toBe(false);
      await clickWidget(h.t, 'funeralLink2');
      expect(shownWidget(h.t, 'funeralCondolences').text).not.toBe('');
      await clickWidget(h.t, 'funeralRipRegion');
      expect(findWidget(h.t, 'funeralCondolences')?.visible).toBe(false);
      await clickWidget(h.t, 'funeralLink0');
      expect(h.screen.shell.mode).toBe(LaptopMode.FLORIST);
    },
    SCREEN_TEST_TIMEOUT_MS,
  );
});
