// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc codes 702, 709, 721, 722, 781, 782 and 784, whose samples play at the soldier's
// @src tile whether or not the player sees him (PlaySoldierJA2Sample with no visibility check, PlayLocationJA2Sample);
// @src they make no noise, so the squad hears one out of sight as loud as his loudest scream (Soldier_Control.cc
// @src CalcScreamVolume), as it hears his cries.

import { outOfSightSoundOf } from '../../content/anim/out-of-sight-sounds.ts';
import type { OpOutcome } from '../../content/anim/script.ts';
import type { Soldier } from './soldier.ts';
import { shownInSector, type TacticalState } from './state.ts';
import { heardAsAScream } from './unseen-sources.ts';

const SOUND_ONLY_CODES: ReadonlySet<number> = new Set([702, 709, 781, 782, 784]);

export function tellSoundOutOfSight(t: TacticalState, s: Soldier, code: number): void {
  const sound = outOfSightSoundOf(code);
  if (sound === null || shownInSector(t, s)) return;
  t.events.push({ type: 'unseenAnimationSound', sound, ...heardAsAScream(t, s) });
}

export function outOfSightSoundOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (!SOUND_ONLY_CODES.has(code)) return null;
  tellSoundOutOfSight(t, s, code);
  return 'continue';
}
