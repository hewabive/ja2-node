import { describe, expect, it } from 'vitest';
import { type FrontEndTest, frontEndTest } from '../../../../tests/support/front-end.ts';
import { SanMonaController } from './san-mona.ts';

const STEP_MS = 101;
const END_MS = 1001;
const SOUND = { file: 'sounds/sex.wav', volume: 127 };

function played(): { sounds: unknown[]; play: (request: unknown) => void } {
  const sounds: unknown[] = [];
  return { sounds, play: (request) => sounds.push(request) };
}

describe('the San Mona screen (JAScreens.cc SexScreenHandle)', () => {
  it('shows frame 0 for 24 steps of 100 ms, then the step modulo 8, waits a second after 32 steps and returns', () => {
    let done = 0;
    const controller = new SanMonaController(() => done++);
    const sink = played();
    controller.start(0, sink);
    expect(sink.sounds).toEqual([SOUND]);
    const frames: number[] = [];
    let now = 0;
    for (let step = 1; step <= 32; step++) {
      now += STEP_MS;
      controller.update(now);
      frames.push(controller.view.frame);
    }
    expect(frames.slice(0, 23).every((f) => f === 0)).toBe(true);
    expect(frames.slice(23)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
    controller.update(now + END_MS - 2);
    expect(done).toBe(0);
    controller.update(now + END_MS);
    expect(done).toBe(1);
    controller.update(now + 2 * END_MS);
    expect(done).toBe(1);
  });

  it('holds the game time while it is up and fades back into the game', async () => {
    const f: FrontEndTest = await frontEndTest();
    f.flow.sexScene();
    await f.settle();
    expect(f.screen()).toBe('sanMona');
    expect(f.pauses).toEqual([true]);
    expect(f.draw().items.some((i) => i.kind === 'image' && i.asset === 'interface/luckysmile.sti')).toBe(true);
    for (let i = 0; i < 400 && f.screen() === 'sanMona'; i++) f.t.frame(16);
    expect(f.screen()).not.toBe('sanMona');
    expect(f.pauses).toEqual([true, false]);
    expect(f.modal()).toBe('fade-in');
  });
});
