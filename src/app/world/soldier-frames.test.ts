import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { loadTestTimelines } from '../../../tests/support/tactical.ts';
import { FIRE_WEAPON_OPCODE, stateTrack } from '../../content/anim/schedule-track.ts';
import { type AnimationTimelines, requireAnimationTimelines, splitAnimationScripts, timelineSlot } from '../../content/anim/timelines.ts';
import { MAX_ANIMATIONS, MAX_FRAMES_PER_ANIM } from '../../content/formats/ja2bin.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { WORLD_COLS } from '../../content/world/grid.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { TICK_MS } from '../../protocol/messages.ts';
import type { SoldierView } from '../../protocol/view.ts';
import { createSandboxSession, type TacticalSession } from '../../server/sandbox.ts';
import type { SimEvent } from '../../sim/events.ts';
import { SoldierFrames } from './soldier-frames.ts';

const STATE = 7;
const JUMP_TO_START = 501;
const END_OF_ANIMATION = 499;

function scripted(codes: Readonly<Record<number, readonly number[]>>): AnimationTimelines {
  const all = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
  for (const [state, list] of Object.entries(codes)) all.set(list, timelineSlot(Number(state), 0));
  return splitAnimationScripts({ codes: all });
}

const frameCode = (frame: number) => frame + 1;

describe('soldier frames from the animation schedule', () => {
  const client = scripted({
    [STATE]: [frameCode(0), frameCode(1), frameCode(2), frameCode(3), FIRE_WEAPON_OPCODE, frameCode(4), frameCode(5), END_OF_ANIMATION],
    [STATE + 1]: [frameCode(10), frameCode(11), frameCode(12), JUMP_TO_START],
  });

  it('walks a state into frames, its fire markers and its loop', () => {
    expect(stateTrack(client, STATE)).toEqual({ frames: [0, 1, 2, 3, 4, 5], markers: [4], loopStart: null });
    expect(stateTrack(client, STATE + 1)).toEqual({ frames: [10, 11, 12], markers: [], loopStart: 0 });
  });

  it('shows the presentation frame of the slot when the scripts are the same', () => {
    const frames = new SoldierFrames(client, true, TICK_MS);
    const schedule = { animation: STATE, frameSlot: timelineSlot(STATE, 2), stateTick: 0, frameDelay: 80 };
    expect(frames.frameOf(1, schedule, 1000)).toBe(2);
  });

  it('stretches the frames before the fire marker onto the server tick of the shot', () => {
    const frames = new SoldierFrames(client, false, TICK_MS);
    const schedule = { animation: STATE, frameSlot: 0, stateTick: 100, frameDelay: 50 };
    expect(frames.frameOf(1, schedule, 100)).toBe(0);
    expect(frames.frameOf(1, schedule, 160)).toBe(3);
    expect(frames.frameOf(1, schedule, 400)).toBe(3);
    frames.observe([{ type: 'shotFired', tick: 420, soldier: 1, target: 0, chance: 50, hit: false } as SimEvent]);
    expect(frames.frameOf(1, schedule, 419)).toBe(3);
    expect(frames.frameOf(1, schedule, 420)).toBe(4);
    expect(frames.frameOf(1, schedule, 430)).toBe(5);
    expect(frames.frameOf(1, schedule, 260)).toBe(2);
  });

  it('squeezes them when the shot comes before the nominal fire frame', () => {
    const frames = new SoldierFrames(client, false, TICK_MS);
    frames.observe([{ type: 'meleeStrike', tick: 104, soldier: 1, target: 0, weapon: 'punch', chance: 50, hit: true } as SimEvent]);
    const schedule = { animation: STATE, frameSlot: 0, stateTick: 100, frameDelay: 50 };
    expect(frames.frameOf(1, schedule, 102)).toBe(2);
    expect(frames.frameOf(1, schedule, 104)).toBe(4);
  });

  it('plays a looping state at its frame delay', () => {
    const frames = new SoldierFrames(client, false, TICK_MS);
    const schedule = { animation: STATE + 1, frameSlot: 0, stateTick: 0, frameDelay: 50 };
    expect([0, 10, 20, 30, 40].map((tick) => frames.frameOf(1, schedule, tick))).toEqual([10, 11, 12, 10, 11]);
  });
});

interface MarkerCheck {
  readonly state: number;
  readonly frame: number;
  readonly expected: number;
}

const SHOT_TICKS = 4000;
const SHOT_DISTANCE_ROWS = 4;

function shootAndFollow(
  session: TacticalSession,
  client: AnimationTimelines,
  server: AnimationTimelines,
): { checks: MarkerCheck[]; mismatches: number } {
  const warped = new SoldierFrames(client, false, TICK_MS);
  const exact = new SoldierFrames(server, true, TICK_MS);
  session.drainEvents();
  const shooter = session.view().soldiers.find((s) => s.team === 0) as SoldierView;
  const target = shooter.gridNo + SHOT_DISTANCE_ROWS * WORLD_COLS;
  expect(session.dispatch({ type: 'attack', soldier: shooter.id, target, aimTime: 0 })).toMatchObject({ ok: true });
  const checks: MarkerCheck[] = [];
  let mismatches = 0;
  for (let i = 0; i < SHOT_TICKS && checks.length === 0; i++) {
    session.step();
    const events = session.drainEvents();
    warped.observe(events);
    const view = session.view();
    for (const s of view.soldiers) if (exact.frameOf(s.id, s, view.tick) !== s.frame) mismatches++;
    for (const e of events) {
      if (e.type !== 'shotFired' || e.soldier !== shooter.id) continue;
      const s = view.soldiers.find((v) => v.id === shooter.id) as SoldierView;
      const track = stateTrack(client, s.animation);
      const index = track.markers[warped.markersOf(s.id, s.stateTick).length - 1];
      if (index === undefined) continue;
      checks.push({ state: s.animation, frame: warped.frameOf(s.id, s, e.tick), expected: track.frames[index] as number });
    }
  }
  return { checks, mismatches };
}

describe.skipIf(!process.env.JA2_DATA_DIR)('soldier frames between the original and the stub scripts', () => {
  let data: DataVfs;
  let kit: StubSectorKit;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await data.close();
  });

  it('hits the stub fire marker at the tick of a shot on the original rules, and equals the frame with the same scripts', async () => {
    const original = await requireAnimationTimelines(read);
    const { checks, mismatches } = shootAndFollow(await createSandboxSession(read, true, 9), await loadTestTimelines(), original);
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) expect(c.frame).toBe(c.expected);
    expect(mismatches).toBe(0);
  });

  it('hits the original fire marker at the tick of a shot on the stub rules', async () => {
    const original = await requireAnimationTimelines(read);
    const stub = await requireAnimationTimelines(kit.read);
    const { checks, mismatches } = shootAndFollow(await createSandboxSession(kit.read, false, 9), original, stub);
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) expect(c.frame).toBe(c.expected);
    expect(mismatches).toBe(0);
  });
});
