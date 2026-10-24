// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Laptop.h LaptopMode, the bookmark enum; src/game/Laptop/Laptop.cc the LAPTOP_PROGRAM_* enums,
// @src EnterNewLaptopMode (the program, title and icon of each mode), BlitTitleBarIcons, HandleSlidingTitleBar (the
// @src side button each title bar slides from), HandleAltTabKeyInLaptop, HandleShiftAltTabKeyInLaptop,
// @src LaptopMinimizeProgramButtonCallback (the minimized titles). See docs/28 §9.1.

export const LaptopMode = {
  NONE: 0,
  FINANCES: 1,
  PERSONNEL: 2,
  HISTORY: 3,
  FILES: 4,
  EMAIL: 7,
  WWW: 10,
  AIM: 11,
  AIM_MEMBERS: 12,
  AIM_MEMBERS_FACIAL_INDEX: 13,
  AIM_MEMBERS_SORTED_FILES: 14,
  AIM_MEMBERS_ARCHIVES: 16,
  AIM_POLICIES: 17,
  AIM_HISTORY: 18,
  AIM_LINKS: 19,
  MERC: 20,
  BOBBY_R: 24,
  CHAR_PROFILE: 31,
  FLORIST: 33,
  INSURANCE: 37,
  FUNERAL: 41,
  BROKEN_LINK: 42,
  END: 44,
  MERC_ACCOUNT: 21,
  MERC_NO_ACCOUNT: 22,
  MERC_FILES: 23,
  BOBBY_R_GUNS: 25,
  BOBBY_R_AMMO: 26,
  BOBBY_R_ARMOR: 27,
  BOBBY_R_MISC: 28,
  BOBBY_R_USED: 29,
  BOBBY_R_MAILORDER: 30,
  BOBBYR_SHIPMENTS: 43,
} as const;

export const LaptopProgram = { MAILER: 0, WEB_BROWSER: 1, FILES: 2, PERSONNEL: 3, FINANCES: 4, HISTORY: 5 } as const;
export const LAPTOP_PROGRAMS = 6;

export const Bookmark = { AIM: 0, BOBBYR: 1, IMP: 2, MERC: 3, FUNERAL: 4, FLORIST: 5, INSURANCE: 6, CANCEL: 7 } as const;

export const BOOKMARK_IDS: Readonly<Record<string, number>> = {
  aim: Bookmark.AIM,
  bobbyRay: Bookmark.BOBBYR,
  imp: Bookmark.IMP,
  merc: Bookmark.MERC,
  funeral: Bookmark.FUNERAL,
  florist: Bookmark.FLORIST,
  insurance: Bookmark.INSURANCE,
};

export const BOOKMARK_MODES: Readonly<Record<number, number>> = {
  [Bookmark.AIM]: LaptopMode.AIM,
  [Bookmark.BOBBYR]: LaptopMode.BOBBY_R,
  [Bookmark.IMP]: LaptopMode.CHAR_PROFILE,
  [Bookmark.MERC]: LaptopMode.MERC,
  [Bookmark.FUNERAL]: LaptopMode.FUNERAL,
  [Bookmark.FLORIST]: LaptopMode.FLORIST,
  [Bookmark.INSURANCE]: LaptopMode.INSURANCE,
};

export const VISITED_SITES: Readonly<Record<number, string>> = {
  [Bookmark.BOBBYR]: 'bobbyRay',
  [Bookmark.MERC]: 'merc',
  [Bookmark.FUNERAL]: 'funeral',
  [Bookmark.FLORIST]: 'florist',
  [Bookmark.INSURANCE]: 'insurance',
};

export interface ProgramTitle {
  readonly program: number;
  readonly title: { readonly table: string; readonly index: number };
  readonly minimizedTitle: { readonly table: string; readonly index: number };
  readonly icon: number;
}

const LAPTOP_TITLES = 'pLaptopTitles';
const LAPTOP_ICONS = 'pLaptopIcons';
const WEB_TITLE = 'pWebTitle';

const PROGRAM_TITLES: Readonly<Record<number, ProgramTitle>> = {
  [LaptopMode.EMAIL]: {
    program: LaptopProgram.MAILER,
    title: { table: LAPTOP_TITLES, index: 0 },
    minimizedTitle: { table: LAPTOP_ICONS, index: 0 },
    icon: 0,
  },
  [LaptopMode.FILES]: {
    program: LaptopProgram.FILES,
    title: { table: LAPTOP_TITLES, index: 1 },
    minimizedTitle: { table: LAPTOP_ICONS, index: 5 },
    icon: 2,
  },
  [LaptopMode.PERSONNEL]: {
    program: LaptopProgram.PERSONNEL,
    title: { table: LAPTOP_TITLES, index: 2 },
    minimizedTitle: { table: LAPTOP_ICONS, index: 3 },
    icon: 3,
  },
  [LaptopMode.FINANCES]: {
    program: LaptopProgram.FINANCES,
    title: { table: LAPTOP_TITLES, index: 3 },
    minimizedTitle: { table: LAPTOP_ICONS, index: 2 },
    icon: 5,
  },
  [LaptopMode.HISTORY]: {
    program: LaptopProgram.HISTORY,
    title: { table: LAPTOP_TITLES, index: 4 },
    minimizedTitle: { table: LAPTOP_ICONS, index: 4 },
    icon: 4,
  },
};

const WEB_PROGRAM: ProgramTitle = {
  program: LaptopProgram.WEB_BROWSER,
  title: { table: WEB_TITLE, index: 0 },
  minimizedTitle: { table: LAPTOP_ICONS, index: 7 },
  icon: 1,
};

export function isWebMode(mode: number): boolean {
  return mode >= LaptopMode.WWW;
}

export function programTitle(mode: number): ProgramTitle | null {
  if (mode === LaptopMode.NONE) return null;
  return PROGRAM_TITLES[mode] ?? WEB_PROGRAM;
}

export function webPageTitleIndex(mode: number): number | null {
  return mode > LaptopMode.WWW ? mode - LaptopMode.WWW - 1 : null;
}

export const SLIDE_START_Y: Readonly<Record<number, { readonly maximize: number; readonly minimize: number }>> = {
  [LaptopProgram.MAILER]: { maximize: 66, minimize: 66 },
  [LaptopProgram.FILES]: { maximize: 120, minimize: 130 },
  [LaptopProgram.FINANCES]: { maximize: 226, minimize: 226 },
  [LaptopProgram.PERSONNEL]: { maximize: 194, minimize: 194 },
  [LaptopProgram.HISTORY]: { maximize: 162, minimize: 162 },
  [LaptopProgram.WEB_BROWSER]: { maximize: 99, minimize: 99 },
};

const TAB_NEXT: Readonly<Record<number, number>> = {
  [LaptopMode.FINANCES]: LaptopMode.EMAIL,
  [LaptopMode.PERSONNEL]: LaptopMode.FINANCES,
  [LaptopMode.HISTORY]: LaptopMode.PERSONNEL,
  [LaptopMode.EMAIL]: LaptopMode.WWW,
  [LaptopMode.FILES]: LaptopMode.HISTORY,
  [LaptopMode.NONE]: LaptopMode.EMAIL,
};

const TAB_PREVIOUS: Readonly<Record<number, number>> = {
  [LaptopMode.FINANCES]: LaptopMode.PERSONNEL,
  [LaptopMode.PERSONNEL]: LaptopMode.HISTORY,
  [LaptopMode.HISTORY]: LaptopMode.FILES,
  [LaptopMode.EMAIL]: LaptopMode.FINANCES,
  [LaptopMode.FILES]: LaptopMode.WWW,
  [LaptopMode.NONE]: LaptopMode.FINANCES,
  [LaptopMode.WWW]: LaptopMode.EMAIL,
};

export function tabTarget(mode: number, backwards: boolean): number {
  if (backwards) return TAB_PREVIOUS[mode] ?? LaptopMode.EMAIL;
  return TAB_NEXT[mode] ?? LaptopMode.FILES;
}
