// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Sound_Control.cc PlayJA2Sample, PlayLocationJA2Sample, PlaySoldierJA2Sample (the double scaling),
// @src PlayJA2Ambient, SetPositionSndsVolumeAndPanning; Tactical/Soldier_Control.cc InternalDoMercBattleSound (volume and pan);
// @src TileEngine/Ambient_Control.cc SetupNewAmbientSound.

import { type CueBook, soundPath } from './cue-book.ts';
import { NOWHERE, Pan, positionSoundVolume, type ScreenView, scaleVolume, soundDir, soundVolume } from './sound-position.ts';

export type Bus = 'effects' | 'speech' | 'music' | 'ambient';

export type MixRule =
  | 'location'
  | 'soldier'
  | 'fixed'
  | 'panned'
  | 'creatureVoice'
  | 'voiceOwn'
  | 'voiceOther'
  | 'speech'
  | 'ambient'
  | 'music'
  | 'positionLoop';

export interface Cue {
  readonly file: string;
  readonly baseVolume: number;
  readonly mix: MixRule;
  readonly bus: Bus;
  readonly gridNo: number;
  readonly pan: number;
  readonly loops: number;
}

export interface Volumes {
  readonly effects: number;
  readonly speech: number;
  readonly music: number;
  readonly ambient: number;
}

export interface Mixed {
  readonly volume: number;
  readonly pan: number;
}

export type Rand = (n: number) => number;
export type FileExists = (path: string) => boolean;

export const VolumeLevel = { LOW: 25, BUTTON: 40, MID: 65, HIGH: 127 } as const;

const BUS_OF_RULE: Readonly<Record<MixRule, Bus>> = {
  location: 'effects',
  soldier: 'effects',
  fixed: 'effects',
  panned: 'effects',
  creatureVoice: 'effects',
  voiceOwn: 'speech',
  voiceOther: 'speech',
  speech: 'speech',
  ambient: 'ambient',
  music: 'music',
  positionLoop: 'effects',
};

export function cueOf(file: string, mix: MixRule, baseVolume: number, gridNo = NOWHERE, pan: number = Pan.MIDDLE, loops = 1): Cue {
  return { file, baseVolume, mix, bus: BUS_OF_RULE[mix], gridNo, pan, loops };
}

export function effectCue(book: CueBook, name: string, mix: MixRule, baseVolume: number, gridNo = NOWHERE, loops = 1): Cue | null {
  const file = soundPath(book, name);
  return file ? cueOf(file, mix, baseVolume, gridNo, Pan.MIDDLE, loops) : null;
}

export function soundRange(book: CueBook, first: string, last: string, rand: Rand): string {
  const ids = book.effects.sounds;
  const from = ids.findIndex((s) => s.name === first);
  const to = ids.findIndex((s) => s.name === last);
  if (from < 0 || to < from) return first;
  return ids[from + rand(to - from + 1)]?.name ?? first;
}

export function mixCue(cue: Cue, view: ScreenView, volumes: Volumes): Mixed {
  const effects = (v: number) => scaleVolume(v, volumes.effects);
  const located = (v: number) => soundVolume(v, cue.gridNo, view);
  const dir = soundDir(cue.gridNo, view);
  switch (cue.mix) {
    case 'location':
      return { volume: effects(located(cue.baseVolume)), pan: dir };
    case 'soldier':
      return { volume: effects(effects(located(cue.baseVolume))), pan: dir };
    case 'fixed':
      return { volume: effects(cue.baseVolume), pan: cue.pan };
    case 'panned':
      return { volume: effects(cue.baseVolume), pan: dir };
    case 'creatureVoice':
      return { volume: effects(located(scaleVolume(cue.baseVolume, volumes.speech))), pan: dir };
    case 'voiceOwn':
      return { volume: scaleVolume(cue.baseVolume, volumes.speech), pan: dir };
    case 'voiceOther':
      return { volume: located(scaleVolume(cue.baseVolume, volumes.speech)), pan: dir };
    case 'speech':
      return { volume: scaleVolume(cue.baseVolume, volumes.speech), pan: cue.pan };
    case 'ambient':
      return { volume: scaleVolume(cue.baseVolume, volumes.ambient), pan: cue.pan };
    case 'music':
      return { volume: scaleVolume(cue.baseVolume, volumes.music), pan: cue.pan };
    case 'positionLoop':
      return { volume: positionSoundVolume(cue.baseVolume, cue.gridNo, view), pan: dir };
  }
}
