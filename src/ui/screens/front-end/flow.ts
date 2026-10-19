// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/MainMenuScreen.cc HandleMainMenuScreen; src/game/GameInitOptionsScreen.cc HandleGIOScreen and
// @src DoneFadeOutForExitGameInitOptionScreen (fade out, music off, the beginning intro or the save screen in Dead is Dead);
// @src src/game/Options_Screen.cc SetOptionsExitScreen; src/game/SaveLoadScreen.cc LeaveSaveLoadScreen (back to the
// @src screen that opened it; from the options back to the options), DoSaveGame (after a save back to the game),
// @src EnterSaveLoadScreen (gfLoadGameUponEntry loads the newest save without the warning box),
// @src StartFadeOutForSaveLoadScreen and DoneFadeOutForSaveLoadScreen (fade out, load, fade in on the saved screen);
// @src src/game/GameLoop.cc EndGameMessageBoxCallBack; src/game/Credits.cc (back to the main menu); src/game/JAScreens.cc
// @src SexScreenHandle (a fade into the game). See docs/28 §4.1.

import type { PlayerView, ViewFrame } from '../../../protocol/view.ts';
import type { GameOptions, SaveListing } from '../../client/api-types.ts';
import type { DeadIsDeadSlot, FrontEndClient } from '../../client/front-end-client.ts';
import type { DrawList } from '../../draw-list.ts';
import { SaveController } from '../../saves/save-controller.ts';
import type { Screen } from '../../screen.ts';
import { Fade, type FadeDirection } from '../../widgets/fade.ts';
import type { RowFeed } from '../credit-roll.ts';
import type { TacticalFlow } from '../tactical/environment.ts';
import { CreditsController, creditsScreen } from './credits.ts';
import { type FrontEndEnvironment, FrontEndLayout, type SettingsStore } from './environment.ts';
import { type ExitBoxStyle, openExitBox } from './exit-box.ts';
import { type GameInitChoice, GameInitController, gameInitScreen, INITIAL_GAME_CHOICE } from './game-init.ts';
import { LoadingController, loadingScreen } from './loading.ts';
import { type MainMenuModel, mainMenuScreen } from './main-menu.ts';
import { OptionsController, type OptionsOrigin, optionsScreen } from './options.ts';
import { type GameScreenKind, type PlaceholderActions, placeholderScreen } from './placeholder.ts';
import { SanMonaController, sanMonaScreen } from './san-mona.ts';
import { SaveLoadController, type SaveLoadMode, saveLoadScreen } from './save-load.ts';

export type FrontEndMusic = 'mainMenu' | 'none' | 'session';
export type SaveLoadOrigin = 'mainMenu' | 'options' | 'game' | 'gameInit';

export interface TacticalPort {
  readonly loaded: boolean;
  readonly stale: boolean;
  readonly loadScreen: number | null;
  load(onProgress: (done: number, total: number) => void): Promise<void>;
  screen(flow: TacticalFlow): Screen;
}

export interface LaptopFlow {
  closed(): void;
  quit(): void;
}

export interface LaptopPort {
  open(flow: LaptopFlow): Promise<Screen>;
}

export interface FrontEndHost {
  readonly version: string;
  tactical?(): TacticalPort | null;
  laptop?(): LaptopPort | null;
  playBeginning(): Promise<void>;
  music(mode: FrontEndMusic): void;
  quit(): void;
  preload(layout: FrontEndLayout, onProgress: (done: number, total: number) => void): Promise<void>;
  rowFeed(): RowFeed;
  random(range: number): number;
}

const SEX_SCENE = 'sexScene';
const TACTICAL_SCREEN_ID = 'tactical';
const BLACK_SCREEN = 'black';

class BlackScreen implements Screen {
  readonly id = BLACK_SCREEN;
  readonly hidesCursor = true;
  readonly #env: FrontEndEnvironment;

  constructor(env: FrontEndEnvironment) {
    this.#env = env;
  }

  enter(): void {}

  exit(): void {}

  update(): void {}

  input(): boolean {
    return true;
  }

  render(list: DrawList): void {
    const { width, height } = this.#env.runtime.geometry();
    list.fill(0, 0, width, height, 0);
  }
}

export function gameScreenOf(view: PlayerView | null): GameScreenKind {
  const flow = view?.strategic?.flow;
  if (flow === 'laptop') return 'laptop';
  if (!view?.strategic || flow === 'tactical') return 'tactical';
  return 'map';
}

const EXIT_BOX_STYLE: Readonly<Record<GameScreenKind, ExitBoxStyle>> = { laptop: 'laptop', map: 'map', tactical: 'game' };

export class FrontEndFlow {
  readonly saves: SaveController;
  readonly #env: FrontEndEnvironment;
  readonly #client: FrontEndClient;
  readonly #settings: SettingsStore;
  readonly #host: FrontEndHost;
  #leavingLaptop: string | null = null;
  readonly #menu: MainMenuModel;
  #choice: GameInitChoice = INITIAL_GAME_CHOICE;
  #pendingOptions: GameOptions | null = null;
  #optionsOrigin: OptionsOrigin = 'mainMenu';
  #listings: readonly SaveListing[] = [];

  constructor(env: FrontEndEnvironment, client: FrontEndClient, settings: SettingsStore, host: FrontEndHost) {
    this.#env = env;
    this.#client = client;
    this.#settings = settings;
    this.#host = host;
    this.#menu = { savesExist: false, version: host.version };
    let health: Awaited<ReturnType<FrontEndClient['health']>> | null = null;
    void client.health().then(
      (h) => {
        health = h;
      },
      () => undefined,
    );
    this.saves = new SaveController({ labels: env.labels, health: () => health, box: env.boxes, api: client });
  }

  get #screens() {
    return this.#env.runtime.host;
  }

  #show(screen: Screen): void {
    if (this.#screens.depth === 0) this.#screens.push(screen);
    else this.#screens.replace(screen);
  }

  #fade(direction: FadeDirection): Promise<void> {
    return new Promise((resolve) => this.#screens.openModal(new Fade(this.#env.runtime, { direction, onDone: resolve })));
  }

  async #refreshListings(): Promise<readonly SaveListing[]> {
    try {
      this.#listings = await this.#client.saves();
    } catch {
      this.#listings = [];
    }
    this.#menu.savesExist = this.#listings.length > 0;
    return this.#listings;
  }

  mainMenu(): void {
    this.#choice = INITIAL_GAME_CHOICE;
    this.#host.music('mainMenu');
    this.#show(
      mainMenuScreen(
        this.#env,
        {
          newGame: () => this.gameInit(),
          loadGame: () => void this.saveLoad('load', 'mainMenu'),
          loadNewest: () => void this.loadNewest(),
          preferences: () => void this.options('mainMenu'),
          credits: () => this.credits(),
          quit: () => this.#host.quit(),
        },
        this.#menu,
      ),
    );
    void this.#refreshListings();
  }

  gameInit(): void {
    const controller = new GameInitController(
      {
        actions: {
          start: (options, choice) => {
            this.#choice = choice;
            void this.startNewGame(options);
          },
          nameDeadIsDeadSave: (options, choice) => {
            this.#choice = choice;
            this.#pendingOptions = options;
            void this.#fade('out').then(() => this.saveLoad('save', 'gameInit'));
          },
          cancel: () => this.mainMenu(),
        },
        boxes: this.#env.boxes,
        text: this.#env.text,
        bloodAndGore: () => this.#settings.current().bloodAndGore,
      },
      this.#choice,
    );
    this.#show(gameInitScreen(this.#env, controller));
  }

  async startNewGame(options: GameOptions, deadIsDead?: DeadIsDeadSlot): Promise<void> {
    if (this.#screens.screen?.id !== BLACK_SCREEN) await this.#fade('out');
    this.#host.music('none');
    this.#show(new BlackScreen(this.#env));
    try {
      await this.#client.newCampaign({ options, ...(deadIsDead ? { deadIsDead } : {}) });
    } catch (err) {
      this.gameInit();
      await this.#env.boxes.alert((err as Error).message);
      return;
    }
    await this.#host.playBeginning();
    this.enterGame();
  }

  async options(origin: OptionsOrigin): Promise<void> {
    this.#optionsOrigin = origin;
    const inGame = origin === 'game' && this.#client.session !== null;
    const status = inGame ? await this.#client.status().catch(() => null) : null;
    const controller = new OptionsController({
      actions: {
        saveGame: () => void this.saveLoad('save', 'options'),
        loadGame: () => void this.saveLoad('load', 'options'),
        quitToMainMenu: () => void this.#quitToMainMenu(),
        done: () => this.#back(origin),
      },
      settings: this.#settings,
      boxes: this.#env.boxes,
      text: this.#env.text,
      sounds: this.#env.runtime.sounds,
      origin,
      canSave: status?.canSave ?? false,
      deadIsDead: status?.options?.saveMode === 'deadIsDead',
      sessionBloodAndGore: inGame ? (status?.options?.bloodAndGore ?? null) : null,
      setSessionBloodAndGore: (on) => void this.#client.setBloodAndGore(on),
    });
    this.#show(optionsScreen(this.#env, controller, { settings: this.#settings, origin }));
  }

  #back(origin: OptionsOrigin): void {
    if (origin === 'game' && this.#client.session) this.enterGame();
    else this.mainMenu();
  }

  async #quitToMainMenu(): Promise<void> {
    await this.#client.closeSession();
    this.mainMenu();
  }

  async saveLoad(mode: SaveLoadMode, origin: SaveLoadOrigin): Promise<void> {
    const listings = await this.#refreshListings();
    const leave = () => this.#leaveSaveLoad(origin);
    const controller = new SaveLoadController({
      mode,
      listings,
      labels: this.#env.labels,
      saves: this.saves,
      boxes: this.#env.boxes,
      session: this.#client.session,
      namesSaveOnly: origin === 'gameInit',
      actions: {
        leave,
        saved: () => (this.#client.session ? this.enterGame() : leave()),
        load: (listing) => void this.loadSave(listing, origin),
        nameSave: (name, description) => {
          const options = this.#pendingOptions;
          this.#pendingOptions = null;
          if (options) void this.startNewGame(options, { name, description });
        },
      },
    });
    const pausesGame = origin !== 'mainMenu' && origin !== 'gameInit' && this.#client.session !== null;
    this.#show(saveLoadScreen(this.#env, controller, { pausesGame }));
  }

  #leaveSaveLoad(origin: SaveLoadOrigin): void {
    switch (origin) {
      case 'mainMenu':
        this.mainMenu();
        return;
      case 'gameInit':
        this.#pendingOptions = null;
        this.gameInit();
        return;
      case 'options':
        void this.options(this.#optionsOrigin);
        return;
      case 'game':
        this.enterGame();
        return;
    }
  }

  async loadNewest(): Promise<void> {
    const listings = await this.#refreshListings();
    const newest = [...listings]
      .filter((l) => l.compatible)
      .sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0))[0];
    if (newest) await this.loadSave(newest, 'mainMenu');
    else await this.saveLoad('load', 'mainMenu');
  }

  async loadSave(listing: SaveListing, origin: SaveLoadOrigin): Promise<void> {
    await this.#fade('out');
    const loading = new LoadingController('save');
    this.#host.music('mainMenu');
    this.#show(loadingScreen(this.#env, loading));
    const session = origin === 'mainMenu' || origin === 'gameInit' ? null : this.#client.session;
    const outcome = await this.saves.loadConfirmed(
      listing,
      session ? { kind: 'inPlace', session } : { kind: 'newSession' },
      this.#settings.current().language,
    );
    if (!outcome.ok) {
      await this.saveLoad('load', origin);
      if (!outcome.cancelled) await this.#env.boxes.alert(outcome.text);
      return;
    }
    if (outcome.session !== this.#client.session) await this.#client.connect(outcome.session);
    await this.#host.preload(FrontEndLayout.PLACEHOLDER, (done, total) => loading.progress(done, total));
    loading.progress(1, 1);
    this.enterGame();
    await this.#fade('in');
  }

  credits(): void {
    const controller = new CreditsController({
      text: this.#env.text,
      random: (range) => this.#host.random(range),
      finished: () => this.mainMenu(),
    });
    this.#show(creditsScreen(this.#env, controller, { feed: () => this.#host.rowFeed() }));
  }

  enterGame(): void {
    const session = this.#client.session;
    if (!session) {
      this.mainMenu();
      return;
    }
    const kind = gameScreenOf(this.#client.view);
    this.#host.music('session');
    const tactical = kind === 'tactical' ? (this.#host.tactical?.() ?? null) : null;
    if (tactical) {
      void this.#enterTactical(tactical, session);
      return;
    }
    const laptop = kind === 'laptop' ? (this.#host.laptop?.() ?? null) : null;
    if (laptop) {
      void this.#enterLaptop(laptop, session);
      return;
    }
    this.#show(placeholderScreen(this.#env, kind, session, this.#gameActions(kind)));
  }

  async #enterLaptop(port: LaptopPort, session: string): Promise<void> {
    let screen: Screen;
    try {
      screen = await port.open({ closed: () => this.#laptopClosed(session), quit: () => this.exitBox('laptop') });
    } catch (err) {
      this.#show(placeholderScreen(this.#env, 'laptop', session, this.#gameActions('laptop')));
      await this.#env.boxes.alert((err as Error).message);
      return;
    }
    if (this.#client.session === session) this.#show(screen);
  }

  #laptopClosed(session: string): void {
    this.#leavingLaptop = session;
    this.#afterLaptop();
  }

  #afterLaptop(): void {
    const session = this.#leavingLaptop;
    if (session === null || gameScreenOf(this.#client.view) === 'laptop') return;
    this.#leavingLaptop = null;
    if (this.#client.session === session) this.enterGame();
  }

  #gameActions(kind: GameScreenKind): PlaceholderActions {
    return {
      options: () => void this.options('game'),
      saveGame: () => void this.saveLoad('save', 'game'),
      loadGame: () => void this.saveLoad('load', 'game'),
      exitGame: () => this.exitBox(kind),
      mainMenu: () => this.leaveGame(),
    };
  }

  async #enterTactical(port: TacticalPort, session: string): Promise<void> {
    if (!port.loaded) {
      const loading = new LoadingController('sector', port.loadScreen);
      this.#show(loadingScreen(this.#env, loading));
      try {
        await port.load((done, total) => loading.progress(done, total));
      } catch (err) {
        this.#show(placeholderScreen(this.#env, 'tactical', session, this.#gameActions('tactical')));
        await this.#env.boxes.alert((err as Error).message);
        return;
      }
    }
    if (this.#client.session !== session) return;
    const actions = this.#gameActions('tactical');
    this.#show(
      port.screen({
        options: actions.options,
        saveGame: actions.saveGame,
        loadGame: actions.loadGame,
        exitGame: actions.exitGame,
        mapScreen: () => {
          if (this.#client.view?.strategic) this.#show(placeholderScreen(this.#env, 'map', session, this.#gameActions('map')));
        },
      }),
    );
  }

  exitBox(kind: GameScreenKind): void {
    openExitBox(this.#env, EXIT_BOX_STYLE[kind], (leave) => {
      if (leave) this.leaveGame();
    });
  }

  leaveGame(): void {
    this.#client.leaveSession();
    this.mainMenu();
  }

  frames(frames: readonly ViewFrame[]): void {
    this.#afterLaptop();
    if (frames.some((f) => f.events?.some((e) => e.type === SEX_SCENE))) this.sexScene();
    else if (this.#screens.screen?.id === TACTICAL_SCREEN_ID && this.#host.tactical?.()?.stale) this.enterGame();
  }

  sexScene(): void {
    const controller = new SanMonaController(() => {
      this.enterGame();
      void this.#fade('in');
    });
    this.#show(sanMonaScreen(this.#env, controller));
  }
}
