import { battleVoiceBasename } from '../content/audio/battle-sound.ts';
import type { SoldierView } from '../protocol/view.ts';
import { NO_PROFILE, type Soldier } from '../sim/tactical/soldier.ts';

export function soldierVoice(s: Soldier): string {
  return battleVoiceBasename(s.profile === NO_PROFILE ? null : s.profile, s.bodyType, s.battleSoundId);
}

export function withVoices(views: readonly SoldierView[], soldiers: readonly (Soldier | undefined)[]): SoldierView[] {
  return views.map((v) => {
    const s = soldiers[v.id];
    return s ? { ...v, voice: soldierVoice(s) } : v;
  });
}
