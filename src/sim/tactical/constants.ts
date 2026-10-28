// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CalculateSoldierAniSpeed (terrain speeds); Overhead.cc gdRadiansForAngle with
// @src sgp/Types.h PI, evaluated with glibc sin/cos

export const TERRAIN_SPEED_DELAY: readonly number[] = [5, 5, 5, 5, 5, 10, 15, 20, 20, 25, 30];

export const MOVE_SIN_COS: readonly (readonly [number, number])[] = [
  [1.5099579909783707e-7, -0.9999999999999886],
  [0.7071067769704656, -0.7071067854026294],
  [0.9999999999999971, 7.549789954891874e-8],
  [0.7071067544940086, 0.7071068078790854],
  [0, 1],
  [-0.7071067544940086, 0.7071068078790854],
  [-0.9999999999999971, 7.549789954891874e-8],
  [-0.7071067769704656, -0.7071067854026294],
];
