// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic.h INSERTION_CODE_*.

export const Insertion = {
  NORTH: 0,
  SOUTH: 1,
  EAST: 2,
  WEST: 3,
  GRIDNO: 4,
  ARRIVING_GAME: 5,
  CHOPPER: 6,
  PRIMARY_EDGEINDEX: 7,
  SECONDARY_EDGEINDEX: 8,
  CENTER: 9,
} as const;
