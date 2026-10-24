import { describe, expect, it } from 'vitest';
import { MERC_EXIT_TIME, MERC_INTRO_TIME, SpeckMode, SpeckVideo } from './speck-video.ts';

function speck(duration = 2000) {
  const said: number[] = [];
  let stops = 0;
  const video = new SpeckVideo({
    say: (quote) => {
      said.push(quote);
      return duration;
    },
    stop: () => {
      stops++;
    },
  });
  return { video, said, stops: () => stops };
}

describe("Speck's video window", () => {
  it('opens black, says the queued quotes one after the other and closes black', () => {
    const { video, said } = speck();
    video.enqueue([0, 1], 0);
    expect([video.mode, video.black, video.displayed]).toEqual([SpeckMode.INIT, true, true]);
    video.update(MERC_INTRO_TIME);
    expect(said).toEqual([]);
    video.update(MERC_INTRO_TIME + 1);
    expect([video.mode, said]).toEqual([SpeckMode.VIDEO, [0]]);
    video.update(MERC_INTRO_TIME + 2002);
    expect(said).toEqual([0, 1]);
    video.update(MERC_INTRO_TIME + 4003);
    expect(video.mode).toBe(SpeckMode.EXIT);
    video.update(MERC_INTRO_TIME + 4003 + MERC_EXIT_TIME + 1);
    expect(video.displayed).toBe(false);
  });

  it('skips the current quote on a subtitle click and closes on the X', () => {
    const { video, said, stops } = speck();
    video.enqueue([3, 4, 5], 0);
    video.update(MERC_INTRO_TIME + 1);
    video.shutUp();
    expect(stops()).toBe(1);
    video.update(MERC_INTRO_TIME + 2);
    expect(said).toEqual([3, 4]);
    video.close(MERC_INTRO_TIME + 3);
    expect([video.mode, video.queue.length, video.talking]).toEqual([SpeckMode.EXIT, 0, false]);
  });

  it('opens again after the exit when new quotes arrive meanwhile', () => {
    const { video } = speck(10);
    video.enqueue([1], 0);
    video.update(MERC_INTRO_TIME + 1);
    video.close(MERC_INTRO_TIME + 2);
    video.enqueue([9], MERC_INTRO_TIME + 3);
    video.update(MERC_INTRO_TIME + 3 + MERC_EXIT_TIME + 1);
    expect(video.mode).toBe(SpeckMode.INIT);
  });

  it('ignores an empty queue', () => {
    const { video } = speck();
    video.enqueue([], 0);
    expect(video.displayed).toBe(false);
  });
});
