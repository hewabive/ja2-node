// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/GameInitOptionsScreen.cc BtnGIODoneCallback, DisplayMessageToUserAboutIronManMode (the Iron Man and Dead
// @src is Dead warnings; No resets the save mode to save anywhere), DisplayMessageToUserAboutGameDifficulty
// @src (zGioDifConfirmText of the difficulty), ConfirmGioDifSettingMessageBoxCallBack, HandleGIOScreen (the Dead is Dead
// @src OK box str_dead_is_dead_mode_enter_name before the save screen), DoneFadeOutForExitGameInitOptionScreen (the
// @src options read from the radio groups), GetGIOScreenUserInput; src/game/GameSettings.cc InitGameOptions (the
// @src defaults).

import type { Difficulty, GameOptions, SaveMode } from '../../client/api-types.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const GAME_INIT_SCREEN = 'gameInit';

export const GAME_INIT_CONTRACT: ControllerContract = {
  id: GAME_INIT_SCREEN,
  actions: {
    chooseDifficulty: { args: 1 },
    chooseStyle: { args: 1 },
    chooseGuns: { args: 1 },
    chooseSaveMode: { args: 1 },
    start: {},
    cancel: {},
  },
  bindings: { difficulty: 'number', style: 'number', guns: 'number', saveMode: 'number', starting: 'boolean' },
};

const SAVE_MODES: readonly SaveMode[] = ['anywhere', 'ironMan', 'deadIsDead'];
const SAVE_ANYWHERE = 0;
const IRON_MAN = 1;
const DEAD_IS_DEAD = 2;
const SCI_FI = 1;
const GUN_NUT = 1;
const IRON_MAN_WARNING = 'str_iron_man_mode_warning';
const DEAD_IS_DEAD_WARNING = 'str_dead_is_dead_mode_warning';
const DEAD_IS_DEAD_ENTER_NAME = 'str_dead_is_dead_mode_enter_name';
const DIFFICULTY_CONFIRMATIONS = 'zGioDifConfirmText';

export interface GameInitChoice {
  readonly difficulty: number;
  readonly style: number;
  readonly guns: number;
  readonly saveMode: number;
}

export const INITIAL_GAME_CHOICE: GameInitChoice = { difficulty: 0, style: SCI_FI, guns: 0, saveMode: SAVE_ANYWHERE };

export interface GameInitActions {
  start(options: GameOptions, choice: GameInitChoice): void;
  nameDeadIsDeadSave(options: GameOptions, choice: GameInitChoice): void;
  cancel(): void;
}

export interface GameInitDeps {
  readonly actions: GameInitActions;
  readonly boxes: MessageBoxes;
  readonly text: UiTextService;
  readonly bloodAndGore: () => boolean;
}

export interface GameInitModel {
  difficulty: number;
  style: number;
  guns: number;
  saveMode: number;
  starting: boolean;
}

export function gameOptionsOf(choice: GameInitChoice, bloodAndGore: boolean): GameOptions {
  return {
    difficulty: (choice.difficulty + 1) as Difficulty,
    sciFi: choice.style === SCI_FI,
    gunNut: choice.guns === GUN_NUT,
    saveMode: SAVE_MODES[choice.saveMode] ?? 'anywhere',
    bloodAndGore,
  };
}

export class GameInitController extends ViewModelController {
  readonly view: GameInitModel;
  readonly #deps: GameInitDeps;
  #asking = false;

  constructor(deps: GameInitDeps, choice: GameInitChoice = INITIAL_GAME_CHOICE) {
    const view: GameInitModel = { ...choice, starting: false };
    super(GAME_INIT_CONTRACT, view as unknown as Record<string, unknown>, {
      chooseDifficulty: ([i]) => this.#choose('difficulty', i),
      chooseStyle: ([i]) => this.#choose('style', i),
      chooseGuns: ([i]) => this.#choose('guns', i),
      chooseSaveMode: ([i]) => this.#choose('saveMode', i),
      start: () => void this.start(),
      cancel: () => this.#cancel(),
    });
    this.view = view;
    this.#deps = deps;
  }

  get choice(): GameInitChoice {
    const { difficulty, style, guns, saveMode } = this.view;
    return { difficulty, style, guns, saveMode };
  }

  #choose(key: keyof GameInitChoice, value: number | undefined): void {
    if (value !== undefined) this.view[key] = value;
  }

  #cancel(): void {
    if (this.#asking || this.view.starting) return;
    this.#deps.actions.cancel();
  }

  #text(table: string, index = 0): string {
    return this.#deps.text.string(table, index) ?? table;
  }

  async #confirmSaveMode(): Promise<boolean> {
    const mode = this.view.saveMode;
    if (mode !== IRON_MAN && mode !== DEAD_IS_DEAD) return true;
    const accepted = await this.#deps.boxes.confirm(this.#text(mode === IRON_MAN ? IRON_MAN_WARNING : DEAD_IS_DEAD_WARNING));
    if (!accepted) this.view.saveMode = SAVE_ANYWHERE;
    return accepted;
  }

  async start(): Promise<void> {
    if (this.#asking || this.view.starting) return;
    this.#asking = true;
    try {
      if (!(await this.#confirmSaveMode())) return;
      if (!(await this.#deps.boxes.confirm(this.#text(DIFFICULTY_CONFIRMATIONS, this.view.difficulty)))) return;
      const options = gameOptionsOf(this.choice, this.#deps.bloodAndGore());
      if (this.view.saveMode === DEAD_IS_DEAD) {
        await this.#deps.boxes.alert(this.#text(DEAD_IS_DEAD_ENTER_NAME));
        this.view.starting = true;
        this.#deps.actions.nameDeadIsDeadSave(options, this.choice);
        return;
      }
      this.view.starting = true;
      this.#deps.actions.start(options, this.choice);
    } finally {
      this.#asking = false;
    }
  }
}

export function gameInitScreen(env: FrontEndEnvironment, controller: GameInitController): FrontEndScreen {
  return new FrontEndScreen(env, {
    id: GAME_INIT_SCREEN,
    layout: FrontEndLayout.GAME_INIT,
    controller,
    soundScreen: UiScreenKind.GAME_INIT_OPTIONS,
  });
}
