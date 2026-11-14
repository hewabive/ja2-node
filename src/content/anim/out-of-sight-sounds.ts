// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc the sound codes that play whether or not the player sees the soldier: 702 (fall
// @src to the knees), 709 (the throwing knife), 721 (fall to the ground), 722 (heavy fall), 781, 782 and 784 (a dying
// @src creature's cry, dissolve and fall).

export const OUT_OF_SIGHT_SOUND_CODES = {
  fallToKnees: 702,
  knifeThrow: 709,
  fallToGround: 721,
  heavyFall: 722,
  creatureDying: 781,
  creatureDissolving: 782,
  creatureFalling: 784,
} as const;

export type OutOfSightSound = keyof typeof OUT_OF_SIGHT_SOUND_CODES;

const SOUND_OF_CODE: ReadonlyMap<number, OutOfSightSound> = new Map(
  Object.entries(OUT_OF_SIGHT_SOUND_CODES).map(([sound, code]) => [code, sound as OutOfSightSound]),
);

export function outOfSightSoundOf(code: number): OutOfSightSound | null {
  return SOUND_OF_CODE.get(code) ?? null;
}
