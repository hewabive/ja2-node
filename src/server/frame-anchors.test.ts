import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { NEVER_NEXT_FRAME, predictedFrameSlot } from '../content/anim/schedule-track.ts';
import { type AnimationTimelines, requireAnimationTimelines, spriteFrameAt } from '../content/anim/timelines.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { type ServerMessage, TICK_MS } from '../protocol/messages.ts';
import { applyViewFrame, type PlayerView, type SoldierView } from '../protocol/view.ts';
import { createSandboxSession, tacticalPlayerView } from './sandbox.ts';
import { FRAME_TICKS, Session, type SessionSim } from './session.ts';
import { PROFILE_VOICE } from './soldier-voice.ts';

const SLOW_MS = 120_000;
const IDLE_TICKS = 2000;
const WALK_TICKS = 600;
const FRAME_FIELDS = new Set(['frame', 'frameSlot', 'nextFrameTick']);

interface Watched {
  readonly sim: SessionSim;
  readonly shown: Map<number, Map<number, number>>;
}

function watched(sandbox: SessionSim, timelines: AnimationTimelines): Watched {
  const shown = new Map<number, Map<number, number>>();
  const sim: SessionSim = Object.create(sandbox);
  sim.view = () => {
    const view = sandbox.view();
    shown.set(view.tick, new Map(view.soldiers.map((s) => [s.id, spriteFrameAt(timelines.presentation, s.frameSlot)])));
    return view;
  };
  return { sim, shown };
}

function predictedFrame(timelines: AnimationTimelines, s: SoldierView, tick: number): number {
  return spriteFrameAt(timelines.presentation, predictedFrameSlot(timelines, s, tick, TICK_MS) ?? s.frameSlot);
}

function onlyFrameFieldsDiffer(before: SoldierView, after: SoldierView): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].every(
    (k) => FRAME_FIELDS.has(k) || JSON.stringify(before[k as keyof SoldierView]) === JSON.stringify(after[k as keyof SoldierView]),
  );
}

interface Replay {
  readonly frameTicks: number;
  readonly mismatches: string[];
  readonly frameOnlyResends: number;
  readonly actualFrameChanges: number;
}

function replay(timelines: AnimationTimelines, messages: readonly ServerMessage[], shown: Watched['shown']): Replay {
  let view: PlayerView | null = null;
  const mismatches: string[] = [];
  let frameTicks = 0;
  let frameOnlyResends = 0;
  const frames = messages.flatMap((m) => (m.t === 'frames' ? m.frames : []));
  const welcome = messages.find((m) => m.t === 'welcome');
  if (welcome?.t === 'welcome') view = welcome.view;
  if (view) {
    for (const [i, frame] of frames.entries()) {
      const before: PlayerView = view;
      for (const s of frame.changed) {
        const old = before.soldiers.find((o) => o.id === s.id);
        if (old && onlyFrameFieldsDiffer(old, s)) frameOnlyResends++;
      }
      view = applyViewFrame(before, frame);
      const actual = shown.get(frame.tick);
      if (!actual || frames[i + 1]?.tick === frame.tick) continue;
      frameTicks++;
      for (const s of view.soldiers) {
        const expected = actual.get(s.id);
        const predicted = predictedFrame(timelines, s, frame.tick);
        if (expected !== undefined && predicted !== expected)
          mismatches.push(`tick ${frame.tick} soldier ${s.id}: ${predicted} vs ${expected}`);
      }
    }
  }
  let actualFrameChanges = 0;
  const ticks = [...shown.keys()].sort((a, b) => a - b);
  for (let i = 1; i < ticks.length; i++) {
    const previous = shown.get(ticks[i - 1] as number);
    for (const [id, frame] of shown.get(ticks[i] as number) ?? []) if (previous?.get(id) !== frame) actualFrameChanges++;
  }
  return { frameTicks, mismatches, frameOnlyResends, actualFrameChanges };
}

async function playSandbox(read: ReadFile, originalData: boolean): Promise<Replay> {
  const timelines = await requireAnimationTimelines(read);
  const sandbox = await createSandboxSession(read, originalData);
  const { sim, shown } = watched(sandbox, timelines);
  const session = new Session('frames', sim);
  const messages: ServerMessage[] = [];
  session.subscribe((m) => messages.push(m));
  session.advance({ ticks: IDLE_TICKS });
  const ours = session.sim.view().soldiers.find((s) => s.team === 0);
  if (ours) session.dispatch({ type: 'move', soldier: ours.id, to: ours.gridNo + 4, mode: 'walk' });
  session.advance({ ticks: WALK_TICKS });
  return replay(timelines, messages, shown);
}

function expectPredictedFrames(result: Replay): void {
  expect(result.frameTicks).toBeGreaterThan((IDLE_TICKS + WALK_TICKS) / FRAME_TICKS - 2);
  expect(result.mismatches.slice(0, 5)).toEqual([]);
  expect(result.actualFrameChanges).toBeGreaterThan(100);
  expect(result.frameOnlyResends).toBeLessThan(result.actualFrameChanges / 10);
}

describe('soldier frames the client predicts from the last sent frame', () => {
  let kit: StubSectorKit;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  }, SLOW_MS);

  afterAll(async () => {
    await kit.dispose();
  });

  it(
    'match the simulation at every frame tick on the stub sandbox, while breathing goes unsent',
    async () => {
      expectPredictedFrames(await playSandbox(kit.read, false));
    },
    SLOW_MS,
  );

  it('count the next frame in the view ticks, and never while the tactical sim does not step', async () => {
    const timelines = await requireAnimationTimelines(kit.read);
    const sandbox = await createSandboxSession(kit.read, false);
    const sim = sandbox.sim;
    for (let i = 0; i < 25; i++) sim.step();
    const own = tacticalPlayerView(sim, sim.tick, timelines.presentation);
    const later = tacticalPlayerView(sim, sim.tick + 1000, timelines.presentation);
    const frozen = tacticalPlayerView(sim, sim.tick + 1000, timelines.presentation, PROFILE_VOICE, false);
    const advancing = own.soldiers.filter((s) => s.nextFrameTick !== NEVER_NEXT_FRAME);
    expect(advancing.length).toBeGreaterThan(0);
    for (const s of advancing) expect(later.soldiers.find((o) => o.id === s.id)?.nextFrameTick).toBe((s.nextFrameTick ?? 0) + 1000);
    expect(frozen.soldiers.every((s) => s.nextFrameTick === NEVER_NEXT_FRAME)).toBe(true);
  });
});

describe.skipIf(!process.env.JA2_DATA_DIR)('soldier frames the client predicts, on the original data', () => {
  let data: DataVfs;
  const read: ReadFile = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR ?? '' });
  }, SLOW_MS);

  afterAll(async () => {
    await data.close();
  });

  it(
    'match the simulation at every frame tick in A9, while breathing goes unsent',
    async () => {
      expectPredictedFrames(await playSandbox(read, true));
    },
    SLOW_MS,
  );
});
