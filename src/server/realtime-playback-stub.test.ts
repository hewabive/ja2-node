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

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

interface ReceivedFrame {
  readonly at: number;
  readonly tick: number;
}

async function arrivingSquad(): Promise<CampaignSession> {
  const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 1, { land: false });
  const land = { type: 'compressTime', mode: CompressMode.MIN5 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(helicopterDropUnderWay(session.campaign)).toBe(true);
  return session;
}

function framesOfTheDropInRealTime(campaign: CampaignSession): ReceivedFrame[] {
  const session = new Session('landing', campaign);
  let now = 0;
  const received: ReceivedFrame[] = [];
  session.subscribe((m: ServerMessage) => {
    if (m.t === 'frames') for (const frame of m.frames) received.push({ at: now, tick: frame.tick });
  });
  session.setDriver({ mode: 'realtime', speed: 1 }, () => now);
  let landedAt: number | null = null;
  while (landedAt === null || now < landedAt + AFTER_THE_DROP_MS) {
    if (now > DROP_BUDGET_MS) throw new Error('the helicopter drop did not end');
    now += REALTIME_INTERVAL_MS;
    session.runRealtime(now);
    if (landedAt === null && !helicopterDropUnderWay(campaign.campaign)) landedAt = now;
  }
  session.close();
  return received;
}

function worstPlaybackLagMs(received: readonly ReceivedFrame[]): number {
  const end = received.at(-1)?.at ?? 0;
  let next = 0;
  let latest = 0;
  let shown = 0;
  let worst = 0;
  for (let t = CLIENT_FRAME_MS; t <= end; t += CLIENT_FRAME_MS) {
    for (; next < received.length && (received[next]?.at ?? 0) <= t; next++) latest = received[next]?.tick ?? latest;
    shown = Math.min(shown + CLIENT_FRAME_MS / TICK_MS, latest);
    worst = Math.max(worst, Math.round((latest - shown) * TICK_MS));
  }
  return worst;
}

describe('real-time playback of the first landing', () => {
  it("keeps the client's playback within one frame of the simulation through the drop's quiet stretches", async () => {
    const received = framesOfTheDropInRealTime(await arrivingSquad());
    const gaps = received.slice(1).map((f, i) => f.tick - (received[i]?.tick ?? 0));
    expect(Math.max(...gaps)).toBe(FRAME_TICKS);
    expect(worstPlaybackLagMs(received)).toBeLessThanOrEqual(FRAME_TICKS * TICK_MS);
  });
});
