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
});
