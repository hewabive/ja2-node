// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc AdjustToNextAnimationFrame opcodes 758 (the Queen's record after a slap) and 759
// @src (Elliot takes the slap).

import type { OpOutcome } from '../../../content/anim/script.ts';
import { Approach } from '../../../content/narrative/npc-constants.ts';
import { anim } from '../anim-states.ts';
import { initNewSoldierAnim } from '../animation.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { Profile } from './constants.ts';

const TRIGGER_AFTER_SLAP = 758;
const SLAPPED = 759;

function placedProfile(t: TacticalState, profile: number): Soldier | null {
  return t.soldiers.find((s) => s?.placed && s.profile === profile) ?? null;
}

function takeTheSlap(t: TacticalState): void {
  const elliot = placedProfile(t, Profile.ELLIOT);
  if (elliot) initNewSoldierAnim(t, elliot, anim(t.content, 'SLAP_HIT'), 0, false);
}

export function queenSlapOpcode(t: TacticalState, _s: Soldier, code: number): OpOutcome | null {
  switch (code) {
    case TRIGGER_AFTER_SLAP:
      t.narrative.triggerNpcWithGivenApproach(Profile.QUEEN, Approach.DONE_SLAPPED);
      return 'continue';
    case SLAPPED:
      takeTheSlap(t);
      return 'continue';
    default:
      return null;
  }
}
