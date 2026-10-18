import { describe, expect, it } from 'vitest';
import { type AnimationScripts, MAX_ANIMATIONS, MAX_FRAMES_PER_ANIM } from '../formats/ja2bin.ts';
import { followTimeline, locateFrame } from './timeline-follower.ts';

const WALK = 0;
const STAND = 1;
const KNEEL = 2;
const CROUCH = 3;
const FIRE = 4;

function scripts(map: Readonly<Record<number, readonly number[]>>): AnimationScripts {
  const codes = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
  for (const [state, list] of Object.entries(map)) codes.set(list, Number(state) * MAX_FRAMES_PER_ANIM);
  return { codes };
}

const s = scripts({
  [WALK]: [1, 750, 703, 2, 3, 4, 704, 5, 6, 501],
  [STAND]: [1, 2, 3, 501],
  [KNEEL]: [1, 774, 2, 3, 499, 999],
  [CROUCH]: [6, 7, 501],
  [FIRE]: [757, 1, 2, 3, 600 + CROUCH],
});

describe('following an animation timeline between view snapshots', () => {
  it('locates a frame without replaying codes when the soldier first appears', () => {
    expect(followTimeline(s, null, { state: WALK, frame: 3 })).toEqual({ position: { state: WALK, pc: 6, frame: 3 }, ops: [] });
    expect(locateFrame(s, { state: STAND, frame: 9 })).toEqual({ state: STAND, frame: 9, pc: 0 });
  });

  it('reports the codes passed between two frames of one state, across a loop', () => {
    const at2 = followTimeline(s, null, { state: WALK, frame: 0 }).position;
    const step = followTimeline(s, at2, { state: WALK, frame: 2 });
    expect(step.ops).toEqual([750, 703]);
    const lap = followTimeline(s, step.position, { state: WALK, frame: 1 });
    expect(lap.ops).toEqual([704, 750, 703]);
    expect(followTimeline(s, lap.position, { state: WALK, frame: 1 }).ops).toEqual([]);
  });

  it('runs into a new state from its start and keeps the old tail only when it ends or jumps there soon', () => {
    const kneeling = followTimeline(s, followTimeline(s, null, { state: STAND, frame: 1 }).position, { state: KNEEL, frame: 2 });
    expect(kneeling.ops).toEqual([774]);
    const ended = followTimeline(s, followTimeline(s, null, { state: KNEEL, frame: 2 }).position, { state: CROUCH, frame: 5 });
    expect(ended.ops).toEqual([499]);
    const firing = followTimeline(s, followTimeline(s, null, { state: FIRE, frame: 1 }).position, { state: CROUCH, frame: 6 });
    expect(firing.ops).toEqual([]);
    expect(firing.position).toEqual({ state: CROUCH, pc: 2, frame: 6 });
    const interrupted = followTimeline(s, followTimeline(s, null, { state: WALK, frame: 0 }).position, { state: STAND, frame: 0 });
    expect(interrupted.ops).toEqual([]);
  });

  it('resynchronises without codes when the frame is not reachable', () => {
    const lost = followTimeline(s, followTimeline(s, null, { state: STAND, frame: 0 }).position, { state: STAND, frame: 7 });
    expect(lost).toEqual({ position: { state: STAND, frame: 7, pc: 0 }, ops: [] });
  });
});
