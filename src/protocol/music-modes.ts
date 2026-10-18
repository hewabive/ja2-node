// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/content/ContentMusic.h MusicMode; src/externalized/DefaultContentManager.cc loadMusic (music.json
// @src keys); src/game/Utils/Music_Control.cc MusicPoll (end rules, MUSICOVERHEAD steps), StartMusicBasedOnMode (creature
// @src variants), MusicFadeOut; Strategic/StrategicMap.cc SetMusicFadeSpeed(5). See docs/27 §3.1.

export const MUSIC_MODES = [
  'none',
  'restore',
  'mainMenu',
  'tacticalNothing',
  'tacticalEnemyPresent',
  'tacticalBattle',
  'tacticalVictory',
  'tacticalDefeat',
  'laptop',
  'tacticalCreatureNothing',
  'tacticalCreatureEnemyPresent',
  'tacticalCreatureBattle',
] as const;

export type MusicModeName = (typeof MUSIC_MODES)[number];

export const MusicMode = {
  NONE: 'none',
  RESTORE: 'restore',
  MAIN_MENU: 'mainMenu',
  TACTICAL_NOTHING: 'tacticalNothing',
  TACTICAL_ENEMY_PRESENT: 'tacticalEnemyPresent',
  TACTICAL_BATTLE: 'tacticalBattle',
  TACTICAL_VICTORY: 'tacticalVictory',
  TACTICAL_DEFEAT: 'tacticalDefeat',
  LAPTOP: 'laptop',
  TACTICAL_CREATURE_NOTHING: 'tacticalCreatureNothing',
  TACTICAL_CREATURE_ENEMY_PRESENT: 'tacticalCreatureEnemyPresent',
  TACTICAL_CREATURE_BATTLE: 'tacticalCreatureBattle',
} as const satisfies Record<string, MusicModeName>;

export function isMusicMode(value: unknown): value is MusicModeName {
  return MUSIC_MODES.includes(value as MusicModeName);
}

export function musicModeOfNativeByte(byte: number): MusicModeName {
  return MUSIC_MODES[byte] ?? MusicMode.NONE;
}

export const MUSIC_TRACK_KEYS: Readonly<Partial<Record<MusicModeName, string>>> = {
  mainMenu: 'main_menu',
  laptop: 'laptop',
  tacticalNothing: 'tactical',
  tacticalEnemyPresent: 'tactical_enemypresent',
  tacticalBattle: 'tactical_battle',
  tacticalCreatureNothing: 'tactical_creature',
  tacticalCreatureEnemyPresent: 'tactical_creature_enemypresent',
  tacticalCreatureBattle: 'tactical_creature_battle',
  tacticalVictory: 'tactical_victory',
  tacticalDefeat: 'tactical_defeat',
};

export const CREATURE_VARIANTS: Readonly<Partial<Record<MusicModeName, MusicModeName>>> = {
  tacticalNothing: 'tacticalCreatureNothing',
  tacticalEnemyPresent: 'tacticalCreatureEnemyPresent',
  tacticalBattle: 'tacticalCreatureBattle',
};

export function trackListMode(mode: MusicModeName, creature: boolean): MusicModeName {
  return creature ? (CREATURE_VARIANTS[mode] ?? mode) : mode;
}

export type TrackEnd = 'nextTrack' | 'thenNothing' | 'thenSilence';

export function trackEndRule(mode: MusicModeName): TrackEnd {
  if (mode === MusicMode.TACTICAL_VICTORY) return 'thenNothing';
  if (mode === MusicMode.TACTICAL_DEFEAT) return 'thenSilence';
  return 'nextTrack';
}

export const MUSIC_OVERHEAD_MS = 10;
export const NORMAL_FADE_STEP = 1;
export const FAST_FADE_STEP = 5;
