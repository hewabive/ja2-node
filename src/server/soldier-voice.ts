import { battleVoiceBasename } from '../content/audio/battle-sound.ts';
import type { SoldierView } from '../protocol/view.ts';
import { NO_PROFILE, type Soldier } from '../sim/tactical/soldier.ts';

export type VoiceOf = (profile: number) => number;

export const PROFILE_VOICE: VoiceOf = (profile) => profile;

export function soldierVoice(s: Soldier, voiceOf: VoiceOf): string {
  const profile = s.profile === NO_PROFILE ? null : s.profile;
  return battleVoiceBasename(profile, profile === null ? 0 : voiceOf(profile), s.bodyType, s.battleSoundId);
}

export function withVoices(views: readonly SoldierView[], soldiers: readonly (Soldier | undefined)[], voiceOf: VoiceOf): SoldierView[] {
  return views.map((v) => {
    const s = soldiers[v.id];
    return s ? { ...v, voice: soldierVoice(s, voiceOf) } : v;
  });
}
