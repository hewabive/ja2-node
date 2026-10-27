import { describe, expect, it } from 'vitest';
import type { SessionHealthView } from '../../protocol/messages.ts';
import { DiagnosticsOverlay } from '../../ui/diagnostics-overlay.ts';
import type { OpenRequests, PingReply } from '../net/session-client.ts';
import { type DiagnosedClient, type DiagnosticsSample, DiagnosticsSampler, diagnosticLines } from './diagnostics.ts';

const FRAMES = { ms: 1000, frames: 60, drawn: 12, averageMs: 1.84, maxMs: 7.5 };

const CALM: DiagnosticsSample = {
  frames: FRAMES,
  session: {
    lagMs: 40,
    behindServerMs: 55,
    ping: { rttMs: 3.6, health: { tick: 900, pending: 0, last: { label: 'move', waitedMs: 0, ranMs: 2, ticks: 0 }, loopDelayMs: 11 } },
    open: null,
    slowest: { label: 'previewMove?', ms: 8.2 },
  },
  reads: { pending: 0, oldest: null },
};

describe('the diagnostics lines', () => {
  it('reads frames, the network, the playback, the requests, the server and the asset reads, all calm', () => {
    expect(diagnosticLines(CALM)).toEqual([
      { text: '60 FPS, 12 drawn, frame 1.8 ms (max 7.5)', alarm: false },
      { text: 'ping 4 ms, server loop 11 ms', alarm: false },
      { text: 'playback lag 40 ms, behind server 55 ms', alarm: false },
      { text: 'waiting for nothing, slowest reply previewMove? 8 ms', alarm: false },
      { text: 'server queue 0, last move: waited 0 ms, ran 2 ms, game time +0 ms', alarm: false },
      { text: 'reads: none open', alarm: false },
    ]);
  });

  it('turns light red what is slow: a command that ran game time ahead, the playback behind it, an old request and read', () => {
    const lines = diagnosticLines({
      frames: { ...FRAMES, frames: 15 },
      session: {
        lagMs: 8040,
        behindServerMs: 8065,
        ping: {
          rttMs: 4,
          health: { tick: 9000, pending: 2, last: { label: 'approach', waitedMs: 0, ranMs: 14, ticks: 1155 }, loopDelayMs: 12 },
        },
        open: { oldest: 'closeTalk', ageMs: 1400, count: 2 },
        slowest: null,
      },
      reads: { pending: 3, oldest: { path: 'npc_speech.slf/a-very-long-folder-name/and-a-long-voice-file-name.wav', ageMs: 2500 } },
    });
    expect(lines).toEqual([
      { text: '15 FPS, 12 drawn, frame 1.8 ms (max 7.5)', alarm: true },
      { text: 'ping 4 ms, server loop 12 ms', alarm: false },
      { text: 'playback lag 8040 ms, behind server 8065 ms', alarm: true },
      { text: 'waiting closeTalk 1400 ms (2 open)', alarm: true },
      { text: 'server queue 2, last approach: waited 0 ms, ran 14 ms, game time +5775 ms', alarm: true },
      { text: 'reads 3 open, oldest 2500 ms: ...lder-name/and-a-long-voice-file-name.wav', alarm: true },
    ]);
  });

  it('says so when there is no session, no pong yet or no server input yet', () => {
    expect(diagnosticLines({ frames: FRAMES, session: null, reads: null }).map((l) => l.text)).toEqual([
      '60 FPS, 12 drawn, frame 1.8 ms (max 7.5)',
      'no game session',
    ]);
    const quiet = { ...(CALM.session as NonNullable<DiagnosticsSample['session']>), ping: null, behindServerMs: null, slowest: null };
    expect(diagnosticLines({ ...CALM, session: quiet }).map((l) => l.text)).toEqual([
      '60 FPS, 12 drawn, frame 1.8 ms (max 7.5)',
      'ping: no reply yet',
      'playback lag 40 ms, behind server ?',
      'waiting for nothing',
      'reads: none open',
    ]);
    const health: SessionHealthView = { tick: 0, pending: 0, last: null, loopDelayMs: 0 };
    const fresh = { ...quiet, ping: { rttMs: 1, health } };
    expect(diagnosticLines({ ...CALM, session: fresh })[4]).toEqual({ text: 'server queue 0, no input yet', alarm: false });
  });
});

class FakeClient implements DiagnosedClient {
  latestTick = 1000;
  shownTick = 600;
  onReply: ((label: string, ms: number) => void) | null = null;
  pings = 0;
  readonly replies: ((reply: PingReply) => void)[] = [];

  openRequests(): OpenRequests | null {
    return null;
  }

  ping(): Promise<PingReply> {
    this.pings++;
    return new Promise((resolve) => this.replies.push(resolve));
  }
}

describe('the diagnostics sampler', () => {
  it('samples only while the overlay is on, pings once a window without overlapping and refreshes the lines once a second', async () => {
    const overlay = new DiagnosticsOverlay();
    const client = new FakeClient();
    let drawn = 0;
    const sampler = new DiagnosticsSampler({
      overlay: () => overlay,
      client: () => client,
      reads: () => null,
      drawnFrames: () => drawn,
    });
    sampler.frame(0, 2);
    expect(client.pings).toBe(0);
    overlay.toggle();
    for (let now = 0; now < 1000; now += 20) {
      sampler.frame(now, 2);
      drawn++;
    }
    expect(client.pings).toBe(1);
    expect(overlay.lines).toEqual([]);
    client.replies[0]?.({ rttMs: 5, health: { tick: 2000, pending: 0, last: null, loopDelayMs: 1 } });
    await Promise.resolve();
    client.onReply?.('ping', 5000);
    client.onReply?.('approach', 120);
    client.onReply?.('previewMove?', 30);
    sampler.frame(1000, 4);
    expect(overlay.lines.map((l) => l.text)).toEqual([
      '51 FPS, 50 drawn, frame 2.0 ms (max 4.0)',
      'ping 5 ms, server loop 1 ms',
      'playback lag 2000 ms, behind server 7000 ms',
      'waiting for nothing, slowest reply approach 120 ms',
      'server queue 0, no input yet',
    ]);
    expect(client.pings).toBe(2);
    sampler.frame(2000, 2);
    expect(client.pings).toBe(2);
    client.replies[1]?.({ rttMs: 9, health: null });
    await Promise.resolve();
    sampler.frame(3000, 2);
    expect(client.pings).toBe(3);
    expect(overlay.lines[1]).toEqual({ text: 'ping 9 ms, server loop 0 ms', alarm: false });
  });

  it('lets go of a client that is gone', () => {
    const overlay = new DiagnosticsOverlay();
    overlay.toggle();
    const first = new FakeClient();
    let client: FakeClient | null = first;
    const sampler = new DiagnosticsSampler({ overlay: () => overlay, client: () => client, reads: () => null, drawnFrames: () => 0 });
    sampler.frame(0, 1);
    expect(first.onReply).not.toBeNull();
    client = null;
    sampler.frame(1, 1);
    expect(first.onReply).toBeNull();
  });
});
