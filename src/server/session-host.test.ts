import { describe, expect, it } from 'vitest';
import type { CommandEnvelope, ServerMessage } from '../protocol/messages.ts';
import { applyFrame, type SoldierView, type ViewFrame } from '../protocol/view.ts';
import type { SimEvent } from '../sim/events.ts';
import { refuse } from '../sim/tactical/refusal.ts';
import { Session, type SessionSim } from './session.ts';
import { InProcessHost, SESSION_HOST_ENV, sessionHostKind } from './session-host.ts';
import { SliceScheduler, TimeSlicer } from './slicing.ts';

const BUSY_TICK_MS = 2;
const LONG_ADVANCE_TICKS = 150;
const EVENT_EVERY_TICKS = 7;
const EVERY_STEP = 0;

interface Walker extends SessionSim {
  views: number;
}

function walker(tickCostMs = 0): Walker {
  let tick = 0;
  let x = 0;
  let target = 0;
  let pending: SimEvent[] = [];
  const burn = () => {
    const until = performance.now() + tickCostMs;
    while (performance.now() < until);
  };
  const sim: Walker = {
    views: 0,
    get tick() {
      return tick;
    },
    isIdle: () => x === target,
    hasPendingDecision: () => false,
    step: () => {
      burn();
      tick++;
      if (x !== target) x += Math.sign(target - x);
      if (tick % EVENT_EVERY_TICKS === 0) pending.push({ type: 'noiseHeard', tick, x } as unknown as SimEvent);
      if (x === target && tick % EVENT_EVERY_TICKS === 0) pending.push({ type: 'arrived', tick } as unknown as SimEvent);
    },
    drainEvents: () => {
      const out = pending;
      pending = [];
      return out;
    },
    dispatch: (cmd: CommandEnvelope) => {
      if (cmd.type !== 'walk' || typeof cmd.to !== 'number') return refuse('unknownCommand', 'unknown command');
      target = cmd.to;
      return { ok: true, data: { from: x } };
    },
    view: () => {
      sim.views++;
      return { tick, mapPath: null, soldiers: [{ id: 1, gridNo: x, x, y: 0 } as SoldierView] };
    },
  };
  return sim;
}

function framesOf(messages: readonly ServerMessage[]): ViewFrame[] {
  return messages.flatMap((m) => (m.t === 'frames' ? m.frames : []));
}

function noting<T>(log: string[], name: string, pending: Promise<T>): Promise<T> {
  return pending.then((value) => {
    log.push(name);
    return value;
  });
}

function everyStep(): TimeSlicer {
  return new TimeSlicer(new SliceScheduler(), EVERY_STEP);
}

describe('the in-process session host', () => {
  it('runs a sliced advance to the same ticks, events, frames and input log as an unsliced one', async () => {
    const plain = new Session('plain', walker());
    const plainMessages: ServerMessage[] = [];
    plain.subscribe((m) => plainMessages.push(m));
    const slicer = everyStep();
    const host = new InProcessHost(new Session('sliced', walker()), { slicer });
    const hostMessages: ServerMessage[] = [];
    host.subscribe((m) => hostMessages.push(m));
    const reports = [
      [plain.dispatch({ type: 'walk', to: 40 }), await host.dispatch({ type: 'walk', to: 40 })],
      [plain.advance({ idle: true }), await host.advance({ idle: true })],
      [plain.advance({ ticks: 25 }, 30), await host.advance({ ticks: 25 }, 30)],
    ];
    plain.setDriver({ mode: 'instant' });
    await host.setDriver({ mode: 'instant' });
    reports.push([plain.dispatch({ type: 'walk', to: -12 }), await host.dispatch({ type: 'walk', to: -12 })]);
    reports.push([plain.advance({ events: ['arrived'], ticks: 100 }), await host.advance({ events: ['arrived'], ticks: 100 })]);
    for (const [a, b] of reports) expect(b).toEqual(a);
    expect(slicer.slices).toBeGreaterThan(50);
    expect(framesOf(hostMessages)).toEqual(framesOf(plainMessages));
    expect((await host.inputLog()).entries).toEqual(plain.log.full().entries);
    expect(hostMessages.filter((m) => m.t === 'frames').length).toBeGreaterThan(plainMessages.filter((m) => m.t === 'frames').length);
  });

  it('runs inputs strictly in arrival order, even while an advance is sliced', async () => {
    const host = new InProcessHost(new Session('ordered', walker(), undefined, { kind: 'sandbox', seed: 1 }), { slicer: everyStep() });
    const done: string[] = [];
    const track = <T>(name: string, p: Promise<T>) => noting(done, name, p);
    const calls = [
      track('walk', host.dispatch({ type: 'walk', to: 30 })),
      track('advance', host.advance({ idle: true })),
      track('instant', host.setDriver({ mode: 'instant' })),
      track('walkBack', host.dispatch({ type: 'walk', to: 3 })),
      track('manual', host.setDriver({ mode: 'manual' })),
      track('ticks', host.advance({ ticks: 4 })),
      track('refused', host.dispatch({ type: 'fly' })),
    ];
    const results = await Promise.all(calls);
    expect(done).toEqual(['walk', 'advance', 'instant', 'walkBack', 'manual', 'ticks', 'refused']);
    expect(results[1]).toMatchObject({ reason: 'idle', tick: 30 });
    expect(results[5]).toMatchObject({ reason: 'ticks', tick: 61 });
    expect((await host.inputLog()).entries.map((e) => [e.kind, e.payload])).toEqual([
      ['cmd', { cmd: { type: 'walk', to: 30 } }],
      ['advance', { until: { idle: true } }],
      ['drive', { driver: { mode: 'instant' } }],
      ['advance', { until: { idle: true } }],
      ['cmd', { cmd: { type: 'walk', to: 3 } }],
      ['advance', { until: { idle: true } }],
      ['drive', { driver: { mode: 'manual' } }],
      ['advance', { until: { ticks: 4 } }],
      ['cmd', { cmd: { type: 'fly' } }],
    ]);
  });

  it("answers another session's calls while one session runs a long advance", async () => {
    const scheduler = new SliceScheduler();
    const heavySlicer = new TimeSlicer(scheduler);
    const heavy = new InProcessHost(new Session('heavy', walker(BUSY_TICK_MS)), { slicer: heavySlicer });
    const light = new InProcessHost(new Session('light', walker()), { slicer: new TimeSlicer(scheduler) });
    const order: string[] = [];
    const long = noting(order, 'heavy', heavy.advance({ ticks: LONG_ADVANCE_TICKS }));
    await new Promise((resolve) => setImmediate(resolve));
    const quick = light.dispatch({ type: 'walk', to: 5 }).then(() => light.describe());
    const answered = await noting(order, 'light', quick);
    const report = await long;
    expect(order).toEqual(['light', 'heavy']);
    expect(answered).toMatchObject({ session: 'light', tick: 0 });
    expect(report).toMatchObject({ reason: 'ticks', tick: LONG_ADVANCE_TICKS });
    expect(heavySlicer.slices).toBeGreaterThan(1);
  });

  it('builds no frame views while nobody listens and streams from the welcome once someone does', async () => {
    const sim = walker();
    const host = new InProcessHost(new Session('quiet', sim), { slicer: everyStep() });
    const built = sim.views;
    await host.dispatch({ type: 'walk', to: 50 });
    await host.advance({ idle: true });
    expect(sim.views).toBe(built);
    const messages: ServerMessage[] = [];
    host.subscribe((m) => messages.push(m));
    await host.dispatch({ type: 'walk', to: 80 });
    await host.advance({ idle: true });
    const welcome = messages[0];
    if (welcome?.t !== 'welcome') throw new Error('no welcome');
    expect(welcome.view.soldiers[0]?.x).toBe(50);
    const shown = framesOf(messages).reduce((soldiers, f) => applyFrame(soldiers, f), welcome.view.soldiers);
    expect(shown[0]?.x).toBe(80);
    expect(framesOf(messages).flatMap((f) => f.events ?? []).length).toBeGreaterThan(0);
  });

  it('refuses calls after close and closes once', async () => {
    const host = new InProcessHost(new Session('closing', walker()));
    const first = host.close();
    expect(host.close()).toBe(first);
    await first;
    await expect(host.advance({ ticks: 1 })).rejects.toThrow(/closed/);
    expect(host.savesAvailable).toBe(false);
    await expect(new InProcessHost(new Session('nosaves', walker())).save({})).rejects.toThrow(/not available/);
  });

  it('picks the host kind from JA2_SESSION_HOST, in process by default', () => {
    expect(sessionHostKind({})).toBe('inprocess');
    expect(sessionHostKind({ [SESSION_HOST_ENV]: 'worker' })).toBe('worker');
    expect(() => sessionHostKind({ [SESSION_HOST_ENV]: 'threads' })).toThrow(/inprocess, worker/);
  });

  it('grants at most one slice per event-loop turn, also to a session that starts while another runs', async () => {
    const scheduler = new SliceScheduler();
    let turn = 0;
    let counting = true;
    const count = () => {
      turn++;
      if (counting) setImmediate(count);
    };
    setImmediate(count);
    expect(scheduler.claim()).toBe(true);
    expect(scheduler.claim()).toBe(false);
    const granted: number[] = [];
    await Promise.all(
      [0, 1, 2].map(async () => {
        await scheduler.turn();
        granted.push(turn);
      }),
    );
    counting = false;
    expect(new Set(granted).size).toBe(granted.length);
    expect(granted[0]).toBeGreaterThan(1);
  });
});
