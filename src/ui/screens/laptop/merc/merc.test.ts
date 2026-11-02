import { describe, expect, it } from 'vitest';
import { MERC_EXIT_TIME, MERC_INTRO_TIME, SpeckMode, SpeckVideo } from './speck-video.ts';

function speck(talkMs = 2000) {
  const said: number[] = [];
  const faces: number[] = [];
  let stops = 0;
  let talkingFrom: number | null = null;
  const video = new SpeckVideo({
    initFace: (now) => {
      faces.push(now);
    },
    say: (quote, now) => {
      said.push(quote);
      talkingFrom = now;
    },
    faceTalking: (now) => talkingFrom !== null && now - talkingFrom <= talkMs,
    stop: () => {
      stops++;
      talkingFrom = null;
    },
  });
  return { video, said, faces, stops: () => stops };
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

  it("puts up Speck's face as the window opens and holds each quote as long as the face talks", () => {
    const { video, said, faces } = speck(300);
    video.enqueue([7, 8], 5);
    expect(faces).toEqual([5]);
    video.update(MERC_INTRO_TIME + 6);
    video.update(MERC_INTRO_TIME + 306);
    expect([said, video.talking]).toEqual([[7], true]);
    video.update(MERC_INTRO_TIME + 307);
    expect(said).toEqual([7, 8]);
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
    const { video, faces } = speck(10);
    video.enqueue([1], 0);
    video.update(MERC_INTRO_TIME + 1);
    video.close(MERC_INTRO_TIME + 2);
    video.enqueue([9], MERC_INTRO_TIME + 3);
    video.update(MERC_INTRO_TIME + 3 + MERC_EXIT_TIME + 1);
    expect(video.mode).toBe(SpeckMode.INIT);
    expect(faces).toEqual([0, MERC_INTRO_TIME + 3 + MERC_EXIT_TIME + 1]);
  });

  it('ignores an empty queue', () => {
    const { video } = speck();
    video.enqueue([], 0);
    expect(video.displayed).toBe(false);
  });
});
