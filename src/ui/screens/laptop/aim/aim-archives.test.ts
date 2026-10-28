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
import { alumniOnPage, MAX_NUMBER_OLD_MERCS_ON_PAGE, OLD_MERCS_COUNT, POPUP_BASE_SECTIONS, popupSections } from './aim-archives.ts';

const POPUP_TEXT_WIDTH = 296;
const DONE = 'aimAlumniDone.0';

let kit: StubSectorKit;
let ui: LaptopUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await laptopUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

describe('the A.I.M. alumni archives', () => {
  it('shows twenty alumni a page and the rest of the 51 on the last page', () => {
    expect(alumniOnPage(0)).toHaveLength(MAX_NUMBER_OLD_MERCS_ON_PAGE);
    expect(alumniOnPage(1)[0]).toBe(MAX_NUMBER_OLD_MERCS_ON_PAGE);
    expect(alumniOnPage(2)).toEqual(Array.from({ length: 11 }, (_, i) => 40 + i));
    expect(alumniOnPage(2).at(-1)).toBe(OLD_MERCS_COUNT - 1);
  });

  it('adds one popup section per text width of the description', () => {
    expect(popupSections(0, POPUP_TEXT_WIDTH)).toBe(POPUP_BASE_SECTIONS);
    expect(popupSections(POPUP_TEXT_WIDTH - 1, POPUP_TEXT_WIDTH)).toBe(POPUP_BASE_SECTIONS);
    expect(popupSections(POPUP_TEXT_WIDTH * 2, POPUP_TEXT_WIDTH)).toBe(POPUP_BASE_SECTIONS + 2);
  });

  it('opens an alumnus popup without the face regions, closes it on done and switches the pages', async () => {
    const h = await openLaptopHarness(kit, ui);
    await openWebPage(h, Bookmark.AIM);
    await clickWidget(h.t, 'memberCardLink');
    await clickWidget(h.t, 'toAlumniLink');
    expect(h.screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS_ARCHIVES);
    expect(shownWidget(h.t, 'aimAlumniTitle').text).not.toBe('');
    expect(shownWidget(h.t, 'aimAlumnusName0').text).toBe('Alumnus 01');
    expect(findWidget(h.t, 'aimAlumniPopupName')?.visible).toBe(false);
    await clickWidget(h.t, 'aimAlumnus3');
    expect(shownWidget(h.t, 'aimAlumniPopupName').text).toBe('Alumnus 04');
    expect(shownWidget(h.t, 'aimAlumniPopupDescription').text).toMatch(/^Alumnus 04 worked/);
    expect(findWidget(h.t, 'aimAlumnus0')?.visible).toBe(false);
    const done = shownWidget(h.t, DONE);
    expect(done.rect.y).toBeGreaterThan(shownWidget(h.t, 'aimAlumniPopupName').rect.y);
    await clickWidget(h.t, DONE);
    expect(findWidget(h.t, 'aimAlumniPopupName')?.visible).toBe(false);
    expect(shownWidget(h.t, 'aimAlumnus0').visible).toBe(true);
    await clickWidget(h.t, 'aimAlumniPage2');
    expect(shownWidget(h.t, 'aimAlumnusName0').text).toBe('Alumnus 41');
    expect(shownWidget(h.t, 'aimAlumnusName10').text).toBe('Alumnus 51');
    expect(findWidget(h.t, 'aimAlumnusName11')?.visible).toBe(false);
    expect(findWidget(h.t, 'aimAlumnus11')?.visible).toBe(false);
  });
});
