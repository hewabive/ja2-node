import { describe, expect, it } from 'vitest';
import { ScreenHost } from '../../ui/screen.ts';
import type { SplashPicture } from '../../ui/screens/front-end/splash.ts';
import { playSplashAtStart, type SplashState } from './splash-start.ts';

function start(video: boolean, due = true) {
  const log: string[] = [];
  const states: SplashState[] = [];
  const run = playSplashAtStart({
    due,
    video,
    audible: Promise.resolve(true),
    stage: {} as HTMLElement,
    host: new ScreenHost(),
    clickToStart: { id: 'clickToStart', enter() {}, exit() {}, update() {}, input: () => true, render() {} },
    play: async () => {
      log.push('video');
    },
    fadeIntoMenu: async (picture: SplashPicture) => {
      log.push(picture);
    },
    state: (state) => states.push(state),
  });
  return { run, log, states };
}

describe('the splash at the start of the game page', () => {
  it('plays the video of English and Chinese data, then holds and fades the logo into the menu', async () => {
    const s = start(true);
    await s.run;
    expect(s.log).toEqual(['video', 'logo']);
    expect(s.states).toEqual(['playing', 'still', 'done']);
  });

  it('holds and fades the still of every other version into the menu without a video or a gesture', async () => {
    const s = start(false);
    await s.run;
    expect(s.log).toEqual(['still']);
    expect(s.states).toEqual(['still', 'done']);
  });

  it('goes straight to the menu when the splash is off or was shown in this tab', async () => {
    const s = start(false, false);
    await s.run;
    expect([s.log, s.states]).toEqual([[], ['off']]);
  });
});
