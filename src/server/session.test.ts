import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../protocol/messages.ts';
import { applyFrame, applyViewFrame, type PlayerView, type SoldierView } from '../protocol/view.ts';
import { TICK_MS } from '../sim/clock.ts';
import type { SimEvent } from '../sim/events.ts';
import type { QueryService } from './query.ts';
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

const ANSWER_WITH_ITS_VIEW = {
  prepare: async () => {},
  answer: (subject: SessionSim) => ({ ok: true, data: JSON.parse(JSON.stringify(subject.view())), tick: subject.view().tick }),
} as unknown as QueryService;

function heldView(messages: readonly ServerMessage[]): PlayerView | null {
  let view: PlayerView | null = null;
  for (const m of messages) {
    if (m.t === 'welcome') view = m.view;
    if (m.t === 'frames' && view) for (const frame of m.frames) view = applyViewFrame(view, frame);
  }
  return view ? JSON.parse(JSON.stringify(view)) : null;
}

function lastShownTick(messages: readonly ServerMessage[]): number {
  let tick = -1;
  for (const m of messages) {
    if (m.t === 'welcome') tick = m.view.tick;
    if (m.t === 'frames') tick = m.frames.at(-1)?.tick ?? tick;
  }
  return tick;
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

  it('answers a query over the view its viewers hold: the welcome and every frame sent before the answer', async () => {
    const sim = walker();
    const session = new Session('s1q', sim);
    session.queries = ANSWER_WITH_ITS_VIEW;
    expect((await session.query({ type: 'previewMove' })).tick).toBe(0);
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    const answeredOver = async () => {
      const answer = await session.query({ type: 'previewMove' });
      expect(answer.data).toEqual(heldView(messages));
      return answer;
    };
    session.dispatch({ type: 'walk', to: 13 });
    session.advance({ idle: true });
    session.advance({ ticks: 25 });
    expect(sim.tick).toBe(38);
    expect(lastShownTick(messages)).toBe(13);
    expect((await answeredOver()).tick).toBe(13);
    session.dispatch({ type: 'walk', to: 14 });
    sim.step();
    expect((await answeredOver()).tick).toBe(13);
    const pending = answeredOver();
    session.dispatch({ type: 'walk', to: 20 });
    session.dispatch({ type: 'walk', to: 21 });
    await pending;
    const late: ServerMessage[] = [];
    session.subscribe((m) => late.push(m));
    expect(heldView(late)).toEqual(heldView(messages));
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

  it('keeps real time through a decision: no ticks, no log entries and no catch-up once it is resolved', () => {
    let deciding = true;
    const sim = walker();
    sim.hasPendingDecision = () => deciding;
    sim.target = 1000;
    const session = new Session('s2b', sim);
    let now = 0;
    session.setDriver({ mode: 'realtime', speed: 1 }, () => now);
    const logged = session.log.entries().length;
    for (now = 50; now <= 500; now += 50) session.runRealtime(now);
    expect(sim.tick).toBe(0);
    expect(session.driver).toEqual({ mode: 'realtime', speed: 1 });
    expect(session.log.entries()).toHaveLength(logged);
    deciding = false;
    now = 550;
    session.runRealtime(now);
    expect(sim.tick).toBe(10);
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

  it('lets advance wait for real time to reach its stop instead of running ticks or logging an advance', async () => {
    const sim = alarmedAt(walker(), 7);
    const session = new Session('s13', sim);
    let now = 0;
    session.setDriver({ mode: 'realtime', speed: 1 }, () => now);
    expect(session.dispatch({ type: 'walk', to: 30 })).toEqual({ ok: true });
    const alarmed = session.waitInRealtime({ idle: true, events: ['enemySighted'] });
    expect(sim.tick).toBe(0);
    now = 25;
    session.runRealtime(now);
    now = 50;
    session.runRealtime(now);
    const report = await alarmed;
    expect(report).toMatchObject({ reason: 'event', tick: 10 });
    expect(report?.events).toContainEqual(expect.objectContaining({ type: 'enemySighted', tick: 7 }));
    const idle = session.waitInRealtime({ idle: true });
    now = 200;
    session.runRealtime(now);
    expect(await idle).toMatchObject({ reason: 'idle', tick: 40 });
    expect(session.log.entries().filter((e) => e.kind === 'advance' && e.payload.realtime !== true)).toEqual([]);
    session.close();
  });

  it('ends a wait for real time on its timeout or when real time stops, refuses compression and waits only in real time', async () => {
    const sim = walker();
    const session = new Session('s14', sim);
    expect(session.waitInRealtime({ idle: true })).toBeNull();
    session.setDriver({ mode: 'realtime', speed: 1 }, () => 0);
    sim.target = 100;
    expect(await session.waitInRealtime({ idle: true }, undefined, 5)).toMatchObject({ reason: 'timeout', tick: 0 });
    expect(await session.waitInRealtime({ worldSeconds: 60 })).toMatchObject({ reason: 'refused' });
    const stopped = session.waitInRealtime({ idle: true });
    session.setDriver({ mode: 'manual' });
    expect(await stopped).toMatchObject({ reason: 'refused', refusal: expect.stringContaining('real time') });
    session.close();
  });

  it('keeps the speech mode as a logged session setting and hands it to every simulation it runs', () => {
    const skips: boolean[] = [];
    const speaking = <T extends SessionSim>(sim: T): T => Object.assign(sim, { skipSpeech: (skip: boolean) => skips.push(skip) });
    const session = new Session('s15', speaking(walker()));
    expect(session.dispatch({ type: 'setSpeech', mode: 'mute' })).toMatchObject({ ok: false, data: { refusal: 'unknownSpeech' } });
    expect(session.dispatch({ type: 'setSpeech', mode: 'skip' })).toEqual({ ok: true, data: { speech: 'skip' } });
    expect(session.speech).toBe('skip');
    session.replace(speaking(walker()), { name: 'QuickSave', digest: 'abc' });
    expect(skips).toEqual([true, true]);
    expect(session.log.entries().map((e) => e.kind)).toEqual(['speech', 'load', 'speech']);
    session.close();
  });

  it('stops real time on the tick of the first pauseOn event, tells the viewers and logs the batch with its events', () => {
    const sim = alarmedAt(walker(), 7);
    const session = new Session('s6', sim, undefined, { kind: 'sandbox', seed: 1 });
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    let now = 0;
    session.setDriver({ mode: 'realtime', speed: 1, pauseOn: ['enemySighted'] }, () => now);
    sim.target = 1000;
    now = 100;
    session.runRealtime(now);
    expect(sim.tick).toBe(7);
    expect(session.driver).toEqual({ mode: 'manual' });
    expect(messages.at(-1)).toMatchObject({ t: 'stopped', report: { reason: 'event', tick: 7 } });
    expect(session.log.entries().map((e) => e.payload)).toContainEqual({ until: { ticks: 20, events: ['enemySighted'] }, realtime: true });
    session.close();
  });

  it('turns saves and refusals into message entries for frames, reports and the saved ring', () => {
    const sim = walker();
    const session = new Session('s7', sim);
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    session.notify({ type: 'gameSaved', name: 'QuickSave', kind: 'quick', tick: 0 });
    const report = session.advance({ ticks: 10 });
    const saved = { tick: 0, kind: 'interface', colour: 145, table: 'pMessageStrings', index: 8 };
    expect(report.messages).toEqual([saved]);
    expect(messages.flatMap((m) => (m.t === 'frames' ? m.frames : [])).flatMap((f) => f.messages ?? [])).toEqual([saved]);
    expect(session.messages).toEqual([saved]);
    expect(session.advance({ ticks: 1 }).messages).toEqual([]);
    const later: ServerMessage[] = [];
    session.subscribe((m) => later.push(m));
    expect(later[0]).toMatchObject({ t: 'welcome', messages: [saved] });
    session.restoreMessages([]);
    expect(session.messages).toEqual([]);
    session.close();
  });

  it('sends the bullets of every tick in the frame that ends with it, kept out of the view', () => {
    const sim = shooting(walker(), 8, 22);
    const session = new Session('s9', sim);
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    session.dispatch({ type: 'walk', to: 35 });
    session.advance({ ticks: 25 });
    const frames = messages.flatMap((m) => (m.t === 'frames' ? m.frames : []));
    const ticksPerFrame = frames.filter((f) => f.bullets).map((f) => [f.tick, f.bullets?.map((b) => b.tick)]);
    expect(ticksPerFrame).toEqual([
      [10, [8, 9, 10]],
      [20, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]],
      [25, [21, 22]],
    ]);
    expect(frames.flatMap((f) => f.bullets ?? []).every((b) => b.x === b.tick * 10 && b.y === 5 && b.z === 30)).toBe(true);
    expect(heldView(messages)).not.toHaveProperty('bullets');
    session.close();
  });

  it('sends an effect in the frame that ends with its tick, stamped with the session tick', () => {
    const sim = impactingAt(walker(), 17);
    const session = new Session('s11', sim);
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    session.dispatch({ type: 'walk', to: 35 });
    session.advance({ ticks: 25 });
    const frames = messages.flatMap((m) => (m.t === 'frames' ? m.frames : []));
    expect(frames.filter((f) => f.effects).map((f) => [f.tick, f.effects?.map((e) => e.tick)])).toEqual([[20, [17]]]);
    expect(frames.flatMap((f) => f.events ?? []).map((e) => e.tick)).toEqual([17 - TACTICAL_TICK_BEHIND]);
    expect(heldView(messages)).not.toHaveProperty('effects');
    session.close();
  });

  it('keeps the frames coming for two seconds after an effect starts, so the client plays it out', () => {
    const sim = impactingAt(walker(), 17);
    const session = new Session('s12', sim);
    const messages: ServerMessage[] = [];
    session.subscribe((m) => messages.push(m));
    session.dispatch({ type: 'walk', to: 5 });
    session.advance({ ticks: 600 });
    const ticks = messages.flatMap((m) => (m.t === 'frames' ? m.frames : [])).map((f) => f.tick);
    const lastHeartbeat = Math.floor((17 + 2000 / TICK_MS) / FRAME_TICKS) * FRAME_TICKS;
    expect(ticks.filter((t) => t > 10)).toEqual(Array.from({ length: lastHeartbeat / FRAME_TICKS - 1 }, (_, k) => (k + 2) * FRAME_TICKS));
    session.close();
  });
});

const TACTICAL_TICK_BEHIND = 1000;

function impactingAt<T extends SessionSim>(sim: T, impactTick: number): T {
  const step = sim.step.bind(sim);
  const pending: SimEvent[] = [];
  return Object.assign(sim, {
    step: () => {
      step();
      if (sim.tick !== impactTick) return;
      const tick = impactTick - TACTICAL_TICK_BEHIND;
      pending.push({ type: 'bulletImpact', soldier: 1, gridNo: 5, x: 55, y: 5, z: 12, effect: 'dust', tick });
    },
    drainEvents: () => pending.splice(0),
  });
}

function shooting<T extends SessionSim>(sim: T, from: number, to: number): T {
  return Object.assign(sim, {
    bulletViews: () => (sim.tick >= from && sim.tick <= to ? [{ x: sim.tick * 10, y: 5, z: 30 }] : []),
  });
}

function alarmedAt<T extends SessionSim>(sim: T, alarmTick: number): T {
  const step = sim.step.bind(sim);
  const pending: SimEvent[] = [];
  return Object.assign(sim, {
    step: () => {
      step();
      if (sim.tick === alarmTick) pending.push({ type: 'enemySighted', soldier: 1, newEnemies: 1, revealedEnemies: 0, tick: alarmTick });
    },
    drainEvents: () => pending.splice(0),
  });
}
