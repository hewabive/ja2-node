// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/JA2_Splash.cc guiSplashFrameFade, InitJA2SplashScreen; src/game/JAScreens.h INTRO_SPLASH_DURATION;
// @src src/game/JAScreens.cc InitScreenHandle (the picture held INTRO_SPLASH_DURATION before the main menu);
// @src src/game/MainMenuScreen.cc MainMenuScreenHandle (no cursor and no music while held; then, while the counter is
// @src above 2, the frame buffer shaded once more each frame, at 2 filled black, at 1 the main menu music and cursor);
// @src src/sgp/VSurface.cc ShadowRectUsingLowPercentTable (the 0.8 colour modulation), FillVideoSurfaceWithStretch.
// @src The original takes one fade step per loop pass; ja2-node one every FADE_STEP_MS.

import { frameOf, type ImageCatalog } from '../../assets.ts';
import { type Area, type DrawList, LOW_PERCENT_SHADOW_FACTOR, rgb } from '../../draw-list.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { FADE_STEP_MS } from '../../widgets/fade.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const SPLASH_SCREEN = 'splash';
export const INTRO_SPLASH_DURATION = 500;
export const SPLASH_FRAME_FADE = 10;
const BLACK_FRAME = 2;
const MENU_FRAME = 1;
const STILL_SNAPSHOT = 'splash.still';
const BLACK = rgb(0, 0, 0);

export type SplashPicture = 'still' | 'logo';

export const SPLASH_CONTRACT: ControllerContract = { id: SPLASH_SCREEN, actions: {}, bindings: { picture: 'string' } };

export interface SplashEvents {
  readonly menuMusic: () => void;
  readonly done: () => void;
}

export class SplashController extends ViewModelController {
  readonly #events: SplashEvents;
  #start: number | null = null;
  #counter: number | null = null;
  #musicStarted = false;
  #done = false;

  constructor(picture: SplashPicture, events: SplashEvents) {
    super(SPLASH_CONTRACT, { picture });
    this.#events = events;
  }

  get counter(): number | null {
    return this.#counter;
  }

  get shades(): number {
    const counter = this.#counter;
    return counter !== null && counter > BLACK_FRAME ? SPLASH_FRAME_FADE - counter + 1 : 0;
  }

  get black(): boolean {
    return this.#counter !== null && this.#counter <= BLACK_FRAME;
  }

  get showsCursor(): boolean {
    return this.#counter !== null && this.#counter <= MENU_FRAME;
  }

  update(now: number): void {
    this.#start ??= now;
    const sinceHeld = now - this.#start - INTRO_SPLASH_DURATION;
    if (sinceHeld < 0) return;
    this.#counter = Math.max(0, SPLASH_FRAME_FADE - Math.floor(sinceHeld / FADE_STEP_MS));
    if (this.#counter <= MENU_FRAME && !this.#musicStarted) {
      this.#musicStarted = true;
      this.#events.menuMusic();
    }
    if (this.#counter === 0 && !this.#done) {
      this.#done = true;
      this.#events.done();
    }
  }
}

function drawStretchedStill(model: LayoutModel, images: ImageCatalog) {
  const path = model.asset('still').path;
  return (list: DrawList, rect: Area): void => {
    const still = frameOf(images, path, 0);
    if (still.width === 0 || still.height === 0) return;
    list.image(path, 0, 0, 0);
    list.capture(STILL_SNAPSHOT);
    list.snapshot(STILL_SNAPSHOT, { x: 0, y: 0, width: still.width, height: still.height }, rect);
  };
}

function drawFade(controller: SplashController) {
  return (list: DrawList, rect: Area): void => {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    if (controller.black) {
      list.fill(rect.x, rect.y, right, bottom, BLACK);
      return;
    }
    for (let shade = 0; shade < controller.shades; shade++) list.shadow(rect.x, rect.y, right - 1, bottom - 1, LOW_PERCENT_SHADOW_FACTOR);
  };
}

export function splashScreen(env: FrontEndEnvironment, picture: SplashPicture, events: SplashEvents): FrontEndScreen {
  const controller = new SplashController(picture, events);
  return new FrontEndScreen(env, {
    id: SPLASH_SCREEN,
    layout: FrontEndLayout.SPLASH,
    controller,
    soundScreen: UiScreenKind.OTHER,
    custom: {
      splashStill: drawStretchedStill(env.layout(FrontEndLayout.SPLASH), env.runtime.images),
      splashFade: drawFade(controller),
    },
    onUpdate: () => controller.update(env.runtime.clock.ja2Now),
    hidesCursor: () => !controller.showsCursor,
  });
}
