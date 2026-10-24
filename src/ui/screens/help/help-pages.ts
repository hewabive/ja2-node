// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/HelpScreen.h HelpScreenID; src/game/HelpScreen.cc gHelpScreenBtnTextRecordNum (the page button labels),
// @src DisplayCurrentScreenTitleAndFooter (the titles), RenderLaptopHelpScreen, RenderMapScreenHelpScreen,
// @src RenderMapScreenNoOneHiredYetHelpScreen, RenderMapScreenNotYetInArulcoHelpScreen,
// @src RenderMapScreenSectorInventoryHelpScreen, RenderTacticalHelpScreen (the paragraphs of each page: a loop adds one
// @src font height after every paragraph, the laptop's one-paragraph pages do not), SetSizeAndPropertiesOfHelpScreen
// @src (the page buttons per screen; the three map screen notes are small screens without buttons). See docs/28 §4.7.

export type HelpScreenKind = 'laptop' | 'map' | 'mapNoOneHired' | 'mapNotInArulco' | 'sectorInventory' | 'tactical';

export interface HelpParagraphs {
  readonly first: string;
  readonly count: number;
  readonly spaced: boolean;
}

export interface HelpScreenPages {
  readonly id: string;
  readonly title: string;
  readonly buttons: readonly string[];
  readonly pages: readonly HelpParagraphs[];
  readonly cursor: 'normal' | 'laptop';
}

function spaced(first: string, count: number): HelpParagraphs {
  return { first, count, spaced: true };
}

function single(first: string): HelpParagraphs {
  return { first, count: 1, spaced: false };
}

function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

export const HELP_SCREENS: Readonly<Record<HelpScreenKind, HelpScreenPages>> = {
  laptop: {
    id: 'HELP_SCREEN_LAPTOP',
    title: 'HLP_TXT_LAPTOP_TITLE',
    buttons: numbered('HLP_TXT_LAPTOP_BUTTON_', 8),
    pages: [
      spaced('HLP_TXT_LAPTOP_OVERVIEW_P1', 2),
      single('HLP_TXT_LAPTOP_EMAIL_P1'),
      single('HLP_TXT_LAPTOP_WEB_P1'),
      single('HLP_TXT_LAPTOP_FILES_P1'),
      single('HLP_TXT_LAPTOP_HISTORY_P1'),
      single('HLP_TXT_LAPTOP_PERSONNEL_P1'),
      spaced('HLP_TXT_FINANCES_P1', 2),
      spaced('HLP_TXT_MERC_STATS_P1', 15),
    ],
    cursor: 'laptop',
  },
  map: {
    id: 'HELP_SCREEN_MAPSCREEN',
    title: 'HLP_TXT_WELCOM_TO_ARULCO_TITLE',
    buttons: numbered('HLP_TXT_WELCOM_TO_ARULCO_BUTTON_', 8),
    pages: [
      spaced('HLP_TXT_WELCOM_TO_ARULCO_OVERVIEW_P1', 3),
      spaced('HLP_TXT_WELCOM_TO_ARULCO_ASSNMNT_P1', 4),
      spaced('HLP_TXT_WELCOM_TO_ARULCO_DSTINATION_P1', 5),
      spaced('HLP_TXT_WELCOM_TO_ARULCO_MAP_P1', 3),
      spaced('HLP_TXT_WELCOM_TO_ARULCO_MILITIA_P1', 3),
      spaced('HLP_TXT_WELCOM_TO_ARULCO_AIRSPACE_P1', 2),
      spaced('HLP_TXT_WELCOM_TO_ARULCO_ITEMS_P1', 1),
      spaced('HLP_TXT_WELCOM_TO_ARULCO_KEYBOARD_P1', 4),
    ],
    cursor: 'normal',
  },
  mapNoOneHired: {
    id: 'HELP_SCREEN_MAPSCREEN_NO_ONE_HIRED',
    title: 'HLP_TXT_MPSCRN_NO_1_HIRED_YET_TITLE',
    buttons: [],
    pages: [spaced('HLP_TXT_MPSCRN_NO_1_HIRED_YET_P1', 2)],
    cursor: 'normal',
  },
  mapNotInArulco: {
    id: 'HELP_SCREEN_MAPSCREEN_NOT_IN_ARULCO',
    title: 'HLP_TXT_MPSCRN_NOT_IN_ARULCO_TITLE',
    buttons: [],
    pages: [spaced('HLP_TXT_MPSCRN_NOT_IN_ARULCO_P1', 3)],
    cursor: 'normal',
  },
  sectorInventory: {
    id: 'HELP_SCREEN_MAPSCREEN_SECTOR_INVENTORY',
    title: 'HLP_TXT_SECTOR_INVTRY_TITLE',
    buttons: [],
    pages: [spaced('HLP_TXT_SECTOR_INVTRY_OVERVIEW_P1', 2)],
    cursor: 'normal',
  },
  tactical: {
    id: 'HELP_SCREEN_TACTICAL',
    title: 'HLP_TXT_TACTICAL_TITLE',
    buttons: numbered('HLP_TXT_TACTICAL_BUTTON_', 6),
    pages: [
      spaced('HLP_TXT_TACTICAL_OVERVIEW_P1', 4),
      spaced('HLP_TXT_TACTICAL_MOVEMENT_P1', 4),
      spaced('HLP_TXT_TACTICAL_SIGHT_P1', 4),
      spaced('HLP_TXT_TACTICAL_ATTACKING_P1', 3),
      spaced('HLP_TXT_TACTICAL_ITEMS_P1', 4),
      spaced('HLP_TXT_TACTICAL_KEYBOARD_P1', 8),
    ],
    cursor: 'normal',
  },
};

export interface MapHelpFacts {
  readonly sectorInventoryOpen: boolean;
  readonly anyMercsHired: boolean;
  readonly gameJustStarted: boolean;
}

export function mapHelpScreen(facts: MapHelpFacts): HelpScreenKind {
  if (facts.sectorInventoryOpen) return 'sectorInventory';
  if (!facts.anyMercsHired) return 'mapNoOneHired';
  if (facts.gameJustStarted) return 'mapNotInArulco';
  return 'map';
}
