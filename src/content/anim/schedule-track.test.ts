import { describe, expect, it } from 'vitest';
import { type AnimationScripts, MAX_ANIMATIONS, MAX_FRAMES_PER_ANIM } from '../formats/ja2bin.ts';
import { NEVER_NEXT_FRAME, predictedFrameSlot, silentAnimation, ticksPerFrame } from './schedule-track.ts';
import { splitAnimationScripts, timelineSlot } from './timelines.ts';

const MS_PER_TICK = 5;
const BREATH = 1;
const RELOAD = 2;
const ONCE = 3;
const frame = (n: number) => n + 1;
const jumpTo = (pc: number) => 501 + pc;
const QUIET_OP = 402;
const FOOTSTEP_SOUND = 703;
const END_OF_ANIMATION = 499;

function timelines(map: Readonly<Record<number, readonly number[]>>) {
  const codes = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
  for (const [state, list] of Object.entries(map)) codes.set(list, Number(state) * MAX_FRAMES_PER_ANIM);
  const scripts: AnimationScripts = { codes };
  return splitAnimationScripts(scripts);
}

const scripts = timelines({
  [BREATH]: [frame(0), frame(1), QUIET_OP, frame(2), jumpTo(1)],
  [RELOAD]: [frame(0), FOOTSTEP_SOUND, frame(1), jumpTo(0)],
  [ONCE]: [frame(0), frame(1), END_OF_ANIMATION],
});
const slot = (state: number, pc: number) => timelineSlot(state, pc);
const anchor = { animation: BREATH, frameSlot: slot(BREATH, 0), frameDelay: 20, nextFrameTick: 100 };

describe('predicting the frame of a soldier from its last sent frame', () => {
  it('keeps the frame until its next tick, then steps one frame per period through the loop', () => {
    expect(ticksPerFrame(20, MS_PER_TICK)).toBe(4);
    const at = (tick: number) => predictedFrameSlot(scripts, anchor, tick, MS_PER_TICK);
    expect(at(99)).toBe(slot(BREATH, 0));
    expect(at(100)).toBe(slot(BREATH, 1));
    expect(at(103)).toBe(slot(BREATH, 1));
    expect(at(104)).toBe(slot(BREATH, 3));
    expect(at(108)).toBe(slot(BREATH, 1));
    expect(at(112)).toBe(slot(BREATH, 3));
    expect(at(100 + 4 * 1001)).toBe(slot(BREATH, 3));
  });

  it('rounds a delay up to whole ticks and steps every tick without a delay, as the frame timer does', () => {
    expect(ticksPerFrame(22, MS_PER_TICK)).toBe(5);
    expect(ticksPerFrame(0, MS_PER_TICK)).toBe(1);
    const everyTick = { ...anchor, frameDelay: 0 };
    expect(predictedFrameSlot(scripts, everyTick, 101, MS_PER_TICK)).toBe(slot(BREATH, 3));
  });

  it('holds a frame that never advances and gives up without a next tick, off the track or past its end', () => {
    expect(predictedFrameSlot(scripts, { ...anchor, nextFrameTick: NEVER_NEXT_FRAME }, 5000, MS_PER_TICK)).toBe(slot(BREATH, 0));
    expect(predictedFrameSlot(scripts, { animation: BREATH, frameSlot: slot(BREATH, 0), frameDelay: 20 }, 5000, MS_PER_TICK)).toBeNull();
    expect(predictedFrameSlot(scripts, { ...anchor, frameSlot: slot(BREATH, 2) }, 100, MS_PER_TICK)).toBeNull();
    const once = { animation: ONCE, frameSlot: slot(ONCE, 0), frameDelay: 20, nextFrameTick: 100 };
    expect(predictedFrameSlot(scripts, once, 100, MS_PER_TICK)).toBe(slot(ONCE, 1));
    expect(predictedFrameSlot(scripts, once, 104, MS_PER_TICK)).toBeNull();
  });

  it('tells a silent animation from one whose script plays sounds', () => {
    expect(silentAnimation(scripts, BREATH)).toBe(true);
    expect(silentAnimation(scripts, RELOAD)).toBe(false);
  });
});
