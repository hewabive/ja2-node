import { describe, expect, it } from 'vitest';
import { MAX_ANIMATIONS, MAX_FRAMES_PER_ANIM } from '../formats/ja2bin.ts';
import { type IdleSoldier, idleCheck, idleCheckLoopFrames } from './idle-sounds.ts';

const STANDING = 1;
const CROW: IdleSoldier = { bodyType: 19, gridNo: 100, dying: false, injured: false, inWater: false, standing: true };
const COW: IdleSoldier = { ...CROW, bodyType: 18 };

function scriptsWith(state: number, codes: readonly number[]) {
  const all = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
  all.set(codes, state * MAX_FRAMES_PER_ANIM);
  return { codes: all };
}

const rolls =
  (...values: number[]) =>
  () =>
    values.shift() ?? 0;

describe('idle sounds of code 491', () => {
  it('count the frames of a loop that holds the check, and nothing else', () => {
    expect(idleCheckLoopFrames(scriptsWith(STANDING, [1, 2, 3, 4, 3, 2, 491, 501, 999]), STANDING)).toBe(6);
    expect(idleCheckLoopFrames(scriptsWith(STANDING, [1, 2, 3, 501]), STANDING)).toBeNull();
    expect(idleCheckLoopFrames(scriptsWith(STANDING, [1, 2, 491, 499]), STANDING)).toBeNull();
  });

  it('roll on every third pass, at once while injured, never while dying', () => {
    let counter = 0;
    const played: (string | null)[] = [];
    for (let pass = 0; pass < 6; pass++) {
      const check = idleCheck(counter, CROW, rolls(10));
      counter = check.counter;
      played.push(check.cue?.file ?? null);
    }
    expect(played).toEqual([null, null, 'sounds/crow3.wav', null, null, 'sounds/crow3.wav']);
    expect(idleCheck(0, { ...CROW, injured: true }, rolls(10))).toEqual({ counter: 0, cue: null });
    expect(idleCheck(2, { ...CROW, dying: true }, rolls(10))).toEqual({ counter: 2, cue: null });
  });

  it('pick the sound by the roll, keep the cow quiet on half its rolls, and stay silent in water or off the feet', () => {
    expect(idleCheck(2, CROW, rolls(60)).cue).toMatchObject({ file: 'sounds/crow2.wav', mix: 'location', baseVolume: 65, gridNo: 100 });
    expect(idleCheck(2, CROW, rolls(71)).cue).toBeNull();
    expect(idleCheck(2, COW, rolls(3, 1)).cue?.file).toBe('sounds/cowmoo2.wav');
    expect(idleCheck(2, COW, rolls(3, 0)).cue).toBeNull();
    expect(idleCheck(2, COW, rolls(6, 1)).cue).toBeNull();
    expect(idleCheck(2, { ...CROW, inWater: true }, rolls(10)).cue).toBeNull();
    expect(idleCheck(2, { ...CROW, standing: false }, rolls(10)).cue).toBeNull();
  });
});
