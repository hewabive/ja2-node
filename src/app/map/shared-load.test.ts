import { describe, expect, it } from 'vitest';
import type { LoadProgress } from '../../ui/screens/front-end/flow.ts';
import { SharedLoad } from './shared-load.ts';

interface Rig {
  readonly load: SharedLoad;
  readonly runs: () => number;
  step(done: number): void;
  finish(): void;
  fail(): void;
  startDeferred(): void;
}

const TOTAL = 4;

function rig(): Rig {
  let runs = 0;
  let progress: LoadProgress = () => undefined;
  let settle: { resolve: () => void; reject: (error: Error) => void } | null = null;
  const deferred: (() => void)[] = [];
  const load = new SharedLoad(
    (reported) =>
      new Promise<void>((resolve, reject) => {
        runs++;
        progress = reported;
        settle = { resolve, reject };
        reported(0, TOTAL);
      }),
    (start) => deferred.push(start),
  );
  return {
    load,
    runs: () => runs,
    step: (done) => progress(done, TOTAL),
    finish: () => settle?.resolve(),
    fail: () => settle?.reject(new Error('HTTP 500')),
    startDeferred: () => {
      for (const start of deferred.splice(0)) start();
    },
  };
}

describe('the map host load shared by its waiters', () => {
  it('lets a waiter that joins a load in flight follow its progress from the step it has reached', async () => {
    const r = rig();
    const first: number[] = [];
    const later: number[] = [];
    const running = r.load.load((done) => first.push(done));
    r.step(1);
    r.step(2);
    const joined = r.load.load((done) => later.push(done));
    r.step(3);
    r.finish();
    await Promise.all([running, joined]);
    expect([first, later, r.runs()]).toEqual([[0, 1, 2, 3], [2, 3], 1]);
  });

  it('starts the background load once, only when the deferral lets it, and a later waiter follows it', async () => {
    const r = rig();
    r.load.background();
    r.load.background();
    expect(r.runs()).toBe(0);
    r.startDeferred();
    r.step(1);
    const progress: number[] = [];
    const waiting = r.load.load((done) => progress.push(done));
    r.finish();
    await waiting;
    r.load.background();
    r.startDeferred();
    expect([progress, r.runs()]).toEqual([[1], 1]);
  });

  it('lets a failed background load reject nobody, and the next waiter loads again', async () => {
    const r = rig();
    r.load.background();
    r.startDeferred();
    r.fail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const again = r.load.load();
    expect(r.runs()).toBe(2);
    r.finish();
    await expect(again).resolves.toBeUndefined();
  });
});
