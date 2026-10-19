import { describe, expect, it } from 'vitest';
import { startFrameLoop } from './frame-loop.ts';

describe('the frame loop', () => {
  it('runs one frame per requested animation frame on the injected clock until stopped', () => {
    const queued: (() => void)[] = [];
    const seen: number[] = [];
    let now = 0;
    const loop = startFrameLoop({ now: () => now, requestFrame: (run) => queued.push(run), frame: (t) => seen.push(t) });
    for (let i = 0; i < 3; i++) {
      now += 16;
      queued.shift()?.();
    }
    loop.stop();
    queued.shift()?.();
    expect(seen).toEqual([16, 32, 48]);
    expect(queued).toEqual([]);
  });

  it('stops and reports when a frame throws', () => {
    const queued: (() => void)[] = [];
    const failures: unknown[] = [];
    startFrameLoop({
      now: () => 0,
      requestFrame: (run) => queued.push(run),
      frame: () => {
        throw new Error('broken frame');
      },
      failed: (error) => failures.push(error),
    });
    queued.shift()?.();
    expect(failures).toHaveLength(1);
    expect(queued).toEqual([]);
  });
});
