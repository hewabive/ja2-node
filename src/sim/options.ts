// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/GameSettings.h GAME_OPTIONS, GameSaveMode; GameSettings.cc InitGameOptions, InitGameSettings
// @src (TOPTION_BLOOD_N_GORE on); SaveLoadGame.cc ExtractGameOptions. See docs/27 §2.2.

import type { SavedGameOptions } from '../content/formats/savegame-header.ts';

export const DIFFICULTY_LEVELS = [1, 2, 3] as const;

export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const SAVE_MODES = ['anywhere', 'ironMan', 'deadIsDead'] as const;

export type SaveMode = (typeof SAVE_MODES)[number];

export interface GameOptions {
  readonly difficulty: DifficultyLevel;
  readonly sciFi: boolean;
  readonly gunNut: boolean;
  readonly saveMode: SaveMode;
  bloodAndGore: boolean;
}

export const ORIGINAL_GAME_OPTIONS: Readonly<GameOptions> = Object.freeze({
  difficulty: 1,
  sciFi: true,
  gunNut: false,
  saveMode: 'anywhere',
  bloodAndGore: true,
});

export const API_DEFAULT_DIFFICULTY: DifficultyLevel = 2;

export type GameOptionsRequest = {
  readonly [K in keyof GameOptions]?: (K extends 'difficulty' ? number : GameOptions[K]) | undefined;
};

export function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return DIFFICULTY_LEVELS.includes(value as DifficultyLevel);
}

function difficultyLevel(value: number | undefined): DifficultyLevel {
  if (value === undefined) return API_DEFAULT_DIFFICULTY;
  if (!isDifficultyLevel(value)) throw new Error(`difficulty must be one of ${DIFFICULTY_LEVELS.join(', ')}`);
  return value;
}

export function gameOptions(request: GameOptionsRequest = {}): GameOptions {
  return {
    difficulty: difficultyLevel(request.difficulty),
    sciFi: request.sciFi ?? ORIGINAL_GAME_OPTIONS.sciFi,
    gunNut: request.gunNut ?? ORIGINAL_GAME_OPTIONS.gunNut,
    saveMode: request.saveMode ?? ORIGINAL_GAME_OPTIONS.saveMode,
    bloodAndGore: request.bloodAndGore ?? ORIGINAL_GAME_OPTIONS.bloodAndGore,
  };
}

export function assignGameOptions(target: GameOptions, request: GameOptionsRequest): void {
  Object.assign(
    target,
    gameOptions({
      difficulty: request.difficulty ?? target.difficulty,
      sciFi: request.sciFi ?? target.sciFi,
      gunNut: request.gunNut ?? target.gunNut,
      saveMode: request.saveMode ?? target.saveMode,
      bloodAndGore: request.bloodAndGore ?? target.bloodAndGore,
    }),
  );
}

export type DroppedNativeOption = 'turnTimeLimit';

export interface ImportedGameOptions {
  readonly options: GameOptions;
  readonly dropped: readonly DroppedNativeOption[];
}

export function nativeSaveMode(gameSaveMode: number): SaveMode {
  return SAVE_MODES[gameSaveMode] ?? ORIGINAL_GAME_OPTIONS.saveMode;
}

export function importNativeGameOptions(saved: SavedGameOptions): ImportedGameOptions {
  const options = gameOptions({
    difficulty: isDifficultyLevel(saved.difficulty) ? saved.difficulty : ORIGINAL_GAME_OPTIONS.difficulty,
    sciFi: saved.sciFi,
    gunNut: saved.gunNut,
    saveMode: nativeSaveMode(saved.saveMode),
  });
  return { options, dropped: saved.turnTimeLimit ? ['turnTimeLimit'] : [] };
}

export interface OptionChange {
  readonly bloodAndGore?: boolean;
}

export const CHANGEABLE_OPTIONS: readonly (keyof OptionChange)[] = ['bloodAndGore'];

export function parseOptionChange(cmd: Readonly<Record<string, unknown>>): OptionChange | string {
  const unknown = Object.keys(cmd).filter((k) => k !== 'type' && !CHANGEABLE_OPTIONS.includes(k as keyof OptionChange));
  if (unknown.length > 0) return `only ${CHANGEABLE_OPTIONS.join(', ')} can change during a game (not ${unknown.join(', ')})`;
  if (cmd.bloodAndGore === undefined) return `name an option to change: ${CHANGEABLE_OPTIONS.join(', ')}`;
  if (typeof cmd.bloodAndGore !== 'boolean') return 'bloodAndGore must be true or false';
  return { bloodAndGore: cmd.bloodAndGore };
}

export function applyOptionChange(options: GameOptions, change: OptionChange): void {
  if (change.bloodAndGore !== undefined) options.bloodAndGore = change.bloodAndGore;
}
