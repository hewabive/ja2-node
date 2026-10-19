import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const PLACEHOLDER_SCREEN = 'placeholder';

export const PLACEHOLDER_CONTRACT: ControllerContract = {
  id: PLACEHOLDER_SCREEN,
  actions: { options: {}, saveGame: {}, loadGame: {}, exitGame: {}, mainMenu: {} },
  bindings: { kind: 'string', session: 'string' },
};

export type GameScreenKind = 'laptop' | 'map' | 'tactical';

export interface PlaceholderActions {
  options(): void;
  saveGame(): void;
  loadGame(): void;
  exitGame(): void;
  mainMenu(): void;
}

const SOUND_SCREEN: Readonly<Record<GameScreenKind, UiScreenKind>> = {
  laptop: UiScreenKind.LAPTOP,
  map: UiScreenKind.MAP,
  tactical: UiScreenKind.GAME,
};

export function placeholderController(kind: GameScreenKind, session: string, actions: PlaceholderActions): ViewModelController {
  return new ViewModelController(
    PLACEHOLDER_CONTRACT,
    { kind, session },
    {
      options: () => actions.options(),
      saveGame: () => actions.saveGame(),
      loadGame: () => actions.loadGame(),
      exitGame: () => actions.exitGame(),
      mainMenu: () => actions.mainMenu(),
    },
  );
}

export function placeholderScreen(
  env: FrontEndEnvironment,
  kind: GameScreenKind,
  session: string,
  actions: PlaceholderActions,
): FrontEndScreen {
  return new FrontEndScreen(env, {
    id: `${kind}Placeholder`,
    layout: FrontEndLayout.PLACEHOLDER,
    controller: placeholderController(kind, session, actions),
    soundScreen: SOUND_SCREEN[kind],
  });
}
