// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-29. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Merc_Handler.cc HourlyCamouflageUpdate

import { numSkillTraits, SkillTrait, type Soldier } from '../tactical/soldier.ts';

const CAMO_WORN_PER_HOUR = 2;

function wearCamouflage(s: Soldier, wornOff: (s: Soldier) => void): void {
  if (s.camo > CAMO_WORN_PER_HOUR) {
    s.camo -= CAMO_WORN_PER_HOUR;
    return;
  }
  s.camo = 0;
  wornOff(s);
}

export function hourlyCamouflageUpdate(team: readonly Soldier[], wornOff: (s: Soldier) => void): void {
  for (const s of team) {
    if (s.camo > 0 && numSkillTraits(s, SkillTrait.CAMOUFLAGED) === 0) wearCamouflage(s, wornOff);
    if (s.monsterSmell > 0) s.monsterSmell--;
  }
}
