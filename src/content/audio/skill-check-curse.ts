// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/SkillCheck.cc SkillCheck (fForceDamnSound || Random(100) < 40 before the CURSE1 of a failed
// @src check, drawn by the client).

import type { Rand } from './cue.ts';

const CURSE_RANGE = 100;
const CURSE_BELOW = 40;

export function cursesTheFailedCheck(certain: boolean, rand: Rand): boolean {
  return certain || rand(CURSE_RANGE) < CURSE_BELOW;
}
