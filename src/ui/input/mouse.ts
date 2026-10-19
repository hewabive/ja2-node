// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/MouseSystem.h MSYS_PRIORITY_*, MSYS_NO_CURSOR, MSYS_*_BUTTON, MSYS_CALLBACK_REASON_*; src/sgp/Input.cc
// @src BUTTON_REPEAT_TIMEOUT, BUTTON_REPEAT_TIME; src/sgp/MouseSystem.cc MSYS_DOUBLECLICK_DELAY, gsFastHelpDelay.
// See docs/28 §3.1.

export const Priority = { LOWEST: 0, LOW: 15, NORMAL: 31, HIGH: 63, HIGHEST: 127 } as const;

export const NO_CURSOR = 65534;

export const MouseButtonMask = { LEFT: 1 << 0, RIGHT: 1 << 1, MIDDLE: 1 << 2, X1: 1 << 3, X2: 1 << 4 } as const;

export const MouseReason = {
  NONE: 0,
  MOVE: 1 << 0,
  LBUTTON_DWN: 1 << 1,
  LBUTTON_UP: 1 << 2,
  LBUTTON_REPEAT: 1 << 3,
  LBUTTON_DOUBLECLICK: 1 << 4,
  RBUTTON_DWN: 1 << 5,
  RBUTTON_UP: 1 << 6,
  RBUTTON_REPEAT: 1 << 7,
  MBUTTON_DWN: 1 << 8,
  MBUTTON_UP: 1 << 9,
  MBUTTON_REPEAT: 1 << 10,
  X1BUTTON_DWN: 1 << 11,
  X1BUTTON_UP: 1 << 12,
  X1BUTTON_REPEAT: 1 << 13,
  X2BUTTON_DWN: 1 << 14,
  X2BUTTON_UP: 1 << 15,
  X2BUTTON_REPEAT: 1 << 16,
  LOST_MOUSE: 1 << 17,
  GAIN_MOUSE: 1 << 18,
  WHEEL_UP: 1 << 19,
  WHEEL_DOWN: 1 << 20,
} as const;

export const POINTER_DWN = MouseReason.LBUTTON_DWN;
export const POINTER_UP = MouseReason.LBUTTON_UP;
export const POINTER_REPEAT = MouseReason.LBUTTON_REPEAT;

export const BUTTON_REPEAT_TIMEOUT_MS = 250;
export const BUTTON_REPEAT_TIME_MS = 50;
export const DOUBLE_CLICK_DELAY_MS = 400;
export const FAST_HELP_DELAY_MS = 600;
