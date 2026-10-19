// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Button_Sound_Control.cc SpecifyButtonSoundScheme (the generic scheme chosen by the current screen),
// @src PlayButtonSound (the in and out samples per scheme, "disabled button.wav", volume 15, middle pan);
// @src src/sgp/Button_Sound_Control.h ButtonSoundScheme, ButtonSound. See docs/28 §3.3.

export const ButtonSoundScheme = {
  NONE: 'none',
  GENERIC: 'generic',
  VERYSMALLSWITCH1: 'verySmallSwitch1',
  VERYSMALLSWITCH2: 'verySmallSwitch2',
  SMALLSWITCH1: 'smallSwitch1',
  SMALLSWITCH2: 'smallSwitch2',
  SMALLSWITCH3: 'smallSwitch3',
  BIGSWITCH3: 'bigSwitch3',
  COMPUTERBEEP2: 'computerBeep2',
  COMPUTERSWITCH1: 'computerSwitch1',
} as const;
export type ButtonSoundScheme = (typeof ButtonSoundScheme)[keyof typeof ButtonSoundScheme];

export type ButtonSound = 'clickedOn' | 'clickedOff' | 'disabledClick';

export const UiScreenKind = {
  MAINMENU: 'MAINMENU_SCREEN',
  OPTIONS: 'OPTIONS_SCREEN',
  LOADSAVE: 'LOADSAVE_SCREEN',
  SAVE_LOAD: 'SAVE_LOAD_SCREEN',
  INIT: 'INIT_SCREEN',
  LAPTOP: 'LAPTOP_SCREEN',
  AUTORESOLVE: 'AUTORESOLVE_SCREEN',
  MAP: 'MAP_SCREEN',
  GAME: 'GAME_SCREEN',
  SHOPKEEPER: 'SHOPKEEPER_SCREEN',
  GAME_INIT_OPTIONS: 'GAME_INIT_OPTIONS_SCREEN',
  MSG_BOX: 'MSG_BOX_SCREEN',
  OTHER: 'OTHER',
} as const;
export type UiScreenKind = (typeof UiScreenKind)[keyof typeof UiScreenKind];

export const BUTTON_SOUND_VOLUME = 15;
export const DISABLED_BUTTON_SOUND = 'sounds/disabled button.wav';

const GENERIC_BY_SCREEN: Readonly<Partial<Record<UiScreenKind, ButtonSoundScheme>>> = {
  MAINMENU_SCREEN: ButtonSoundScheme.BIGSWITCH3,
  OPTIONS_SCREEN: ButtonSoundScheme.BIGSWITCH3,
  LOADSAVE_SCREEN: ButtonSoundScheme.BIGSWITCH3,
  SAVE_LOAD_SCREEN: ButtonSoundScheme.BIGSWITCH3,
  INIT_SCREEN: ButtonSoundScheme.BIGSWITCH3,
  LAPTOP_SCREEN: ButtonSoundScheme.COMPUTERBEEP2,
  AUTORESOLVE_SCREEN: ButtonSoundScheme.SMALLSWITCH2,
  MAP_SCREEN: ButtonSoundScheme.SMALLSWITCH2,
  GAME_SCREEN: ButtonSoundScheme.SMALLSWITCH2,
  SHOPKEEPER_SCREEN: ButtonSoundScheme.SMALLSWITCH2,
  GAME_INIT_OPTIONS_SCREEN: ButtonSoundScheme.VERYSMALLSWITCH2,
};

const SAMPLES: Readonly<Partial<Record<ButtonSoundScheme, readonly [string, string]>>> = {
  verySmallSwitch1: ['VSM_SWITCH1_IN', 'VSM_SWITCH1_OUT'],
  verySmallSwitch2: ['VSM_SWITCH2_IN', 'VSM_SWITCH2_OUT'],
  smallSwitch1: ['SM_SWITCH1_IN', 'SM_SWITCH1_OUT'],
  smallSwitch2: ['SM_SWITCH2_IN', 'SM_SWITCH2_OUT'],
  smallSwitch3: ['SM_SWITCH3_IN', 'SM_SWITCH3_OUT'],
  bigSwitch3: ['BIG_SWITCH3_IN', 'BIG_SWITCH3_OUT'],
  computerBeep2: ['COMPUTER_BEEP2_IN', 'COMPUTER_BEEP2_OUT'],
  computerSwitch1: ['COMPUTER_SWITCH1_IN', 'COMPUTER_SWITCH1_OUT'],
};

export type ButtonSoundRequest =
  | { readonly sample: string; readonly volume: number }
  | { readonly file: string; readonly volume: number; readonly speech?: boolean };

export interface UiSoundSink {
  play(request: ButtonSoundRequest): void;
}

export const SILENT: UiSoundSink = { play: () => undefined };

export function resolveScheme(scheme: ButtonSoundScheme, screen: UiScreenKind): ButtonSoundScheme {
  if (scheme !== ButtonSoundScheme.GENERIC) return scheme;
  return GENERIC_BY_SCREEN[screen] ?? ButtonSoundScheme.GENERIC;
}

export function isAudible(scheme: ButtonSoundScheme): boolean {
  return scheme !== ButtonSoundScheme.NONE;
}

export function buttonSoundRequest(scheme: ButtonSoundScheme, sound: ButtonSound): ButtonSoundRequest | null {
  const samples = SAMPLES[scheme];
  if (!samples) return null;
  if (sound === 'disabledClick') return { file: DISABLED_BUTTON_SOUND, volume: BUTTON_SOUND_VOLUME };
  return { sample: sound === 'clickedOn' ? samples[0] : samples[1], volume: BUTTON_SOUND_VOLUME };
}
