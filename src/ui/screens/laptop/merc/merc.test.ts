import { describe, expect, it } from 'vitest';
import { leastSaidQuote, SPECK_IDLE_CHAT_DELAY, SpeckIdleChat } from './speck-idle.ts';
import { MERC_EXIT_TIME, MERC_INTRO_TIME, SpeckMode, SpeckVideo } from './speck-video.ts';

function speck(talkMs = 2000, openingDue = false) {
  const said: number[] = [];
  const faces: number[] = [];
  const ends: number[] = [];
  const openings: number[] = [];
  let due = openingDue;
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
    talkEnded: (now) => {
      ends.push(now);
    },
    conditionalOpening: (now) => {
      openings.push(now);
      const asked = due;
      due = false;
      return asked;
    },
  });
  return { video, said, faces, ends, openings, stops: () => stops };
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

  it('asks for the conditional opening as a talk ends with nothing left, and holds the video with the face up until its quotes come', () => {
    const { video, said, ends, openings } = speck(100, true);
    video.enqueue([49], 0);
    video.update(MERC_INTRO_TIME + 1);
    video.update(MERC_INTRO_TIME + 102);
    expect([ends, openings, video.mode, video.awaitingOpening]).toEqual([
      [MERC_INTRO_TIME + 102],
      [MERC_INTRO_TIME + 102],
      SpeckMode.VIDEO,
      true,
    ]);
    video.update(MERC_INTRO_TIME + 900);
    expect([ends.length, openings.length, video.mode]).toEqual([1, 1, SpeckMode.VIDEO]);
    video.openingArrived([10, 22], MERC_INTRO_TIME + 901);
    video.update(MERC_INTRO_TIME + 902);
    expect([said, video.mode]).toEqual([[49, 10], SpeckMode.VIDEO]);
    video.update(MERC_INTRO_TIME + 1003);
    video.update(MERC_INTRO_TIME + 1104);
    expect([said, ends.length, openings.length, video.mode]).toEqual([[49, 10, 22], 2, 2, SpeckMode.EXIT]);
  });

  it('closes the video when the opening brings nothing, and drops one that comes after the X', () => {
    const empty = speck(100, true);
    empty.video.enqueue([49], 0);
    empty.video.update(MERC_INTRO_TIME + 1);
    empty.video.update(MERC_INTRO_TIME + 102);
    empty.video.openingArrived([], MERC_INTRO_TIME + 103);
    expect([empty.video.mode, empty.ends.length]).toEqual([SpeckMode.EXIT, 1]);
    const closed = speck(100, true);
    closed.video.enqueue([49], 0);
    closed.video.update(MERC_INTRO_TIME + 1);
    closed.video.update(MERC_INTRO_TIME + 102);
    closed.video.close(MERC_INTRO_TIME + 103);
    closed.video.openingArrived([10], MERC_INTRO_TIME + 104);
    closed.video.update(MERC_INTRO_TIME + 103 + MERC_EXIT_TIME + 1);
    expect([closed.video.displayed, closed.video.queue, closed.said]).toEqual([false, [], [49]]);
  });

  it('ignores an empty queue', () => {
    const { video } = speck();
    video.enqueue([], 0);
    expect(video.displayed).toBe(false);
  });
});

describe("Speck's idle chatter", () => {
  const ADVERTS = [49, 50];
  const SLANDERS = [58, 59, 60, 61];
  const QUOTES = [...ADVERTS, ...SLANDERS];

  it('reports the end of a talk with nothing left, a subtitle click included, but not a close on the X', () => {
    const { video, ends } = speck(100);
    video.enqueue([1, 2], 0);
    video.update(MERC_INTRO_TIME + 1);
    video.update(MERC_INTRO_TIME + 102);
    expect(ends).toEqual([]);
    video.shutUp();
    video.update(MERC_INTRO_TIME + 103);
    expect(ends).toEqual([MERC_INTRO_TIME + 103]);
    video.update(MERC_INTRO_TIME + 103 + MERC_EXIT_TIME + 1);
    video.enqueue([3], 5000);
    video.update(5000 + MERC_INTRO_TIME + 1);
    video.close(5000 + MERC_INTRO_TIME + 2);
    video.update(5000 + MERC_INTRO_TIME + 3);
    expect(ends).toHaveLength(1);
  });

  it('picks the first quote said least, in the order of the available quotes', () => {
    expect(leastSaidQuote(QUOTES, new Map())).toBe(49);
    expect(leastSaidQuote(QUOTES, new Map([[49, 1]]))).toBe(50);
    expect(
      leastSaidQuote(
        QUOTES,
        new Map([
          [49, 3],
          [50, 3],
          [58, 3],
          [59, 3],
          [60, 1],
          [61, 3],
        ]),
      ),
    ).toBe(60);
    expect(leastSaidQuote([], new Map())).toBeNull();
  });

  it('says a quote only once more than 10 s passed since the last reset, the timer reset again whether or not the video is up', () => {
    const said = new Map<number, number>();
    const idle = new SpeckIdleChat(said, 1000);
    expect(idle.update(1000 + SPECK_IDLE_CHAT_DELAY, false, QUOTES)).toBeNull();
    expect(idle.update(1001 + SPECK_IDLE_CHAT_DELAY, true, QUOTES)).toBeNull();
    expect(idle.update(1001 + 2 * SPECK_IDLE_CHAT_DELAY, false, QUOTES)).toBeNull();
    expect(idle.update(1002 + 2 * SPECK_IDLE_CHAT_DELAY, false, QUOTES)).toBe(49);
    idle.reset(50_000);
    expect(idle.update(50_000 + SPECK_IDLE_CHAT_DELAY + 1, false, QUOTES)).toBe(50);
  });

  it('counts an advert (47 to 57) as said once and an A.I.M. slander three times, so the slanders come a third as often', () => {
    const said = new Map<number, number>();
    const idle = new SpeckIdleChat(said, 0);
    const picks: (number | null)[] = [];
    for (let k = 1; k <= 12; k++) picks.push(idle.update(k * (SPECK_IDLE_CHAT_DELAY + 1), false, QUOTES));
    expect(picks).toEqual([49, 50, 58, 59, 60, 61, 49, 50, 49, 50, 49, 50]);
    expect(Object.fromEntries(said)).toEqual({ 49: 4, 50: 4, 58: 3, 59: 3, 60: 3, 61: 3 });
  });
});
