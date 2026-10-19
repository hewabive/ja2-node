// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc ItemSlotLimit

const FIRST_BIG_POCKET = 7;
const FIRST_SMALL_POCKET = 11;

export function slotLimitOf(perPocket: number, pos: number): number {
  if (pos < FIRST_BIG_POCKET) return 1;
  return pos >= FIRST_SMALL_POCKET && perPocket > 1 ? Math.trunc(perPocket / 2) : perPocket;
}
