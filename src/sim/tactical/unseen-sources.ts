// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CalcScreamVolume (the cap of 10 - experience level), InternalDoMercBattleSound
// @src (the bad and kid voices); OppList.cc ProcessNoise, CalcEffVolume (who of the squad hears a sound, how loud, from
// @src which side); Soldier_Create.cc TacticalCopySoldierFromCreateStruct (the name a line gives a soldier out of sight,
// @src 2026-11-14); InternalDoMercBattleSound's SOLDIER_MUTE (the curse of a soldier out of sight, 2026-11-14).

import { battleVoiceBasename } from '../../content/audio/battle-sound.ts';
import { u8 } from '../../core/int.ts';
import type { CursingSoldier, HeardFrom, NamedSoldier, UnseenVictim } from '../events.ts';
import { defaultSoldierName } from './default-names.ts';
import { NoiseKind, squadHears } from './perception/noise.ts';
import { effectiveExpLevel, type LoadedSector } from './skills.ts';
import { NO_PROFILE, type Soldier } from './soldier.ts';
import { shownInSector, type TacticalState } from './state.ts';

const LOUDEST_SCREAM = 10;

export function loudestScream(t: LoadedSector, s: Soldier): number {
  return Math.max(1, LOUDEST_SCREAM - effectiveExpLevel(t, s));
}

export function screamVolume(t: LoadedSector, s: Soldier, combinedLoss: number): number {
  const volume = combinedLoss < 1 ? 1 : combinedLoss;
  return volume > LOUDEST_SCREAM - effectiveExpLevel(t, s) ? u8(LOUDEST_SCREAM - effectiveExpLevel(t, s)) : volume;
}

const PROFILE_VOICE = (profile: number) => profile;

export function unseenVictim(s: Soldier, voiceOf: (profile: number) => number = PROFILE_VOICE): UnseenVictim {
  const profile = s.profile === NO_PROFILE ? null : s.profile;
  return {
    voice: battleVoiceBasename(profile, profile === null ? 0 : voiceOf(profile), s.bodyType, s.battleSoundId),
    bodyType: s.bodyType,
  };
}

export function heardOnly(t: TacticalState, s: Soldier, volume: number, kind: number): { readonly heard?: HeardFrom } {
  const heard = squadHears(t, s.gridNo, s.level, volume, kind);
  return heard ? { heard } : {};
}

export function heardAsAScream(t: TacticalState, s: Soldier): { readonly heard?: HeardFrom } {
  return heardOnly(t, s, loudestScream(t, s), NoiseKind.SCREAM);
}

export function unseenVoice(t: TacticalState, s: Soldier): { readonly unseen: UnseenVictim; readonly heard?: HeardFrom } {
  return { unseen: unseenVictim(s), ...heardAsAScream(t, s) };
}

export function shownId(t: TacticalState, s: Soldier | null): number | null | undefined {
  if (s === null) return null;
  return shownInSector(t, s) ? s.id : undefined;
}

export function shownSoldier(t: TacticalState, s: Soldier): { readonly soldier?: number } {
  return shownInSector(t, s) ? { soldier: s.id } : {};
}

export function namedSoldier(t: TacticalState, s: Soldier): NamedSoldier {
  if (shownInSector(t, s)) return { soldier: s.id };
  const byTeam = defaultSoldierName(s);
  return byTeam ? { defaultName: byTeam } : { name: s.name };
}

export function cursingSoldier(t: TacticalState, s: Soldier): CursingSoldier {
  const named = namedSoldier(t, s);
  if (named.soldier !== undefined || s.muted) return named;
  return { ...named, ...unseenVoice(t, s) };
}

export function shownFirer(t: TacticalState, s: Soldier): { readonly soldier: number } | { readonly item: number } {
  return shownInSector(t, s) ? { soldier: s.id } : { item: s.attackingWeapon };
}

export function soundPlace(
  t: TacticalState,
  s: Soldier,
  positionKnown: boolean,
  volume: number,
  kind: number,
): { readonly gridNo?: number; readonly heard?: HeardFrom } {
  return shownInSector(t, s) || positionKnown ? { gridNo: s.gridNo } : heardOnly(t, s, volume, kind);
}
