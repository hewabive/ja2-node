// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Clock.cc UpdateGameClockGlobals ("{day string} {day}, {hh:02}:{mm:02}"), RenderClock
// @src (pPausedGameText[0] while the player paused), CreateMouseRegionForPauseOfClock (pPausedGameText 1 when paused,
// @src else 2), HandlePlayerPauseUnPauseOfGame (refused while engaged in a conversation); src/game/TileEngine/Radar_Screen.cc
// @src RadarRegionMoveCallback, RadarRegionButtonCallbackPrimary (the camera follows a press and a drag), ToggleRadarScreenRender.
// See docs/28 §5.7, §6.8.

import type { ClockView } from '../../../protocol/view.ts';
import type { ControllerContract, LayoutController } from '../../layout/controller.ts';
import { getPath } from '../../layout/controller.ts';
import type { UiTextService } from '../../text/text-service.ts';

export const HUD_SCREEN = 'tacticalHud';

export const HUD_CONTRACT: ControllerContract = {
  id: HUD_SCREEN,
  actions: { radarPress: {}, radarHover: { args: 1 }, togglePause: {}, options: {}, saveGame: {}, loadGame: {}, exitGame: {} },
  bindings: {
    radarEnabled: 'boolean',
    radarShown: 'boolean',
    sector: 'string',
    clock: 'string',
    inCombat: 'boolean',
    pauseHelp: 'string',
    paused: 'boolean',
  },
};

export interface HudModel {
  radarEnabled: boolean;
  radarShown: boolean;
  sector: string;
  clock: string;
  inCombat: boolean;
  pauseHelp: string;
  paused: boolean;
}

const GAME_CLOCK_STRING = 'gpGameClockString';
const PAUSED_TEXT = 'pPausedGameText';
const PAUSED_INDEX = 0;
const RESUME_HELP = 1;
const PAUSE_HELP = 2;

export function clockString(text: UiTextService, clock: ClockView | null): string {
  if (!clock) return '';
  const day = text.string(GAME_CLOCK_STRING, 0) ?? '';
  return `${day} ${clock.day}, ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
}

export function hudClockText(text: UiTextService, clock: ClockView | null, paused: boolean): string {
  return paused ? (text.string(PAUSED_TEXT, PAUSED_INDEX) ?? '') : clockString(text, clock);
}

export function pauseHelpText(text: UiTextService, paused: boolean): string {
  return text.string(PAUSED_TEXT, paused ? RESUME_HELP : PAUSE_HELP) ?? '';
}

export function sectorOfMap(mapPath: string | null): string {
  const name = /([^/]+)\.dat$/i.exec(mapPath ?? '')?.[1] ?? '';
  const m = /^([a-p])(\d{1,2})/i.exec(name);
  return m ? `${(m[1] as string).toUpperCase()}${Number(m[2])}` : '';
}

export interface HudActions {
  radarPress(): void;
  radarHover(on: boolean): void;
  togglePause(): void;
  options(): void;
  saveGame(): void;
  loadGame(): void;
  exitGame(): void;
}

export class HudController implements LayoutController {
  readonly contract = HUD_CONTRACT;
  model: HudModel = { radarEnabled: false, radarShown: true, sector: '', clock: '', inCombat: false, pauseHelp: '', paused: false };
  readonly #actions: HudActions;

  constructor(actions: HudActions) {
    this.#actions = actions;
  }

  get(path: string): unknown {
    return getPath(this.model, path);
  }

  invoke(action: string, args: readonly number[]): void {
    if (action === 'radarPress') this.#actions.radarPress();
    else if (action === 'radarHover') this.#actions.radarHover(args[0] === 1);
    else if (action === 'togglePause') this.#actions.togglePause();
    else if (action === 'options') this.#actions.options();
    else if (action === 'saveGame') this.#actions.saveGame();
    else if (action === 'loadGame') this.#actions.loadGame();
    else if (action === 'exitGame') this.#actions.exitGame();
  }
}
