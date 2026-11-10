import type { Screen, ScreenHost } from '../../ui/screen.ts';
import { markSplashShown } from '../video/splash-shown.ts';

export type SplashState = 'pending' | 'off' | 'waiting' | 'playing' | 'done';

export interface SplashStart {
  readonly due: boolean;
  readonly audible: Promise<boolean>;
  readonly stage: HTMLElement;
  readonly host: ScreenHost;
  readonly clickToStart: Screen;
  readonly play: () => Promise<unknown>;
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

export async function playSplashAtStart(o: SplashStart): Promise<void> {
  if (!o.due) {
    o.state('off');
    return;
  }
  if (!(await o.audible)) {
    o.state('waiting');
    o.host.push(o.clickToStart);
    await nextGesture(o.stage);
  }
  markSplashShown();
  o.state('playing');
  await o.play();
  o.state('done');
}
