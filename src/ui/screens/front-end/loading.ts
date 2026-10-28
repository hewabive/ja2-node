// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Loading_Screen.cc DisplayLoadScreenWithID, Loading_Screen.h LOADINGSCREEN_* (the ids);
// @src src/game/Utils/Animated_ProgressBar.cc SetRelativeStartAndEndPercentage, RenderProgressBar (the bar shows the
// @src progress in percent); src/game/SaveLoadGame.cc LoadSavedGame (the blue bar of a save load).

import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const LOADING_SCREEN = 'loading';
export const LOADINGSCREEN_NOTHING = 0;
export const LOADINGSCREEN_HELI = 17;
const FULL = 100;

export const LOADING_CONTRACT: ControllerContract = {
  id: LOADING_SCREEN,
  actions: {},
  bindings: { picture: 'number', kind: 'string', progress: 'number' },
};

export type LoadingKind = 'sector' | 'save';

export interface LoadingModel {
  picture: number;
  kind: LoadingKind;
  progress: number;
}

export class LoadingController extends ViewModelController {
  readonly view: LoadingModel;

  constructor(kind: LoadingKind, picture: number | null = null) {
    const view: LoadingModel = { picture: picture ?? LOADINGSCREEN_NOTHING, kind, progress: 0 };
    super(LOADING_CONTRACT, view as unknown as Record<string, unknown>);
    this.view = view;
  }

  progress(done: number, total: number): void {
    this.view.progress = total <= 0 ? FULL : Math.min(FULL, Math.floor((done * FULL) / total));
  }
}

export function loadingScreen(env: FrontEndEnvironment, controller: LoadingController): FrontEndScreen {
  return new FrontEndScreen(env, {
    id: LOADING_SCREEN,
    layout: FrontEndLayout.LOADING,
    controller,
    soundScreen: UiScreenKind.OTHER,
    hidesCursor: true,
  });
}
