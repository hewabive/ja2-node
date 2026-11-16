// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/sgp/SGP.cc main (the splash video for English and Chinese data, the still of the other versions shown by
// @src InitJA2SplashScreen); src/game/Intro.cc PrepareToExitIntroScreen (DisplaySirtechSplashScreen as the splash video
// @src ends or is escaped); src/game/MainMenuScreen.cc MainMenuScreenHandle (the picture held, then faded into the menu).

import type { Screen, ScreenHost } from '../../ui/screen.ts';
import type { SplashPicture } from '../../ui/screens/front-end/splash.ts';
import { markSplashShown } from '../video/splash-shown.ts';

export type SplashState = 'pending' | 'off' | 'waiting' | 'playing' | 'still' | 'done';

export interface SplashStart {
  readonly due: boolean;
  readonly video: boolean;
  readonly audible: Promise<boolean>;
  readonly stage: HTMLElement;
  readonly host: ScreenHost;
  readonly clickToStart: Screen;
  readonly play: () => Promise<unknown>;
  readonly fadeIntoMenu: (picture: SplashPicture) => Promise<void>;
  readonly state: (state: SplashState) => void;
}

function nextGesture(stage: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const listening = new AbortController();
    const done = () => {
      listening.abort();
      resolve();
    };
    stage.addEventListener('pointerup', done, { signal: listening.signal });
    window.addEventListener('keyup', done, { signal: listening.signal });
  });
}

async function playVideo(o: SplashStart): Promise<void> {
  if (!(await o.audible)) {
    o.state('waiting');
    o.host.push(o.clickToStart);
    await nextGesture(o.stage);
  }
  markSplashShown();
  o.state('playing');
  await o.play();
}

export async function playSplashAtStart(o: SplashStart): Promise<void> {
  if (!o.due) {
    o.state('off');
    return;
  }
  if (o.video) await playVideo(o);
  else markSplashShown();
  o.state('still');
  await o.fadeIntoMenu(o.video ? 'logo' : 'still');
  o.state('done');
}
