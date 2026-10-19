// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Cursors.h CursorTypeDefines (the ids code names; layouts name every cursor through
// @src data/tables/cursors.json); src/sgp/Video.h VIDEO_NO_CURSOR, VIDEO_DEFAULT_TO_NO_CURSOR; src/sgp/Cursor_Control.h
// @src EXTERN_CURSOR. See docs/28 §3.5.

export const CursorId = {
  NORMAL: 0,
  TARGET: 1,
  RUN1: 31,
  WWW: 47,
  LAPTOP_SCREEN: 48,
  IBEAM: 49,
  EXIT_NORTH: 54,
  FLASH_TARGET: 70,
  CHECKMARK: 74,
  WAIT: 122,
  X: 133,
  WAIT_NODELAY: 134,
} as const;

export const VIDEO_NO_CURSOR = 0xffff;
export const VIDEO_DEFAULT_TO_NO_CURSOR = 0xfffe;
export const EXTERN_CURSOR = 0xfff0;
