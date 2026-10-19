// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIM.cc InitAimDefaults (the logo back to the home page), InitAimMenuBar and DisableAimButton (the
// @src current page's button held down), gCurrentAimPage, EnterAIM, RenderAIM, the card and banner callbacks;
// @src src/game/Laptop/AIMSort.cc g_aim_sort_info, EnterAimSort (the regions sized by the label width), RenderAimSort,
// @src SetSortCriterion, SetSortOrder, ExitAimSort; src/game/Laptop/AIMFacialIndex.cc EnterAimFacialIndex,
// @src RenderAimFacialIndex, DrawMercsFaceToScreen (the overlays by state), the face callbacks; src/game/Laptop/AIMLinks.cc
// @src gubLinkPages, SelectLinkRegionCallBack. See docs/28 §9.4.

import type { AimMercView, LaptopView } from '../../../../protocol/view.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { FontName } from '../../../text/fonts.ts';
import { stringPixLength } from '../../../text/measure.ts';
import type { PortraitState } from '../../../widgets/portrait.ts';
import { Bookmark, LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage, PageLayout } from '../laptop-page.ts';
import { AimAd, AimAds } from './aim-ads.ts';
import { AIM_ASCEND, AIM_DESCEND, MAX_NUMBER_MERCS } from './aim-session.ts';

export const AIM_CHROME_LAYOUT = 'aim-chrome';
export const AIM_BAR_LAYOUT = 'aim-bar';
export const AIM_HOME_LAYOUT = 'aim-home';
export const AIM_SORT_LAYOUT = 'aim-sort';
export const AIM_INDEX_LAYOUT = 'aim-index';
export const AIM_LINKS_LAYOUT = 'aim-links';

export const AIM_PAGES: readonly number[] = [
  LaptopMode.AIM,
  LaptopMode.AIM_MEMBERS_SORTED_FILES,
  LaptopMode.AIM_MEMBERS_ARCHIVES,
  LaptopMode.AIM_POLICIES,
  LaptopMode.AIM_HISTORY,
  LaptopMode.AIM_LINKS,
];
const AIM_BOTTOM_BUTTONS = 6;
const LINK_PAGES = [Bookmark.BOBBYR, Bookmark.FUNERAL, Bookmark.INSURANCE];
const BANNER_PAGES: Readonly<Record<number, number>> = {
  [AimAd.FLOWER_SHOP]: Bookmark.FLORIST,
  [AimAd.INSURANCE]: Bookmark.INSURANCE,
  [AimAd.FUNERAL]: Bookmark.FUNERAL,
  [AimAd.BOBBY_RAY]: Bookmark.BOBBYR,
};
const MUG_COLUMNS = 8;
const MUG_ROWS = 5;
const MUG_NORMAL = 1;
const MUG_HOVER = 0;
const SORT_LABELS = 'str_aim_sort_list';
const SORT_ENTRIES = 8;
const SORT_CHECKBOX_SIZE = 10;
const SORT_LABEL_GAP = 4;
const AIM_FI_TEXT = 'AimFiText';
const AIM_FI_DEAD = 12;
const AIM_FI_SORTED_ASCENDING = 6;
const AIM_FI_SORTED_DESCENDING = 7;
const POW_STRINGS = 'pPOWStrings';
const MERC_INFO = 'MercInfo';
const MERC_FILES_ALREADY_HIRED = 5;

export const AIM_CHROME_CONTRACT: ControllerContract = { id: 'aimChrome', actions: { home: {} }, bindings: {} };
export const AIM_BAR_CONTRACT: ControllerContract = { id: 'aimBar', actions: { bottom: { args: 1 } }, bindings: { barChecked: 'list' } };
export const AIM_HOME_CONTRACT: ControllerContract = {
  id: 'aimHome',
  actions: { members: {}, policies: {}, history: {}, links: {}, banner: {} },
  bindings: {
    adWarning: 'boolean',
    adFlower: 'boolean',
    adForAds: 'boolean',
    adInsurance: 'boolean',
    adFuneral: 'boolean',
    adBobbyRay: 'boolean',
    adFrame: 'number',
    textFlower: 'boolean',
    textBobbyRay1: 'boolean',
    textBobbyRay2: 'boolean',
    bannerEnabled: 'boolean',
  },
};
export const AIM_SORT_CONTRACT: ControllerContract = {
  id: 'aimSort',
  actions: { sortBy: { args: 1 }, mugShots: {}, stats: {}, alumni: {} },
  bindings: { lights: 'list', regionWidths: 'list', regionShifts: 'list' },
};
export const AIM_INDEX_CONTRACT: ControllerContract = {
  id: 'aimIndex',
  actions: { selectFace: { args: 2 }, hoverFace: { args: 3 }, sortPage: {} },
  bindings: { mugRows: 'list', sortedTitle: 'string' },
};
export const AIM_LINKS_CONTRACT: ControllerContract = { id: 'aimLinks', actions: { link: { args: 1 } }, bindings: {} };

export function aimChrome(context: LaptopContext): PageLayout {
  return {
    name: AIM_CHROME_LAYOUT,
    controller: new ViewModelController(AIM_CHROME_CONTRACT, {}, { home: () => context.shell.setPage(LaptopMode.AIM) }),
  };
}

export function aimBar(context: LaptopContext, mode: number): PageLayout {
  const checked = Array.from({ length: AIM_BOTTOM_BUTTONS }, (_, i) => AIM_PAGES[i] === mode);
  return {
    name: AIM_BAR_LAYOUT,
    controller: new ViewModelController(
      AIM_BAR_CONTRACT,
      { barChecked: checked },
      {
        bottom: ([i]) => {
          const page = AIM_PAGES[i ?? 0];
          if (page !== undefined) context.shell.setPage(page);
        },
      },
    ),
  };
}

export function aimPlaceholderPage(context: LaptopContext): LaptopPage {
  return { layouts: [aimChrome(context)], update: () => undefined };
}

export function aimHomePage(context: LaptopContext): LaptopPage {
  const ads = new AimAds();
  const model: Record<string, unknown> = {};
  const refresh = (now: number) => {
    const view = context.view();
    ads.update(now, context.client.clock()?.day ?? 0, view?.bobbyRay.open ?? false);
    const shown = ads.shown;
    model.adWarning = shown.ad === AimAd.WARNING_BOX;
    model.adFlower = shown.ad === AimAd.FLOWER_SHOP;
    model.adForAds = shown.ad === AimAd.FOR_ADS;
    model.adInsurance = shown.ad === AimAd.INSURANCE;
    model.adFuneral = shown.ad === AimAd.FUNERAL;
    model.adBobbyRay = shown.ad === AimAd.BOBBY_RAY;
    model.adFrame = shown.frame;
    model.textFlower = shown.text === 'flower';
    model.textBobbyRay1 = shown.text === 'bobbyRay1';
    model.textBobbyRay2 = shown.text === 'bobbyRay2';
    model.bannerEnabled = ads.clickable;
  };
  const controller = new ViewModelController(AIM_HOME_CONTRACT, model, {
    members: () => context.shell.setPage(LaptopMode.AIM_MEMBERS_SORTED_FILES),
    policies: () => context.shell.setPage(LaptopMode.AIM_POLICIES),
    history: () => context.shell.setPage(LaptopMode.AIM_HISTORY),
    links: () => context.shell.setPage(LaptopMode.AIM_LINKS),
    banner: () => {
      const page = BANNER_PAGES[ads.current];
      if (page !== undefined) context.shell.goToWebPage(page);
    },
  });
  refresh(context.services.clock.ja2Now);
  return {
    layouts: [aimChrome(context), { name: AIM_HOME_LAYOUT, controller }],
    update: (now) => refresh(now),
  };
}

function aimMercs(view: LaptopView | null): readonly AimMercView[] {
  return view?.aim ?? [];
}

export function aimSortPage(context: LaptopContext): LaptopPage {
  const memory = context.aim.memory;
  context.aim.resetOrder(aimMercs(context.view()));
  const font = context.services.fonts.get(FontName.FONT10ARIAL);
  const labelWidth = (i: number) => stringPixLength(context.string(SORT_LABELS, i), font);
  const rightAligned = (i: number) => i >= AIM_ASCEND;
  const model: Record<string, unknown> = {
    regionWidths: Array.from({ length: SORT_ENTRIES }, (_, i) => SORT_CHECKBOX_SIZE + SORT_LABEL_GAP + labelWidth(i)),
    regionShifts: Array.from({ length: SORT_ENTRIES }, (_, i) => (rightAligned(i) ? -(SORT_LABEL_GAP + labelWidth(i)) : 0)),
  };
  const refresh = () => {
    model.lights = Array.from({ length: SORT_ENTRIES }, (_, i) => i === memory.sortCriterion || i === memory.listMode);
  };
  const controller = new ViewModelController(AIM_SORT_CONTRACT, model, {
    sortBy: ([i]) => {
      const entry = i ?? 0;
      if (entry === AIM_ASCEND || entry === AIM_DESCEND) memory.listMode = entry;
      else memory.sortCriterion = entry;
    },
    mugShots: () => context.shell.setPage(LaptopMode.AIM_MEMBERS_FACIAL_INDEX),
    stats: () => context.shell.setPage(LaptopMode.AIM_MEMBERS),
    alumni: () => context.shell.setPage(LaptopMode.AIM_MEMBERS_ARCHIVES),
  });
  refresh();
  return {
    layouts: [aimChrome(context), { name: AIM_SORT_LAYOUT, controller }, aimBar(context, LaptopMode.AIM_MEMBERS_SORTED_FILES)],
    update: refresh,
    dispose: () => context.aim.sortOrder(aimMercs(context.view())),
  };
}

export interface MugShot {
  readonly present: boolean;
  readonly face: number;
  readonly state: PortraitState;
  readonly border: number;
  readonly nickname: string;
  readonly overlay: string;
}

export function mugShotState(merc: AimMercView): PortraitState {
  if (merc.face === 'dead') return 'dead';
  return merc.face === 'available' ? 'normal' : 'shaded';
}

export function aimIndexPage(context: LaptopContext): LaptopPage {
  const memory = context.aim.memory;
  let hovered = -1;
  const model: Record<string, unknown> = {};
  const overlay = (merc: AimMercView): string => {
    switch (merc.face) {
      case 'dead':
        return context.string(AIM_FI_TEXT, AIM_FI_DEAD);
      case 'pow':
        return context.string(POW_STRINGS, 0);
      case 'hired':
        return context.string(MERC_INFO, MERC_FILES_ALREADY_HIRED);
      case 'onAssignment':
        return context.string(AIM_FI_TEXT, AIM_FI_DEAD + 1);
      default:
        return '';
    }
  };
  const faces = () =>
    context.aim
      .ordered(aimMercs(context.view()))
      .slice(0, MAX_NUMBER_MERCS)
      .map((merc) => context.data.profile(merc.profile)?.faceIndex ?? merc.profile);
  void context.media.loadImages(faces().map((face) => `faces/${String(face).padStart(2, '0')}.sti`));
  const refresh = () => {
    const mercs = context.aim.ordered(aimMercs(context.view()));
    model.mugRows = Array.from({ length: MUG_ROWS }, (_, row) =>
      Array.from({ length: MUG_COLUMNS }, (_, column): MugShot => {
        const index = row * MUG_COLUMNS + column;
        const merc = mercs[index];
        if (!merc) return { present: false, face: -1, state: 'normal', border: MUG_NORMAL, nickname: '', overlay: '' };
        return {
          present: true,
          face: context.data.profile(merc.profile)?.faceIndex ?? merc.profile,
          state: mugShotState(merc),
          border: hovered === index ? MUG_HOVER : MUG_NORMAL,
          nickname: merc.nickname,
          overlay: overlay(merc),
        };
      }),
    );
    const sortedBy = context.string(AIM_FI_TEXT, memory.sortCriterion);
    const template = context.string(AIM_FI_TEXT, memory.listMode === AIM_ASCEND ? AIM_FI_SORTED_ASCENDING : AIM_FI_SORTED_DESCENDING);
    model.sortedTitle = template.replace('%s', sortedBy);
  };
  const controller = new ViewModelController(AIM_INDEX_CONTRACT, model, {
    selectFace: ([row, column]) => {
      memory.index = (row ?? 0) * MUG_COLUMNS + (column ?? 0);
      context.shell.setPage(LaptopMode.AIM_MEMBERS);
    },
    hoverFace: ([row, column, on]) => {
      const index = (row ?? 0) * MUG_COLUMNS + (column ?? 0);
      if (on) hovered = index;
      else if (hovered === index) hovered = -1;
    },
    sortPage: () => context.shell.setPage(LaptopMode.AIM_MEMBERS_SORTED_FILES),
  });
  refresh();
  return {
    layouts: [aimChrome(context), { name: AIM_INDEX_LAYOUT, controller }, aimBar(context, LaptopMode.AIM_MEMBERS_FACIAL_INDEX)],
    update: refresh,
  };
}

export function aimLinksPage(context: LaptopContext): LaptopPage {
  const controller = new ViewModelController(
    AIM_LINKS_CONTRACT,
    {},
    {
      link: ([i]) => {
        const page = LINK_PAGES[i ?? 0];
        if (page !== undefined) context.shell.goToWebPage(page);
      },
    },
  );
  return {
    layouts: [aimChrome(context), { name: AIM_LINKS_LAYOUT, controller }, aimBar(context, LaptopMode.AIM_LINKS)],
    update: () => undefined,
  };
}
