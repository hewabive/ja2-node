import { failureText } from '../../client/failure-text.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LabelId, Labels } from '../../text/labels.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const SCREEN_UNAVAILABLE = 'screenUnavailable';

export const SCREEN_UNAVAILABLE_CONTRACT: ControllerContract = {
  id: SCREEN_UNAVAILABLE,
  actions: { retry: {}, options: {}, saveGame: {}, loadGame: {}, exitGame: {}, mainMenu: {} },
  bindings: {
    heading: 'string',
    reason: 'string',
    session: 'string',
    keys: 'string',
    retryLabel: 'string',
    mainMenuLabel: 'string',
  },
};

export type GameScreenKind = 'laptop' | 'map' | 'tactical';

export interface GameScreenActions {
  options(): void;
  saveGame(): void;
  loadGame(): void;
  exitGame(): void;
  mainMenu(): void;
}

export interface UnavailableActions extends GameScreenActions {
  retry(): void;
}

const SOUND_SCREEN: Readonly<Record<GameScreenKind, UiScreenKind>> = {
  laptop: UiScreenKind.LAPTOP,
  map: UiScreenKind.MAP,
  tactical: UiScreenKind.GAME,
};

const HEADING: Readonly<Record<GameScreenKind, LabelId>> = {
  laptop: 'laptopUnavailable',
  map: 'mapUnavailable',
  tactical: 'tacticalUnavailable',
};

export function unavailableController(
  labels: Labels,
  kind: GameScreenKind,
  session: string,
  failure: unknown,
  actions: UnavailableActions,
): ViewModelController {
  return new ViewModelController(
    SCREEN_UNAVAILABLE_CONTRACT,
    {
      heading: labels.text(HEADING[kind]),
      reason: failure === null ? labels.text('notConnected') : failureText(labels, failure),
      session: `${labels.text('session')} ${session}`,
      keys: labels.text('gameKeys'),
      retryLabel: labels.text('retry'),
      mainMenuLabel: labels.text('mainMenu'),
    },
    {
      retry: () => actions.retry(),
      options: () => actions.options(),
      saveGame: () => actions.saveGame(),
      loadGame: () => actions.loadGame(),
      exitGame: () => actions.exitGame(),
      mainMenu: () => actions.mainMenu(),
    },
  );
}

export function unavailableScreen(
  env: FrontEndEnvironment,
  kind: GameScreenKind,
  session: string,
  failure: unknown,
  actions: UnavailableActions,
): FrontEndScreen {
  return new FrontEndScreen(env, {
    id: `${kind}Unavailable`,
    layout: FrontEndLayout.SCREEN_UNAVAILABLE,
    controller: unavailableController(env.labels(), kind, session, failure, actions),
    soundScreen: SOUND_SCREEN[kind],
  });
}
