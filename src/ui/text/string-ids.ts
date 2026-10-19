// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Text.h (the SLG_, GIO_, OPT_, MSG_, MERC_ACCOUNT_, STR_LATE_, STR_PB_ and TCTL_MSG__ enums);
// @src src/game/GameSettings.h TOPTION_*; src/game/Laptop/Finances.cc DisplayFinancePageOfRecords (pFinanceHeaders[4]);
// @src src/game/Strategic/Map_Screen_Interface.h UpdateBoxReason.
// See docs/27 §8.3.

export const SaveLoadText = {
  SAVE_GAME: 0,
  LOAD_GAME: 1,
  CANCEL: 2,
  SAVE_SELECTED: 3,
  LOAD_SELECTED: 4,
  SAVE_GAME_OK: 5,
  SAVE_GAME_ERROR: 6,
  LOAD_GAME_OK: 7,
  LOAD_GAME_ERROR: 8,
  GAME_VERSION_DIF: 9,
  CONFIRM_DELETE: 10,
  SAVED_GAME_ISSUE: 11,
  SAVED_GAME_CONTINUE_ANYWAYS: 14,
  CONFIRM_SAVE: 15,
  SAVING_GAME_MESSAGE: 16,
  NORMAL_GUNS: 17,
  ADDITIONAL_GUNS: 18,
  REALISTIC: 19,
  SCIFI: 20,
  DIFF: 21,
} as const;

export const GameInitText = {
  INITIAL_GAME_SETTINGS: 0,
  GAME_STYLE: 1,
  REALISTIC: 2,
  SCI_FI: 3,
  GUN_OPTIONS: 4,
  GUN_NUT: 5,
  REDUCED_GUNS: 6,
  DIF_LEVEL: 7,
  EASY: 8,
  MEDIUM: 9,
  HARD: 10,
  OK: 11,
  CANCEL: 12,
  GAME_SAVE_STYLE: 13,
  SAVE_ANYWHERE: 14,
  IRON_MAN: 15,
  DEAD_IS_DEAD: 16,
} as const;

export const OptionsText = {
  SOUND_FX: 4,
  SPEECH: 5,
  MUSIC: 6,
  NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON: 8,
} as const;

export const OptionToggle = {
  SPEECH: 0,
  MUTE_CONFIRMATIONS: 1,
  SUBTITLES: 2,
  KEY_ADVANCE_SPEECH: 3,
  BLOOD_N_GORE: 5,
  SLEEPWAKE_NOTIFICATION: 11,
} as const;

export const MessageString = {
  OK: 1,
  YES: 2,
  NO: 3,
  SAVE_SUCCESS: 8,
  DAY: 9,
  MERCS: 10,
} as const;

export const MERC_ACCOUNT_MERC = 3;
export const STR_LATE_14 = 13;
export const STR_PB_MERCS = 37;
export const STR_PB_SECTOR = 41;
export const STR_PB_NOTAPPLICABLE_ABBREVIATION = 43;
export const FINANCE_HEADER_BALANCE = 4;
export const TCTL_MSG_IRON_MAN_CANT_SAVE_NOW = 4;
export const DEAD_IS_DEAD_TAB = 1;

export const UpdateBoxReason = {
  ASSIGNMENT_RETURNING: 3,
  ASLEEP_GOING_AUTO: 4,
} as const;
