// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/GameSettings.cc DisplayGameSettings (the version, difficulty, save style, guns and game style lines;
// @src the cheater's progress line is not ported).

import type { GameOptions } from '../client/api-types.ts';
import { GameInitText } from '../text/string-ids.ts';
import type { UiTextService } from '../text/text-service.ts';

const MESSAGES = 'pMessageStrings';
const GIO = 'gzGIOScreenText';
const MSG_VERSION = 23;
const FIRST_DIFFICULTY = 1;
const SAVE_STYLE_OFFSET: Readonly<Record<GameOptions['saveMode'], number>> = { anywhere: 0, ironMan: 1, deadIsDead: 2 };

export function gameSettingsLines(text: UiTextService, version: string, options: GameOptions): string[] {
  const gio = (index: number) => text.string(GIO, index) ?? '';
  const line = (label: number, value: number) => `${gio(label)}: ${gio(value)}`;
  return [
    `${text.string(MESSAGES, MSG_VERSION) ?? ''}: ${version}`,
    line(GameInitText.DIF_LEVEL, GameInitText.EASY + options.difficulty - FIRST_DIFFICULTY),
    line(GameInitText.GAME_SAVE_STYLE, GameInitText.SAVE_ANYWHERE + SAVE_STYLE_OFFSET[options.saveMode]),
    line(GameInitText.GUN_OPTIONS, options.gunNut ? GameInitText.GUN_NUT : GameInitText.REDUCED_GUNS),
    line(GameInitText.GAME_STYLE, options.sciFi ? GameInitText.SCI_FI : GameInitText.REALISTIC),
  ];
}
