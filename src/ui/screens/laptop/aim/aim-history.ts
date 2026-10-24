// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMHistory.cc AimHistoryTextLocations, NUM_AIM_HISTORY_PAGES, EnterAimHistory (gubCurPageNum =
// @src giCurrentSubPage), ExitAimHistory (giCurrentSubPage = gubCurPageNum), RenderAimHistory (the chapter of each page: one
// @src paragraph on page 4, two on the others), DisplayAimHistoryParagraph (the second paragraph AIM_HISTORY_SPACE_BETWEEN_
// @src PARAGRAPHS below the height of the first), SelectHistoryTocMenuRegionCallBack, BtnHistoryMenuButtonCallback (button 3
// @src opens the alumni archives), ResetAimHistoryButtons, DisableAimHistoryButton (previous held on the index, next held on
// @src the last page). See docs/28 §9.4.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { FontName } from '../../../text/fonts.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { changeSubPage, subPageVisits, wrappedHeight } from './aim-history-support.ts';
import { aimChrome } from './aim-pages.ts';

export const AIM_HISTORY_LAYOUT = 'aim-history';
export const AIM_HISTORY_TEXT_FILE = 'binarydata/aimhist.edt';
export const NUM_AIM_HISTORY_PAGES = 5;
export const HISTORY_TOC_PAGE = 0;
const FOUNDER_PAGE = 4;
const INCORPORATION_PAGE = 5;
const TEXT_GAP = 2;
const VISITS_KEY = 'aimHistory';

export const HistoryMenu = { PREVIOUS: 0, HOME: 1, ALUMNI: 2, NEXT: 3 } as const;
const MENU_BUTTONS = 4;

export interface HistoryChapter {
  readonly title: string;
  readonly paragraphs: number;
}

export const HISTORY_CHAPTERS: Readonly<Record<number, HistoryChapter>> = {
  1: { title: 'IN_THE_BEGINNING', paragraphs: 2 },
  2: { title: 'THE_ISLAND_METAVIRA', paragraphs: 2 },
  3: { title: 'GUS_TARBALLS', paragraphs: 2 },
  4: { title: 'WORD_FROM_FOUNDER', paragraphs: 1 },
  5: { title: 'INCORPORATION', paragraphs: 2 },
};

export const AIM_HISTORY_CONTRACT: ControllerContract = {
  id: 'aimHistory',
  actions: { toc: { args: 1 }, menu: { args: 1 } },
  bindings: {
    toc: 'boolean',
    chapter: 'boolean',
    chapterTitle: 'string',
    firstParagraph: 'string',
    secondParagraph: 'string',
    secondParagraphY: 'number',
    secondParagraphShown: 'boolean',
    founderPage: 'boolean',
    incorporationPage: 'boolean',
    menuHeld: 'list',
  },
};

export function historyMenuHeld(page: number): boolean[] {
  return Array.from(
    { length: MENU_BUTTONS },
    (_, i) => (page === HISTORY_TOC_PAGE && i === HistoryMenu.PREVIOUS) || (page === NUM_AIM_HISTORY_PAGES && i === HistoryMenu.NEXT),
  );
}

export function historyMenuTarget(page: number, button: number): number | null {
  if (button === HistoryMenu.PREVIOUS) return page > HISTORY_TOC_PAGE ? page - 1 : null;
  if (button === HistoryMenu.NEXT) return page < NUM_AIM_HISTORY_PAGES ? page + 1 : null;
  return null;
}

export function aimHistoryPage(context: LaptopContext): LaptopPage {
  const constant = (name: string) => context.constant(AIM_HISTORY_LAYOUT, name);
  const visits = subPageVisits(context.shell, VISITS_KEY, NUM_AIM_HISTORY_PAGES + 1);
  const font = context.services.fonts.get(FontName.FONT10ARIAL);
  const historyText = (row: number) => context.text.edt(AIM_HISTORY_TEXT_FILE, row) ?? '';
  let page = context.shell.subPage;
  const model: Record<string, unknown> = {};
  void context.media.loadTexts([AIM_HISTORY_TEXT_FILE]);
  const goTo = (target: number) => {
    page = target;
    changeSubPage(context.shell, visits, page);
  };
  const refresh = () => {
    const chapter = HISTORY_CHAPTERS[page];
    model.toc = page === HISTORY_TOC_PAGE;
    model.chapter = chapter !== undefined;
    model.founderPage = page === FOUNDER_PAGE;
    model.incorporationPage = page === INCORPORATION_PAGE;
    model.menuHeld = historyMenuHeld(page);
    const title = chapter ? constant(chapter.title) : 0;
    const first = chapter ? historyText(title + 1) : '';
    model.chapterTitle = chapter ? historyText(title) : '';
    model.firstParagraph = first;
    model.secondParagraphShown = (chapter?.paragraphs ?? 0) >= 2;
    model.secondParagraph = model.secondParagraphShown ? historyText(title + 2) : '';
    model.secondParagraphY =
      constant('AIM_HISTORY_PARAGRAPH_Y') +
      wrappedHeight(font, constant('AIM_HISTORY_PARAGRAPH_WIDTH'), TEXT_GAP, first) +
      constant('AIM_HISTORY_SPACE_BETWEEN_PARAGRAPHS');
  };
  const controller = new ViewModelController(AIM_HISTORY_CONTRACT, model, {
    toc: ([i]) => {
      if (page === HISTORY_TOC_PAGE) goTo((i ?? 0) + 1);
    },
    menu: ([button]) => {
      if (button === HistoryMenu.HOME) context.shell.setPage(LaptopMode.AIM);
      else if (button === HistoryMenu.ALUMNI) context.shell.setPage(LaptopMode.AIM_MEMBERS_ARCHIVES);
      else {
        const target = historyMenuTarget(page, button ?? HistoryMenu.PREVIOUS);
        if (target !== null) goTo(target);
      }
    },
  });
  refresh();
  return {
    layouts: [aimChrome(context), { name: AIM_HISTORY_LAYOUT, controller }],
    update: refresh,
    dispose: () => {
      context.shell.subPage = page;
    },
  };
}
