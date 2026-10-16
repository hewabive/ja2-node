// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/SkillCheck.cc SkillCheck (UNJAM_GUN_CHECK, NOTICE_DART_CHECK). See docs/11 §1.7, §8.5.

import { effectiveExpLevel, effectiveMechanical, effectiveWisdom, moraleModifier, skillCheckFatiguePenalty } from '../skills.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

export const SkillCheckReason = { UNJAM_GUN: 4, NOTICE_DART: 5 } as const;

export function skillCheck(t: TacticalState, s: Soldier, reason: number, mod: number): number {
  let skill = 0;
  if (reason === SkillCheckReason.UNJAM_GUN) skill = 30 + Math.trunc(effectiveMechanical(s) / 2);
  else if (reason === SkillCheckReason.NOTICE_DART) skill = Math.trunc(effectiveWisdom(s) / 10) + effectiveExpLevel(s);
  skill -= skillCheckFatiguePenalty(s, skill);
  let chance = skill + mod + moraleModifier(s);
  if (chance > 99) chance = 99;
  else if (chance < 0) chance = 0;
  const roll = t.pre.int(100);
  const madeItBy = chance - roll;
  if (madeItBy < 0) {
    if (s.lastSkillCheck === reason && s.gridNo === s.skillCheckGridNo) s.skillCheckAttempts++;
    else {
      s.lastSkillCheck = reason;
      s.skillCheckAttempts = 1;
      s.skillCheckGridNo = s.gridNo;
    }
  }
  return madeItBy;
}
