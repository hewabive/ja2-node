// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/MainMenuScreen.cc InitMainMenu (Load disabled without saves), MenuButtonCallback (Alt+click on Load loads
// @src the newest save at once), HandleMainMenuInput (c, Alt+C, o, s, Ctrl+Q; Esc quits in the original),
// @src HandleMainMenuScreen. See docs/28 §4.2.

import { KeyModifier } from '../../input/events.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const MAIN_MENU_SCREEN = 'mainMenu';

export const MAIN_MENU_CONTRACT: ControllerContract = {
  id: MAIN_MENU_SCREEN,
  actions: { newGame: {}, loadGame: {}, loadNewest: {}, preferences: {}, credits: {}, quit: {} },
  bindings: { savesExist: 'boolean', version: 'string' },
};

export interface MainMenuActions {
  newGame(): void;
  loadGame(): void;
  loadNewest(): void;
  preferences(): void;
  credits(): void;
  quit(): void;
}

export interface MainMenuModel {
  savesExist: boolean;
  version: string;
}

export function mainMenuController(actions: MainMenuActions, model: MainMenuModel, modifiers: () => number): ViewModelController {
  return new ViewModelController(MAIN_MENU_CONTRACT, model as unknown as Record<string, unknown>, {
    newGame: () => actions.newGame(),
    loadGame: () => ((modifiers() & KeyModifier.ALT) !== 0 ? actions.loadNewest() : actions.loadGame()),
    loadNewest: () => actions.loadNewest(),
    preferences: () => actions.preferences(),
    credits: () => actions.credits(),
    quit: () => actions.quit(),
  });
}

export function mainMenuScreen(env: FrontEndEnvironment, actions: MainMenuActions, model: MainMenuModel): FrontEndScreen {
  return new FrontEndScreen(env, {
    id: MAIN_MENU_SCREEN,
    layout: FrontEndLayout.MAIN_MENU,
    controller: mainMenuController(actions, model, () => env.runtime.modifiers),
    soundScreen: UiScreenKind.MAINMENU,
  });
}
