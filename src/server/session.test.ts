import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../protocol/messages.ts';
import { applyFrame, type SoldierView } from '../protocol/view.ts';
import type { SimEvent } from '../sim/events.ts';
import { FRAME_TICKS, Session, type SessionSim } from './session.ts';

function walker(): SessionSim & { target: number } {
  let tick = 0;
  let x = 0;
  const sim = {
    target: 0,
    get tick() {
      return tick;
    },
    isIdle: () => x >= sim.target,
    hasPendingDecision: () => false,
    step: () => {
      tick++;
      if (x < sim.target) x++;
    },
    drainEvents: (): SimEvent[] => [],
    dispatch: (cmd: { type: string; [k: string]: unknown }) => {
      if (cmd.type !== 'walk' || typeof cmd.to !== 'number') return { ok: false, reason: 'unknown command' };
      sim.target = cmd.to;
      return { ok: true };
    },
    view: () => ({
      tick,
      mapPath: null,
      soldiers: [
        {
          id: 1,
          team: 0,
          name: 'Ivan',
          bodyType: 0,
          gridNo: x,
          x,
          y: 0,
          level: 0,
          direction: 2,
          hand: 'nothing',
          animation: 0,
          frame: 0,
          palettes: ['', '', '', ''],
          frameSlot: 0,
          stateTick: 0,
          frameDelay: 0,
        } as SoldierView,
      ],
    }),
  };
  return sim;
}

describe('session', () => {
  it('advances to idle and streams delta frames that replay to the final view', () => {
    const sim = walker();
    const session = new Session('s1', sim);
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    expect(messages[0]?.t).toBe('welcome');
    expect(session.dispatch({ type: 'walk', to: 35 })).toEqual({ ok: true });
    const report = session.advance({ idle: true });
    expect(report).toMatchObject({ reason: 'idle', tick: 35 });
    const frames = messages.flatMap((m) => (m.t === 'frames' ? m.frames : []));
    expect(frames.every((f) => f.tick % FRAME_TICKS === 0 || f.tick === 35)).toBe(true);
    const replayed = frames.reduce((soldiers, f) => applyFrame(soldiers, f), [] as SoldierView[]);
    expect(replayed[0]?.x).toBe(35);
    expect(session.dispatch({ type: 'fly' })).toMatchObject({ ok: false });
  });

  it('runs real time at the chosen speed', () => {
    const sim = walker();
    const session = new Session('s2', sim);
    let now = 0;
    session.setDriver({ mode: 'realtime', speed: 2 }, () => now);
    sim.target = 1000;
    now = 50;
    session.runRealtime(now);
    expect(sim.tick).toBe(20);
    session.setDriver({ mode: 'manual' });
    session.runRealtime(100);
    expect(sim.tick).toBe(20);
    session.close();
  });

  it('runs every accepted command to idle in instant mode and streams the frames', () => {
    const sim = walker();
    const session = new Session('s3', sim);
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    session.setDriver({ mode: 'instant' });
    expect(session.dispatch({ type: 'walk', to: 42 })).toEqual({ ok: true });
    expect(sim.isIdle()).toBe(true);
    expect(sim.tick).toBe(42);
    const frames = messages.flatMap((m) => (m.t === 'frames' ? m.frames : []));
    expect(frames.reduce((shown, f) => applyFrame(shown, f), [] as SoldierView[])[0]?.gridNo).toBe(42);
    expect(session.dispatch({ type: 'fly' })).toMatchObject({ ok: false });
    expect(sim.tick).toBe(42);
    session.close();
  });

  it('logs every input in order, merges real-time batches and keeps held events for the next report', () => {
    const sim = walker();
    const session = new Session('s4', sim, undefined, { kind: 'sandbox', seed: 1 });
    session.setDriver({ mode: 'instant' });
    session.dispatch({ type: 'walk', to: 5 });
    session.dispatch({ type: 'answer', choice: 'yes' });
    let now = 0;
    session.setDriver({ mode: 'realtime', speed: 1 }, () => now);
    sim.target = 1000;
    for (now = 16; now <= 64; now += 16) session.runRealtime(now);
    session.setDriver({ mode: 'manual' });
    session.notify({ type: 'gameSaved', name: 'QuickSave', kind: 'quick', tick: sim.tick });
    const report = session.advance({ ticks: 2 }, 50);
    expect(report.events).toEqual([{ type: 'gameSaved', name: 'QuickSave', kind: 'quick', tick: 17 }]);
    expect(session.log.entries().map((e) => [e.kind, e.payload])).toEqual([
      ['drive', { driver: { mode: 'instant' } }],
      ['advance', { until: { idle: true } }],
      ['cmd', { cmd: { type: 'walk', to: 5 } }],
      ['advance', { until: { idle: true } }],
      ['answer', { cmd: { type: 'answer', choice: 'yes' } }],
      ['drive', { driver: { mode: 'realtime', speed: 1 } }],
      ['advance', { until: { ticks: 12 }, realtime: true }],
      ['drive', { driver: { mode: 'manual' } }],
      ['advance', { until: { ticks: 2 }, budget: 50 }],
    ]);
    session.close();
  });

  it('replaces its simulation on a load, stops real time and welcomes every viewer again', () => {
    const session = new Session('s5', walker());
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    session.setDriver({ mode: 'realtime', speed: 1 }, () => 0);
    const loaded = walker();
    loaded.target = 3;
    session.replace(loaded, { name: 'QuickSave', digest: 'abc' });
    expect(session.sim).toBe(loaded);
    expect(session.driver).toEqual({ mode: 'manual' });
    expect(messages.map((m) => m.t)).toEqual(['welcome', 'stopped', 'welcome']);
    expect(messages[1]).toMatchObject({ report: { reason: 'loaded' } });
    expect(session.log.entries().at(-1)).toMatchObject({ kind: 'load', payload: { name: 'QuickSave', digest: 'abc' } });
    session.close();
  });
});
