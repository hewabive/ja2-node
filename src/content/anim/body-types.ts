// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Data.h SoldierBodyType

export const Body = {
  REGMALE: 0,
  BIGMALE: 1,
  STOCKYMALE: 2,
  REGFEMALE: 3,
  ADULTFEMALEMONSTER: 4,
  AM_MONSTER: 5,
  YAF_MONSTER: 6,
  YAM_MONSTER: 7,
  LARVAE_MONSTER: 8,
  INFANT_MONSTER: 9,
  QUEENMONSTER: 10,
  FATCIV: 11,
  MANCIV: 12,
  MINICIV: 13,
  DRESSCIV: 14,
  HATKIDCIV: 15,
  KIDCIV: 16,
  CRIPPLECIV: 17,
  COW: 18,
  CROW: 19,
  BLOODCAT: 20,
  ROBOTNOWEAPON: 21,
  HUMVEE: 22,
  TANK_NW: 23,
  TANK_NE: 24,
  ELDORADO: 25,
  ICECREAMTRUCK: 26,
  JEEP: 27,
} as const;
