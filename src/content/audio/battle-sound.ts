// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc InternalDoMercBattleSound, DoMercBattleSound, gBattleSndsData,
// @src MIN_SUBSEQUENT_SNDS_DELAY; Tactical/Soldier_Create.cc (ubBattleSoundID). See docs/27 §3.1.

import { type Cue, cueOf, effectCue, type FileExists, type Rand, soundRange, VolumeLevel } from './cue.ts';
import type { CueBook } from './cue-book.ts';
import { SoundBody } from './cues.ts';
import { type BattleSoundKind, battleSoundPath } from './sound-table.ts';

export type BattleSoundName =
  | 'OK1'
  | 'COOL1'
  | 'CURSE1'
  | 'HIT1'
  | 'LAUGH1'
  | 'ATTN1'
  | 'DIE1'
  | 'GOTIT'
  | 'NOTHING'
  | 'HUMM'
  | 'LOCKED'
  | 'ENEMY';

const OUR_TEAM = 0;
const VOICE_DIGITS = 3;
const DYING_FILE = 'dying';
const LOW_MORALE: Readonly<Partial<Record<string, string>>> = { OK1: 'LOWMORALE_OK1', ATTN1: 'LOWMORALE_ATTN1' };
const CUTS_SPEECH = 1;
const SKIPPED_WHILE_TALKING = 2;

export function battleVoiceBasename(profile: number | null, voiceId: number, bodyType: number, battleSoundId: number): string {
  if (profile !== null) return String(voiceId).padStart(VOICE_DIGITS, '0');
  const kid = bodyType === SoundBody.HATKIDCIV || bodyType === SoundBody.KIDCIV;
  return `${kid ? 'kid' : 'bad'}${battleSoundId}`;
}

export function isProfileVoice(voice: string): boolean {
  return /^\d{3}$/.test(voice);
}

export interface VoiceSoldier {
  readonly gridNo: number;
  readonly team: number;
  readonly bodyType: number;
  readonly voice: string | null;
  readonly morale: number;
}

export interface BattleMemory {
  readonly lastKind: number | null;
  readonly lastAtMs: number;
}

export const NO_BATTLE_MEMORY: BattleMemory = { lastKind: null, lastAtMs: 0 };

export interface BattleRequest {
  readonly sound: BattleSoundName;
  readonly nowMs: number;
  readonly playing: boolean;
  readonly talking: boolean;
  readonly muteConfirmations: boolean;
  readonly lowerVolume: boolean;
}

export interface BattleOutcome {
  readonly cues: readonly Cue[];
  readonly memory: BattleMemory;
  readonly stopPrevious: boolean;
  readonly cutSpeech: boolean;
}

function kindByName(book: CueBook, name: string): BattleSoundKind | null {
  return book.battle.kinds.find((k) => k.name === name) ?? null;
}

function creatureHitName(book: CueBook, bodyType: number, rand: Rand): string | null {
  switch (bodyType) {
    case SoundBody.COW:
      return 'COW_HIT_SND';
    case SoundBody.YAF_MONSTER:
    case SoundBody.YAM_MONSTER:
    case SoundBody.ADULTFEMALEMONSTER:
    case SoundBody.AM_MONSTER:
      return rand(2) === 0 ? 'ACR_DIE_PART1' : 'ACR_LUNGE';
    case SoundBody.INFANT_MONSTER:
    case SoundBody.LARVAE_MONSTER:
      return 'BCR_SHRIEK';
    case SoundBody.QUEENMONSTER:
      return 'LQ_SHRIEK';
    case SoundBody.BLOODCAT:
      return 'BLOODCAT_HIT_1';
    case SoundBody.ROBOTNOWEAPON:
      return soundRange(book, 'S_METAL_IMPACT1', 'S_METAL_IMPACT2', rand);
    default:
      return null;
  }
}

const CREATURE_DEATHS: Readonly<Partial<Record<number, string>>> = {
  [SoundBody.COW]: 'COW_DIE_SND',
  [SoundBody.YAF_MONSTER]: 'CREATURE_FALL_PART_2',
  [SoundBody.YAM_MONSTER]: 'CREATURE_FALL_PART_2',
  [SoundBody.ADULTFEMALEMONSTER]: 'CREATURE_FALL_PART_2',
  [SoundBody.AM_MONSTER]: 'CREATURE_FALL_PART_2',
  [SoundBody.INFANT_MONSTER]: 'BCR_DYING',
  [SoundBody.LARVAE_MONSTER]: 'LCR_RUPTURE',
  [SoundBody.QUEENMONSTER]: 'LQ_DYING',
  [SoundBody.BLOODCAT]: 'BLOODCAT_DIE_1',
  [SoundBody.ROBOTNOWEAPON]: 'EXPLOSION_1',
};

function substituteNames(book: CueBook, sound: BattleSoundName, bodyType: number, rand: Rand): readonly string[] | null {
  if (sound === 'HIT1') {
    const name = creatureHitName(book, bodyType, rand);
    return name ? [name] : null;
  }
  if (sound === 'DIE1') {
    const name = CREATURE_DEATHS[bodyType];
    if (!name) return null;
    return bodyType === SoundBody.ROBOTNOWEAPON ? ['ROBOT_DEATH', name] : [name];
  }
  if (bodyType === SoundBody.ROBOTNOWEAPON) return [sound === 'ATTN1' ? 'ROBOT_GREETING' : 'ROBOT_BEEP'];
  return null;
}

function substituteCues(book: CueBook, names: readonly string[], gridNo: number): Cue[] {
  return names.flatMap((name) => {
    const cue =
      name === 'ROBOT_DEATH'
        ? effectCue(book, name, 'fixed', VolumeLevel.HIGH)
        : effectCue(book, name, 'creatureVoice', VolumeLevel.HIGH, gridNo);
    return cue ? [cue] : [];
  });
}

function filtered(kind: BattleSoundKind, memory: BattleMemory, nowMs: number, delayMs: number): boolean {
  return memory.lastKind === kind.id && kind.dontAllowTwoInRow && nowMs - memory.lastAtMs < delayMs;
}

function voiceFile(book: CueBook, soldier: VoiceSoldier, kind: BattleSoundKind, exists: FileExists): string | null {
  const voice = soldier.voice;
  if (voice === null) return null;
  const profiled = isProfileVoice(voice);
  if (!profiled && !kind.badGuy) return null;
  const file = battleSoundPath(book.battle, voice, kind.file);
  if (exists(file)) return file;
  if (kind.name === 'DIE1') {
    const dying = battleSoundPath(book.battle, voice, DYING_FILE);
    if (exists(dying)) return dying;
  }
  if (!profiled) return null;
  return battleSoundPath(book.battle, soldier.bodyType === SoundBody.REGFEMALE ? 'f' : 'm', kind.file);
}

const SILENT = (memory: BattleMemory): BattleOutcome => ({ cues: [], memory, stopPrevious: false, cutSpeech: false });

export function battleSoundCue(
  book: CueBook,
  soldier: VoiceSoldier,
  memory: BattleMemory,
  request: BattleRequest,
  exists: FileExists,
  rand: Rand,
): BattleOutcome {
  const substitute = substituteNames(book, request.sound, soldier.bodyType, rand);
  if (substitute) return { ...SILENT(memory), cues: substituteCues(book, substitute, soldier.gridNo) };
  const requested = kindByName(book, request.sound);
  if (!requested || filtered(requested, memory, request.nowMs, book.battle.minSubsequentDelayMs)) return SILENT(memory);
  if (request.playing && requested.stopDialogue !== CUTS_SPEECH) return SILENT(memory);
  if (request.talking && requested.stopDialogue === SKIPPED_WHILE_TALKING) return SILENT(memory);
  const remembered: BattleMemory = { lastKind: requested.id, lastAtMs: request.nowMs };
  const control = { stopPrevious: request.playing, cutSpeech: request.talking && requested.stopDialogue === CUTS_SPEECH };
  if (request.sound === 'OK1' && request.muteConfirmations) return { ...SILENT(remembered), ...control };
  const moraleKind = soldier.morale < book.battle.lowMoraleThreshold ? LOW_MORALE[requested.name] : undefined;
  const base = moraleKind ? (kindByName(book, moraleKind) ?? requested) : requested;
  const adjusted = book.battle.kinds[base.id + rand(requested.randomVariants)] ?? base;
  const file = voiceFile(book, soldier, adjusted, exists);
  if (!file) return { ...SILENT(remembered), ...control };
  const volume = request.lowerVolume ? VolumeLevel.MID : VolumeLevel.HIGH;
  const mix = soldier.team === OUR_TEAM ? 'voiceOwn' : 'voiceOther';
  return { cues: [cueOf(file, mix, volume, soldier.gridNo)], memory: remembered, ...control };
}
