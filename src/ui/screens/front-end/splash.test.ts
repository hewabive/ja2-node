import { describe, expect, it } from 'vitest';
import { FADE_STEP_MS } from '../../widgets/fade.ts';
import { INTRO_SPLASH_DURATION, SPLASH_FRAME_FADE, SplashController } from './splash.ts';

function splash() {
  const events: string[] = [];
  const controller = new SplashController('still', { menuMusic: () => events.push('music'), done: () => events.push('done') });
  const at = (ms: number) => {
    controller.update(ms);
    return { counter: controller.counter, shades: controller.shades, black: controller.black, cursor: controller.showsCursor };
  };
  return { controller, events, at };
}

describe('the splash fade into the main menu', () => {
  it('holds the picture for INTRO_SPLASH_DURATION from its first frame, with no cursor and no music', () => {
    const s = splash();
    expect(s.at(1000)).toEqual({ counter: null, shades: 0, black: false, cursor: false });
    expect(s.at(1000 + INTRO_SPLASH_DURATION - 1)).toEqual({ counter: null, shades: 0, black: false, cursor: false });
    expect(s.events).toEqual([]);
  });

  it('shades the screen once more on every frame while the counter is above 2, as the frame buffer keeps the last shade', () => {
    const s = splash();
    s.at(0);
    const shades = Array.from({ length: 8 }, (_, step) => s.at(INTRO_SPLASH_DURATION + step * FADE_STEP_MS));
    expect(shades.map((f) => [f.counter, f.shades])).toEqual([
      [SPLASH_FRAME_FADE, 1],
      [9, 2],
      [8, 3],
      [7, 4],
      [6, 5],
      [5, 6],
      [4, 7],
      [3, 8],
    ]);
    expect(shades.every((f) => !f.black && !f.cursor)).toBe(true);
    expect(s.events).toEqual([]);
  });

  it('fills the screen black at 2, starts the menu music and the cursor on the black screen at 1, and leaves at 0', () => {
    const s = splash();
    s.at(0);
    expect(s.at(INTRO_SPLASH_DURATION + 8 * FADE_STEP_MS)).toEqual({ counter: 2, shades: 0, black: true, cursor: false });
    expect(s.events).toEqual([]);
    expect(s.at(INTRO_SPLASH_DURATION + 9 * FADE_STEP_MS)).toEqual({ counter: 1, shades: 0, black: true, cursor: true });
    expect(s.events).toEqual(['music']);
    s.at(INTRO_SPLASH_DURATION + 10 * FADE_STEP_MS);
    s.at(INTRO_SPLASH_DURATION + 11 * FADE_STEP_MS);
    expect(s.events).toEqual(['music', 'done']);
  });

  it('starts the music before leaving when a slow frame skips the last fade steps', () => {
    const s = splash();
    s.at(0);
    s.at(10_000);
    expect(s.events).toEqual(['music', 'done']);
  });
});
