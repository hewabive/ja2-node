// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-10. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc SetUIMouseCursor (the exit grid cursor only over a tile outside rooms or revealed)

export const NO_ROOM = 0;

export function exitGridCursorShownOver(room: number, tileRevealed: boolean): boolean {
  return room === NO_ROOM || tileRevealed;
}
