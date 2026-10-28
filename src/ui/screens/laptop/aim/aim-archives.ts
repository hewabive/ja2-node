// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMArchives.cc EnterAimArchives (gubPageNum = giCurrentSubPage), ExitAimArchives (giCurrentSubPage =
// @src gubPageNum), RenderAimArchives (up to MAX_NUMBER_OLD_MERCS_ON_PAGE of OLD_MERCS_COUNT faces from the page start, the
// @src names of alumname.edt), SelectAlumniFaceRegionCallBack, BtnAlumniPageButtonCallback (the page change loads even for
// @src the current page and closes the popup), DisableAimArchiveButton, DisplayAlumniOldMercPopUp (11 sections plus one
// @src per AIM_POPUP_TEXT_WIDTH of the description's width, the name and description fields of alumni.edt),
// @src InitAlumniFaceRegions and RemoveAimAlumniFaceRegion (no face regions while the popup shows),
// @src CreateDestroyDoneMouseRegion, SelectAlumniDoneRegionCallBack.

import { idiv } from '../../../../core/int.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { FontName } from '../../../text/fonts.ts';
import { stringPixLength } from '../../../text/measure.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { changeSubPage, subPageVisits } from './aim-history-support.ts';
import { aimBar, aimChrome } from './aim-pages.ts';

export const AIM_ARCHIVES_LAYOUT = 'aim-archives';
export const OLD_MERCS_COUNT = 51;
export const MAX_NUMBER_OLD_MERCS_ON_PAGE = 20;
export const ALUMNI_PAGES = 3;
export const POPUP_BASE_SECTIONS = 11;
export const ALUMNI_NAMES_FILE = 'binarydata/alumname.edt';
export const ALUMNI_TEXTS_FILE = 'binarydata/alumni.edt';
const ALUMNI_TEXT_COLUMNS = 2;
const ALUMNI_NAME_COLUMN = 0;
const ALUMNI_DESCRIPTION_COLUMN = 1;
const VISITS_KEY = 'aimArchives';

export const AIM_ARCHIVES_CONTRACT: ControllerContract = {
  id: 'aimArchives',
  actions: { page: { args: 1 }, face: { args: 1 }, done: {} },
  bindings: {
    faces: 'list',
    pageHeld: 'list',
    popup: 'boolean',
    popupSections: 'number',
    popupBottom: 'list',
    popupDoneY: 'number',
    popupFace: 'number',
    popupName: 'string',
    popupDescription: 'string',
  },
};

export interface AlumniFace {
  readonly present: boolean;
  readonly clickable: boolean;
  readonly frame: number;
  readonly name: string;
}

export function alumniOnPage(page: number): number[] {
  const start = page * MAX_NUMBER_OLD_MERCS_ON_PAGE;
  const count = Math.max(0, Math.min(OLD_MERCS_COUNT - start, MAX_NUMBER_OLD_MERCS_ON_PAGE));
  return Array.from({ length: count }, (_, i) => start + i);
}

export function popupSections(descriptionWidth: number, textWidth: number): number {
  return POPUP_BASE_SECTIONS + idiv(descriptionWidth, textWidth);
}

export function aimArchivesPage(context: LaptopContext): LaptopPage {
  const constant = (name: string) => context.constant(AIM_ARCHIVES_LAYOUT, name);
  const visits = subPageVisits(context.shell, VISITS_KEY, ALUMNI_PAGES, true);
  const popupFont = context.services.fonts.get(FontName.FONT10ARIAL);
  let page = context.shell.subPage;
  let popupMerc: number | null = null;
  const model: Record<string, unknown> = {};
  void context.media.loadTexts([ALUMNI_NAMES_FILE, ALUMNI_TEXTS_FILE]);
  const alumniText = (merc: number, column: number) => context.text.edt(ALUMNI_TEXTS_FILE, merc * ALUMNI_TEXT_COLUMNS + column) ?? '';
  const refresh = () => {
    const shown = alumniOnPage(page);
    model.faces = Array.from({ length: MAX_NUMBER_OLD_MERCS_ON_PAGE }, (_, i): AlumniFace => {
      const merc = shown[i];
      if (merc === undefined) return { present: false, clickable: false, frame: 0, name: '' };
      return { present: true, clickable: popupMerc === null, frame: merc, name: context.text.edt(ALUMNI_NAMES_FILE, merc) ?? '' };
    });
    model.pageHeld = Array.from({ length: ALUMNI_PAGES }, (_, i) => i === page);
    model.popup = popupMerc !== null;
    model.popupBottom = popupMerc === null ? [] : [popupMerc];
    if (popupMerc === null) {
      model.popupSections = 0;
      return;
    }
    const description = alumniText(popupMerc, ALUMNI_DESCRIPTION_COLUMN);
    const sections = popupSections(stringPixLength(description, popupFont), constant('AIM_POPUP_TEXT_WIDTH'));
    const bottom = constant('AIM_POPUP_Y') + constant('AIM_POPUP_SECTION_HEIGHT') * (1 + sections);
    model.popupSections = sections;
    model.popupDoneY = bottom - constant('AIM_ALUMNI_DONE_HEIGHT');
    model.popupFace = popupMerc;
    model.popupName = alumniText(popupMerc, ALUMNI_NAME_COLUMN);
    model.popupDescription = description;
  };
  const controller = new ViewModelController(AIM_ARCHIVES_CONTRACT, model, {
    page: ([target]) => {
      const next = target ?? 0;
      changeSubPage(context.shell, visits, next);
      page = next;
      popupMerc = null;
    },
    face: ([i]) => {
      const merc = alumniOnPage(page)[i ?? 0];
      if (merc !== undefined && popupMerc === null) popupMerc = merc;
    },
    done: () => {
      popupMerc = null;
    },
  });
  refresh();
  return {
    layouts: [aimChrome(context), { name: AIM_ARCHIVES_LAYOUT, controller }, aimBar(context, LaptopMode.AIM_MEMBERS_ARCHIVES)],
    update: refresh,
    dispose: () => {
      context.shell.subPage = page;
    },
  };
}
