import { createServer, type Server } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { diffPlayerView, type PlayerView } from '../../../src/protocol/view.ts';
import { Session } from '../../../src/server/session.ts';
import { InProcessHost, SliceScheduler, TimeSlicer } from '../../../src/server/session-host.ts';
import { attachWebSocket } from '../../../src/server/ws.ts';
import { type Arena, ArenaLayout, generateArena } from '../arena.ts';
import { MeteredSim } from '../battle.ts';
import { type BenchContext, measure, type VariantSpec } from '../measure.ts';
import { round } from '../stats.ts';
import { createTacticalBench } from '../tactical.ts';
import type { ClientPlan, ClientReport, ClientRole } from '../ws-clients.ts';

export const SERVER = 'server';

const SESSION_COUNTS = [1, 4, 16] as const;
const FIRST_PORT = 7510;
const HOST = '127.0.0.1';
const TOKEN = 'bench';
const WINDOW_MS = 4000;
const REALTIME_SPEED = 1;
const VIEWERS_PER_BATTLE = 4;
const MERCS = 6;
const PATROL_SOLDIERS = 20;
const BATTLE_ENEMIES = 16;
const SECTOR = { x: 9, y: 1 };
const NS_PER_MS = 1e6;
const MS_PER_SECOND = 1000;
const MONITOR_RESOLUTION_MS = 1;

class RecordingSim extends MeteredSim {
  readonly captured: PlayerView[] = [];
  readonly viewBuildMs: number[] = [];

  override view(): PlayerView {
    const t0 = performance.now();
    const v = super.view();
    this.viewBuildMs.push(performance.now() - t0);
    this.captured.push(v);
    return v;
  }
}

interface ServerRig {
  readonly server: Server;
  readonly sessions: Map<string, InProcessHost>;
  readonly recorders: RecordingSim[];
  readonly plan: ClientPlan;
  close(): Promise<void>;
}

function arenas(ctx: BenchContext): { patrol: Arena; battle: Arena } {
  const patrol = generateArena({
    name: `patrol-${PATROL_SOLDIERS}`,
    layout: ArenaLayout.PATROL,
    enemies: PATROL_SOLDIERS / 2,
    elites: 0,
    militia: 0,
    civilians: PATROL_SOLDIERS / 2,
    mercs: MERCS,
    seed: ctx.seed,
  });
  const battle = generateArena({
    name: `arena-e${BATTLE_ENEMIES}`,
    layout: ArenaLayout.BATTLE,
    enemies: BATTLE_ENEMIES,
    elites: BATTLE_ENEMIES / 4,
    militia: 0,
    civilians: 4,
    mercs: MERCS,
    seed: ctx.seed,
  });
  return { patrol, battle };
}

async function session(
  ctx: BenchContext,
  arena: Arena,
  id: string,
  scheduler: SliceScheduler,
): Promise<{ session: InProcessHost; recorder: RecordingSim }> {
  const sim = await createTacticalBench(ctx.data, await ctx.data.addArena(arena), ctx.seed, {
    sector: SECTOR,
    mercs: MERCS,
    mercGridNos: arena.mercGridNos,
    garrison: arena.garrison,
    militia: 0,
  });
  const recorder = new RecordingSim(sim);
  return { session: new InProcessHost(new Session(id, recorder), { slicer: new TimeSlicer(scheduler) }), recorder };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve());
  });
}

async function rig(ctx: BenchContext, viewers: number, port: number): Promise<ServerRig> {
  const { patrol, battle } = arenas(ctx);
  const sessions = new Map<string, InProcessHost>();
  const scheduler = new SliceScheduler();
  const recorders: RecordingSim[] = [];
  const roles: { id: string; role: ClientRole }[] = [];
  const battles = Math.ceil(viewers / VIEWERS_PER_BATTLE);
  for (let i = 0; i < viewers + battles; i++) {
    const role: ClientRole = i < viewers ? 'viewer' : 'battle';
    const id = `${role}-${i}`;
    const s = await session(ctx, role === 'viewer' ? patrol : battle, id, scheduler);
    sessions.set(id, s.session);
    recorders.push(s.recorder);
    roles.push({ id, role });
  }
  const server = createServer((_req, res) => res.writeHead(404).end());
  const wss = attachWebSocket(server, { token: TOKEN, sessions, defaultSession: roles[0]?.id ?? '' });
  await listen(server, port);
  let closed = false;
  return {
    server,
    sessions,
    recorders,
    plan: { url: `ws://${HOST}:${port}/ws?token=${TOKEN}`, sessions: roles, windowMs: WINDOW_MS, realtimeSpeed: REALTIME_SPEED },
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all([...sessions.values()].map((s) => s.close()));
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function clients(plan: ClientPlan): Promise<ClientReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../ws-clients.ts', import.meta.url), { workerData: plan });
    worker.once('message', (report: ClientReport) => {
      resolve(report);
      void worker.terminate();
    });
    worker.once('error', reject);
  });
}

function diffTimes(recorders: readonly RecordingSim[]): { diffMs: number[]; changed: number } {
  const diffMs: number[] = [];
  let changed = 0;
  for (const r of recorders)
    for (let i = 1; i < r.captured.length; i++) {
      const before = r.captured[i - 1] as PlayerView;
      const after = r.captured[i] as PlayerView;
      const t0 = performance.now();
      const frame = diffPlayerView(before, after);
      diffMs.push(performance.now() - t0);
      if (frame) changed++;
    }
  return { diffMs, changed };
}

function variant(ctx: BenchContext, viewers: number, index: number): VariantSpec<ServerRig> {
  return {
    variant: `sessions-${viewers}`,
    metric: 'eventLoopDelayMax',
    unit: 'ms',
    setup: () => rig(ctx, viewers, FIRST_PORT + index),
    run: async (r) => {
      const monitor = monitorEventLoopDelay({ resolution: MONITOR_RESOLUTION_MS });
      monitor.enable();
      const report = await clients(r.plan);
      monitor.disable();
      await r.close();
      if (report.errors.length > 0) throw new Error(`bench: client errors: ${report.errors.slice(0, 3).join('; ')}`);
      const { diffMs, changed } = diffTimes(r.recorders);
      const seconds = report.elapsedMs / MS_PER_SECOND;
      return {
        samples: [monitor.max / NS_PER_MS],
        series: {
          frameDiffMs: diffMs,
          viewBuildMs: r.recorders.flatMap((x) => x.viewBuildMs),
          instantTurnMs: [...report.turnMs],
        },
        counters: {
          sessions: r.sessions.size,
          viewers,
          battles: r.sessions.size - viewers,
          eventLoopDelayP50Ms: round(monitor.percentile(50) / NS_PER_MS, 1),
          eventLoopDelayP99Ms: round(monitor.percentile(99) / NS_PER_MS, 1),
          bytesPerSecond: Math.round(report.bytes / seconds),
          viewerBytesPerSecond: Math.round(report.viewerBytes / seconds),
          messagesPerSecond: Math.round(report.messages / seconds),
          framesPerSecond: Math.round(report.frames / seconds),
          changedFrames: changed,
          battlesOver: report.battlesOver,
        },
      };
    },
    dispose: (r) => r.close(),
  };
}

export async function server(ctx: BenchContext): Promise<void> {
  for (const [i, viewers] of SESSION_COUNTS.entries()) await measure(ctx, SERVER, variant(ctx, viewers, i));
}
