// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/JAScreens.cc SexScreenHandle (sounds/sex.wav at HIGHVOLUME; a step every SMILY_DELAY ms, frame 0 for the
// @src first 24 steps then step % 8; after 32 steps SMILY_END_DELAY ms, then back to the game). The game time warp is the
// @src simulation's.

import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import { UiScreenKind, type UiSoundSink } from '../../widgets/button-sounds.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const SAN_MONA_SCREEN = 'sanMona';
const SMILY_DELAY = 100;
const SMILY_END_DELAY = 1000;
const STEPS = 32;
const STILL_STEPS = 24;
const ANIMATED_FRAMES = 8;
const SEX_SOUND = 'sounds/sex.wav';
const HIGH_VOLUME = 127;

export const SAN_MONA_CONTRACT: ControllerContract = { id: SAN_MONA_SCREEN, actions: {}, bindings: { frame: 'number' } };

export class SanMonaController extends ViewModelController {
  readonly view: { frame: number };
  readonly #done: () => void;
  #step = 0;
  #last = 0;
  #ending = false;
  #finished = false;

  constructor(done: () => void) {
    const view = { frame: 0 };
    super(SAN_MONA_CONTRACT, view);
    this.view = view;
    this.#done = done;
  }

  start(now: number, sounds: UiSoundSink): void {
    this.#last = now;
    sounds.play({ file: SEX_SOUND, volume: HIGH_VOLUME });
  }

  update(now: number): void {
    if (this.#finished) return;
    if (!this.#ending && now - this.#last > SMILY_DELAY) {
      this.#last = now;
      this.#step++;
      if (this.#step === STEPS) this.#ending = true;
    }
    this.view.frame = this.#step < STILL_STEPS ? 0 : this.#step % ANIMATED_FRAMES;
    if (this.#ending && now - this.#last > SMILY_END_DELAY) {
      this.#finished = true;
      this.#done();
    }
  }
}

export function sanMonaScreen(env: FrontEndEnvironment, controller: SanMonaController): FrontEndScreen {
  return new FrontEndScreen(env, {
    id: SAN_MONA_SCREEN,
    layout: FrontEndLayout.SAN_MONA,
    controller,
    soundScreen: UiScreenKind.OTHER,
    hidesCursor: true,
    onEnter: () => {
      env.runtime.pauseGame(true);
      controller.start(env.runtime.clock.ja2Now, env.runtime.sounds);
    },
    onExit: () => env.runtime.pauseGame(false),
    onUpdate: () => controller.update(env.runtime.clock.ja2Now),
  });
}
