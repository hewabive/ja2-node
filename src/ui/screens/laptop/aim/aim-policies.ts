// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMPolicies.cc AimPolicyTextLocations, NUM_AIM_POLICY_PAGES, AIM_POLICY_TOC_PAGE, AIM_POLICY_LAST_PAGE,
// @src EnterAimPolicies (gubCurPageNum = giCurrentSubPage), ExitAimPolicies (giCurrentSubPage = gubCurPageNum), HandleAimPolicies
// @src (the menu bar on every page but the statement), RenderAimPolicies (the paragraph lists of pages 2-10, each next one
// @src AIM_POLICY_PARAGRAPH_GAP below the height of the last), DrawAimPolicyMenu (the section titles of the index),
// @src DisplayAimPolicyStatement, DisplayAimPolicyParagraph ("{2.1f}", nothing for 0.0), DisplayAimPolicySubParagraph
// @src ("{2.2f}"), SelectPolicyTocMenuRegionCallBack, BtnPoliciesAgreeButtonCallback, BtnPoliciesMenuButtonCallback,
// @src DisableAimPolicyButton.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { FontName } from '../../../text/fonts.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { changeSubPage, subPageVisits, wrappedHeight } from './aim-history-support.ts';
import { aimChrome } from './aim-pages.ts';

export const AIM_POLICIES_LAYOUT = 'aim-policies';
export const AIM_POLICY_TEXT_FILE = 'binarydata/aimpol.edt';
export const NUM_AIM_POLICY_PAGES = 11;
export const STATEMENT_PAGE = 0;
export const POLICY_TOC_PAGE = 1;
export const POLICY_LAST_PAGE = 10;
const FIRST_SECTION_PAGE = 2;
const STATEMENT_GAP = 15;
const PARAGRAPH_DECIMALS = 1;
const SUB_PARAGRAPH_DECIMALS = 2;
const TEXT_GAP = 2;
const VISITS_KEY = 'aimPolicies';
const FIRST_STATEMENT = 'AIM_STATEMENT_OF_POLICY_1';

export const PolicyMenu = { PREVIOUS: 0, HOME: 1, INDEX: 2, NEXT: 3 } as const;
const MENU_BUTTONS = 4;
const DISAGREE = 0;

export interface PolicyEntry {
  readonly row: string;
  readonly number: number;
  readonly sub: boolean;
}

export interface PolicySection {
  readonly title: string;
  readonly entries: readonly PolicyEntry[];
}

const p = (row: string, number: number): PolicyEntry => ({ row, number, sub: false });
const s = (row: string, number: number): PolicyEntry => ({ row, number, sub: true });

export const POLICY_SECTIONS: Readonly<Record<number, PolicySection>> = {
  2: {
    title: 'DEFINITIONS',
    entries: [p('DEFINITIONS_1', 1.1), p('DEFINITIONS_2', 1.2), p('DEFINITIONS_3', 1.3), p('DEFINITIONS_4', 1.4)],
  },
  3: {
    title: 'LENGTH_OF_ENGAGEMENT',
    entries: [
      p('LENGTH_OF_ENGAGEMENT_1', 2.1),
      s('LENGTH_OF_ENGAGEMENT_1_1', 2.11),
      s('LENGTH_OF_ENGAGEMENT_1_2', 2.12),
      s('LENGTH_OF_ENGAGEMENT_1_3', 2.13),
      p('LENGTH_OF_ENGAGEMENT_2', 2.2),
    ],
  },
  4: {
    title: 'LOCATION_0F_ENGAGEMENT',
    entries: [
      p('LOCATION_0F_ENGAGEMENT_1', 3.1),
      p('LOCATION_0F_ENGAGEMENT_2', 3.2),
      s('LOCATION_0F_ENGAGEMENT_2_1', 3.21),
      s('LOCATION_0F_ENGAGEMENT_2_2', 3.22),
      s('LOCATION_0F_ENGAGEMENT_2_3', 3.23),
      p('LOCATION_0F_ENGAGEMENT_2_4', 3.3),
      p('LOCATION_0F_ENGAGEMENT_3', 3.4),
    ],
  },
  5: {
    title: 'CONTRACT_EXTENSIONS',
    entries: [p('CONTRACT_EXTENSIONS_1', 4.1), p('CONTRACT_EXTENSIONS_2', 4.2), p('CONTRACT_EXTENSIONS_3', 4.3)],
  },
  6: { title: 'TERMS_OF_PAYMENT', entries: [p('TERMS_OF_PAYMENT_1', 5.1)] },
  7: {
    title: 'TERMS_OF_ENGAGEMENT',
    entries: [p('TERMS_OF_ENGAGEMENT_1', 6.1), p('TERMS_OF_ENGAGEMENT_2A', 6.2), p('TERMS_OF_ENGAGEMENT_2B', 0)],
  },
  8: {
    title: 'ENGAGEMENT_TERMINATION',
    entries: [
      p('ENGAGEMENT_TERMINATION_1', 7.1),
      s('ENGAGEMENT_TERMINATION_1_1', 7.11),
      s('ENGAGEMENT_TERMINATION_1_2', 7.12),
      s('ENGAGEMENT_TERMINATION_1_3', 7.13),
    ],
  },
  9: { title: 'EQUIPMENT_AND_INVENTORY', entries: [p('EQUIPMENT_AND_INVENTORY_1', 8.1), p('EQUIPMENT_AND_INVENTORY_2', 8.2)] },
  10: {
    title: 'POLICY_MEDICAL',
    entries: [
      p('POLICY_MEDICAL_1', 9.1),
      p('POLICY_MEDICAL_2', 9.2),
      p('POLICY_MEDICAL_3A', 9.3),
      p('POLICY_MEDICAL_3B', 0),
      p('POLICY_MEDICAL_4', 9.4),
    ],
  },
};

export const POLICY_INDEX: readonly string[] = [
  'DEFINITIONS',
  'LENGTH_OF_ENGAGEMENT',
  'LOCATION_0F_ENGAGEMENT',
  'CONTRACT_EXTENSIONS',
  'TERMS_OF_PAYMENT',
  'TERMS_OF_ENGAGEMENT',
  'ENGAGEMENT_TERMINATION',
  'EQUIPMENT_AND_INVENTORY',
  'POLICY_MEDICAL',
];

export const AIM_POLICIES_CONTRACT: ControllerContract = {
  id: 'aimPolicies',
  actions: { agree: { args: 1 }, toc: { args: 1 }, menu: { args: 1 } },
  bindings: {
    statementPage: 'boolean',
    secondStatementY: 'number',
    toc: 'boolean',
    tocTitles: 'list',
    section: 'boolean',
    sectionTitle: 'string',
    rows: 'list',
    menuBar: 'boolean',
    menuHeld: 'list',
  },
};

export function sectionNumber(value: number, sub: boolean): string {
  if (value === 0) return '';
  return Math.fround(value).toFixed(sub ? SUB_PARAGRAPH_DECIMALS : PARAGRAPH_DECIMALS);
}

export function stackedTops(heights: readonly number[], start: number, gap: number): number[] {
  let y = start;
  return heights.map((h) => {
    const top = y;
    y += h + gap;
    return top;
  });
}

export function policyMenuHeld(page: number): boolean[] {
  return Array.from(
    { length: MENU_BUTTONS },
    (_, i) =>
      (page === POLICY_TOC_PAGE && (i === PolicyMenu.PREVIOUS || i === PolicyMenu.INDEX)) ||
      (page === POLICY_LAST_PAGE && i === PolicyMenu.NEXT),
  );
}

export function policyMenuTarget(page: number, button: number): number | null {
  switch (button) {
    case PolicyMenu.PREVIOUS:
      return page > POLICY_TOC_PAGE ? page - 1 : null;
    case PolicyMenu.INDEX:
      return page !== POLICY_TOC_PAGE ? POLICY_TOC_PAGE : null;
    case PolicyMenu.NEXT:
      return page < NUM_AIM_POLICY_PAGES - 1 ? page + 1 : null;
    default:
      return null;
  }
}

export function aimPoliciesPage(context: LaptopContext): LaptopPage {
  const constant = (name: string) => context.constant(AIM_POLICIES_LAYOUT, name);
  const visits = subPageVisits(context.shell, VISITS_KEY, NUM_AIM_POLICY_PAGES);
  const font = context.services.fonts.get(FontName.FONT10ARIAL);
  const width = constant('AIM_POLICY_PARAGRAPH_WIDTH');
  const policyText = (row: string) => context.text.edt(AIM_POLICY_TEXT_FILE, constant(row)) ?? '';
  let page = context.shell.subPage;
  const model: Record<string, unknown> = {};
  void context.media.loadTexts([AIM_POLICY_TEXT_FILE]);
  const goTo = (target: number) => {
    page = target;
    changeSubPage(context.shell, visits, page);
  };
  const refresh = () => {
    const statement = page === STATEMENT_PAGE;
    model.statementPage = statement;
    model.secondStatementY =
      constant('AIM_POLICY_TITLE_STATEMENT_Y') +
      wrappedHeight(font, constant('AIM_POLICY_TITLE_STATEMENT_WIDTH'), TEXT_GAP, policyText(FIRST_STATEMENT)) +
      STATEMENT_GAP;
    model.toc = page === POLICY_TOC_PAGE;
    model.tocTitles = POLICY_INDEX.map(policyText);
    const section = POLICY_SECTIONS[page];
    model.section = section !== undefined;
    model.sectionTitle = section ? policyText(section.title) : '';
    const entries = section?.entries ?? [];
    const texts = entries.map((e) => policyText(e.row));
    const tops = stackedTops(
      texts.map((t) => wrappedHeight(font, width, TEXT_GAP, t)),
      constant('AIM_POLICY_PARAGRAPH_Y'),
      constant('AIM_POLICY_PARAGRAPH_GAP'),
    );
    model.rows = entries.map((e, i) => ({
      paragraph: !e.sub,
      sub: e.sub,
      number: sectionNumber(e.number, e.sub),
      text: texts[i] ?? '',
      y: tops[i] ?? 0,
    }));
    model.menuBar = !statement;
    model.menuHeld = policyMenuHeld(page);
  };
  const controller = new ViewModelController(AIM_POLICIES_CONTRACT, model, {
    agree: ([choice]) => {
      if (choice === DISAGREE) context.shell.setPage(LaptopMode.AIM);
      else goTo(page + 1);
    },
    toc: ([i]) => {
      if (page === POLICY_TOC_PAGE) goTo(FIRST_SECTION_PAGE + (i ?? 0));
    },
    menu: ([button]) => {
      if (button === PolicyMenu.HOME) {
        context.shell.setPage(LaptopMode.AIM);
        return;
      }
      const target = policyMenuTarget(page, button ?? PolicyMenu.PREVIOUS);
      if (target !== null) goTo(target);
    },
  });
  refresh();
  return {
    layouts: [aimChrome(context), { name: AIM_POLICIES_LAYOUT, controller }],
    update: refresh,
    dispose: () => {
      context.shell.subPage = page;
    },
  };
}
