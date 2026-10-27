// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CalcScreamVolume (the cap of 10 - experience level), InternalDoMercBattleSound
// @src (the bad and kid voices); OppList.cc ProcessNoise, CalcEffVolume (who of the squad hears a sound, how loud, from
// @src which side).

import { battleVoiceBasename } from '../../content/audio/battle-sound.ts';
import { u8 } from '../../core/int.ts';
import type { HeardFrom, UnseenVictim } from '../events.ts';
import { squadHears } from './perception/noise.ts';
import { effectiveExpLevel } from './skills.ts';
import { NO_PROFILE, type Soldier, shownToPlayer } from './soldier.ts';
import type { TacticalState } from './state.ts';

const LOUDEST_SCREAM = 10;

export function loudestScream(s: Soldier): number {
  return Math.max(1, LOUDEST_SCREAM - effectiveExpLevel(s));
}

export function screamVolume(s: Soldier, combinedLoss: number): number {
  const volume = combinedLoss < 1 ? 1 : combinedLoss;
  return volume > LOUDEST_SCREAM - effectiveExpLevel(s) ? u8(LOUDEST_SCREAM - effectiveExpLevel(s)) : volume;
}

export function unseenVictim(s: Soldier): UnseenVictim {
  const profile = s.profile === NO_PROFILE ? null : s.profile;
  return { voice: battleVoiceBasename(profile, profile ?? 0, s.bodyType, s.battleSoundId), bodyType: s.bodyType };
}

export function heardOnly(t: TacticalState, s: Soldier, volume: number, kind: number): { readonly heard?: HeardFrom } {
  const heard = squadHears(t, s.gridNo, s.level, volume, kind);
  return heard ? { heard } : {};
}

export function soundPlace(
  t: TacticalState,
  s: Soldier,
  positionKnown: boolean,
  volume: number,
  kind: number,
): { readonly gridNo?: number; readonly heard?: HeardFrom } {
  return shownToPlayer(s) || positionKnown ? { gridNo: s.gridNo } : heardOnly(t, s, volume, kind);
}
