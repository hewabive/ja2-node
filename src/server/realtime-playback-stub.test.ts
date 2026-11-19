import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import type { ServerMessage } from '../protocol/messages.ts';
import { helicopterDropUnderWay } from '../sim/campaign/helicopter-drop-flow.ts';
import { TICK_MS } from '../sim/clock.ts';
import { CompressMode } from '../sim/strategic/time/constants.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { FRAME_TICKS, Session } from './session.ts';

const REALTIME_INTERVAL_MS = 16;
const CLIENT_FRAME_MS = 1000 / 60;
const AFTER_THE_DROP_MS = 3000;
const DROP_BUDGET_MS = 120_000;
const ON_THE_MAP_MS = 10_000;
const FRAME_MS = FRAME_TICKS * TICK_MS;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

interface Stamped {
  readonly at: number;
  readonly tick: number;
}

interface RealTimeRecord {
  readonly frames: readonly Stamped[];
  readonly serverTicks: readonly Stamped[];
}

interface PlaybackSample {
  readonly lagMs: number;
  readonly behindServerMs: number;
}

async function newCampaign(): Promise<CampaignSession> {
  return createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 1, { land: false });
}

async function arrive(session: CampaignSession): Promise<void> {
  const land = { type: 'compressTime', mode: CompressMode.MIN5 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(helicopterDropUnderWay(session.campaign)).toBe(true);
}

function inRealTime(campaign: CampaignSession, runs: (now: number) => boolean): RealTimeRecord {
  const session = new Session('realtime', campaign);
  let now = 0;
  const frames: Stamped[] = [];
  const serverTicks: Stamped[] = [];
  session.subscribe((m: ServerMessage) => {
    if (m.t === 'frames') for (const frame of m.frames) frames.push({ at: now, tick: frame.tick });
  });
  session.setDriver({ mode: 'realtime', speed: 1 }, () => now);
  while (runs(now)) {
    now += REALTIME_INTERVAL_MS;
    session.runRealtime(now);
    serverTicks.push({ at: now, tick: campaign.tick });
  }
  session.close();
  return { frames, serverTicks };
}

function latestBy(stamps: readonly Stamped[], t: number, from: { next: number; tick: number }): number {
  for (; from.next < stamps.length && (stamps[from.next]?.at ?? 0) <= t; from.next++) from.tick = stamps[from.next]?.tick ?? from.tick;
  return from.tick;
}

function playback(record: RealTimeRecord): PlaybackSample[] {
  const end = record.serverTicks.at(-1)?.at ?? 0;
  const received = { next: 0, tick: 0 };
  const server = { next: 0, tick: 0 };
  const samples: PlaybackSample[] = [];
  let shown = 0;
  for (let t = CLIENT_FRAME_MS; t <= end; t += CLIENT_FRAME_MS) {
    const latest = latestBy(record.frames, t, received);
    shown = Math.min(shown + CLIENT_FRAME_MS / TICK_MS, latest);
    const serverTick = latestBy(record.serverTicks, t, server);
    samples.push({ lagMs: Math.round((latest - shown) * TICK_MS), behindServerMs: Math.round((serverTick - shown) * TICK_MS) });
  }
  return samples;
}

function worst(samples: readonly PlaybackSample[], of: keyof PlaybackSample): number {
  return Math.max(...samples.map((s) => s[of]));
}

describe('real-time playback', () => {
  it("keeps the client's playback within one frame of the simulation through the first landing's quiet stretches", async () => {
    const campaign = await newCampaign();
    await arrive(campaign);
    let landedAt: number | null = null;
    const record = inRealTime(campaign, (now) => {
      if (now > DROP_BUDGET_MS) throw new Error('the helicopter drop did not end');
      if (landedAt === null && !helicopterDropUnderWay(campaign.campaign)) landedAt = now;
      return landedAt === null || now < landedAt + AFTER_THE_DROP_MS;
    });
    const gaps = record.frames.slice(1).map((f, i) => f.tick - (record.frames[i]?.tick ?? 0));
    expect(Math.max(...gaps)).toBe(FRAME_TICKS);
    expect(worst(playback(record), 'lagMs')).toBeLessThanOrEqual(FRAME_MS);
  });

  it('keeps behind server within two frames on the map screen while the clock stands and the ticks run', async () => {
    const campaign = await newCampaign();
    expect(campaign.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(campaign.worldClock.compressing()).toBe(false);
    const seconds = campaign.worldClock.worldTime().seconds;
    const record = inRealTime(campaign, (now) => now < ON_THE_MAP_MS);
    expect(campaign.worldClock.worldTime().seconds).toBe(seconds);
    expect(record.serverTicks.at(-1)?.tick).toBeGreaterThan(ON_THE_MAP_MS / TICK_MS / 2);
    const samples = playback(record);
    expect(worst(samples, 'lagMs')).toBeLessThanOrEqual(FRAME_MS);
    expect(worst(samples, 'behindServerMs')).toBeLessThanOrEqual(2 * FRAME_MS);
  });
});
