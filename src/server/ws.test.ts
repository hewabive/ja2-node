import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage, WelcomeMessage } from '../protocol/messages.ts';
import type { SoldierView } from '../protocol/view.ts';
import { Session, type SessionSim } from './session.ts';
import { InProcessHost, type SessionHost } from './session-host.ts';
import { attachWebSocket, closeSockets } from './ws.ts';

const token = 'ws-test-token-0123456789';
const FAILING_COMMAND = 'fail';
const FAILURE = 'the command broke';

function counter(): SessionSim {
  let tick = 0;
  let target = 0;
  return {
    get tick() {
      return tick;
    },
    isIdle: () => tick >= target,
    hasPendingDecision: () => false,
    step: () => {
      tick++;
    },
    drainEvents: () => [],
    dispatch: (cmd) => {
      if (cmd.type === FAILING_COMMAND) throw new Error(FAILURE);
      target = Number(cmd.until ?? 0);
      return { ok: true };
    },
    view: () => ({ tick, mapPath: null, soldiers: [{ id: 1, x: tick } as SoldierView] }),
  };
}

const http = createServer();
const sessions = new Map<string, SessionHost>([['sandbox', new InProcessHost(new Session('sandbox', counter()))]]);
attachWebSocket(http, { token, sessions, defaultSession: 'sandbox' });
await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
const port = (http.address() as AddressInfo).port;
afterAll(() => new Promise<void>((resolve) => http.close(() => resolve())));

function open(query: string): Promise<{ ws: WebSocket; inbox: ServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
    const inbox: ServerMessage[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
    ws.on('open', () => resolve({ ws, inbox }));
    ws.on('error', reject);
  });
}

async function viewer(session: string): Promise<{ ws: WebSocket; inbox: ServerMessage[] }> {
  const opened = await open(`?token=${token}`);
  opened.ws.send(JSON.stringify({ t: 'hello', session }));
  await until(opened.inbox, (m) => m.t === 'welcome');
  return opened;
}

function openSession(id: string): InProcessHost {
  const host = new InProcessHost(new Session(id, counter()));
  sessions.set(id, host);
  return host;
}

function welcomeOf(inbox: readonly ServerMessage[]): WelcomeMessage {
  const welcome = inbox.find((m): m is WelcomeMessage => m.t === 'welcome');
  if (!welcome) throw new Error('no welcome');
  return welcome;
}

async function until(inbox: ServerMessage[], predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> {
  for (;;) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('websocket transport', () => {
  it('refuses connections without a token', async () => {
    await expect(open('')).rejects.toThrow(/401/);
  });

  it('compresses the stream with permessage-deflate, keeping the context between messages', async () => {
    const { ws } = await open(`?token=${token}`);
    expect(ws.extensions).toContain('permessage-deflate');
    expect(ws.extensions).not.toContain('server_no_context_takeover');
    ws.close();
  });

  it('subscribes to a session, dispatches commands and advances time', async () => {
    const { ws, inbox } = await open(`?token=${token}`);
    ws.send(JSON.stringify({ t: 'hello' }));
    expect((await until(inbox, (m) => m.t === 'welcome')).t).toBe('welcome');
    ws.send(JSON.stringify({ t: 'cmd', id: 1, cmd: { type: 'run', until: 30 } }));
    expect(await until(inbox, (m) => m.t === 'result')).toMatchObject({ id: 1, ok: true });
    ws.send(JSON.stringify({ t: 'advance', id: 2, until: { idle: true } }));
    expect(await until(inbox, (m) => m.t === 'stopped')).toMatchObject({ id: 2, report: { reason: 'idle', tick: 30 } });
    expect(inbox.some((m) => m.t === 'frames')).toBe(true);
    ws.send('garbage');
    expect(await until(inbox, (m) => m.t === 'error')).toMatchObject({ message: 'malformed message' });
    ws.close();
  });

  it('answers a query with an answer message outside the command order, without a frame or a log entry', async () => {
    const host = sessions.get('sandbox') as InProcessHost;
    const { ws, inbox } = await open(`?token=${token}`);
    ws.send(JSON.stringify({ t: 'hello' }));
    await until(inbox, (m) => m.t === 'welcome');
    const logged = host.session.log.full().entries.length;
    const framesBefore = inbox.filter((m) => m.t === 'frames').length;
    ws.send(JSON.stringify({ t: 'query', id: 7, q: { type: 'previewMove', soldier: 1, to: 5 } }));
    const answer = await until(inbox, (m) => m.t === 'answer');
    expect(answer).toMatchObject({ t: 'answer', id: 7, ok: false, tick: expect.any(Number), data: { refusal: 'noQueries' } });
    expect(inbox.some((m) => m.t === 'result')).toBe(false);
    expect(inbox.filter((m) => m.t === 'frames').length).toBe(framesBefore);
    expect(host.session.log.full().entries.length).toBe(logged);
    ws.send(JSON.stringify({ t: 'query', id: 8 }));
    expect(await until(inbox, (m) => m.t === 'error')).toMatchObject({ message: 'malformed message' });
    ws.close();
  });

  it('answers a ping with the session health outside the command order, without a log entry', async () => {
    const host = sessions.get('sandbox') as InProcessHost;
    const { ws, inbox } = await open(`?token=${token}`);
    ws.send(JSON.stringify({ t: 'hello' }));
    await until(inbox, (m) => m.t === 'welcome');
    ws.send(JSON.stringify({ t: 'cmd', id: 9, cmd: { type: 'run', until: 40 } }));
    await until(inbox, (m) => m.t === 'result');
    const logged = host.session.log.full().entries.length;
    ws.send(JSON.stringify({ t: 'ping', id: 10 }));
    expect(await until(inbox, (m) => m.t === 'pong')).toEqual({
      t: 'pong',
      id: 10,
      health: {
        tick: host.session.sim.tick,
        pending: 0,
        last: { label: 'run', waitedMs: expect.any(Number), ranMs: expect.any(Number), ticks: 0 },
        loopDelayMs: expect.any(Number),
      },
    });
    expect(host.session.log.full().entries.length).toBe(logged);
    ws.close();
  });

  it('welcomes with the session instance, the same for every viewer and new for a session of the same id', async () => {
    openSession('game-instance');
    const a = await viewer('game-instance');
    const b = await viewer('game-instance');
    const instance = welcomeOf(a.inbox).instance;
    expect(welcomeOf(b.inbox)).toMatchObject({ session: 'game-instance', instance });
    a.ws.send(JSON.stringify({ t: 'closeSession', id: 1 }));
    await until(a.inbox, (m) => m.t === 'result');
    openSession('game-instance');
    const c = await viewer('game-instance');
    expect(welcomeOf(c.inbox).instance).not.toBe(instance);
    for (const v of [a, b, c]) v.ws.close();
    sessions.delete('game-instance');
  });

  it('tells every viewer that another client closed the session and refuses their requests after it', async () => {
    openSession('game-closed');
    const closer = await viewer('game-closed');
    const other = await viewer('game-closed');
    closer.ws.send(JSON.stringify({ t: 'closeSession', id: 1 }));
    expect(await until(closer.inbox, (m) => m.t === 'result')).toMatchObject({ id: 1, ok: true });
    expect(await until(other.inbox, (m) => m.t === 'closed')).toEqual({ t: 'closed', session: 'game-closed', reason: 'closed' });
    expect(sessions.has('game-closed')).toBe(false);
    other.ws.send(JSON.stringify({ t: 'cmd', id: 5, cmd: { type: 'run', until: 3 } }));
    expect(await until(other.inbox, (m) => m.t === 'error')).toEqual({ t: 'error', id: 5, message: 'say hello first' });
    other.ws.send(JSON.stringify({ t: 'hello', session: 'game-closed' }));
    expect(await until(other.inbox, (m) => m.t === 'error' && m.id === undefined)).toEqual({ t: 'error', message: 'no such session' });
    closer.ws.close();
    other.ws.close();
  });

  it('keeps a session another client watches when one leaves and closes it when the last viewer leaves', async () => {
    const host = openSession('game-leave');
    const first = await viewer('game-leave');
    const second = await viewer('game-leave');
    expect(host.viewers).toBe(2);
    first.ws.send(JSON.stringify({ t: 'leave', id: 1 }));
    expect(await until(first.inbox, (m) => m.t === 'result')).toEqual({ t: 'result', id: 1, ok: true, data: { closed: false } });
    expect(sessions.has('game-leave')).toBe(true);
    expect(host.viewers).toBe(1);
    second.ws.send(JSON.stringify({ t: 'cmd', id: 2, cmd: { type: 'run', until: 4 } }));
    expect(await until(second.inbox, (m) => m.t === 'result')).toMatchObject({ id: 2, ok: true });
    second.ws.send(JSON.stringify({ t: 'leave', id: 3 }));
    expect(await until(second.inbox, (m) => m.t === 'result' && m.id === 3)).toEqual({
      t: 'result',
      id: 3,
      ok: true,
      data: { closed: true },
    });
    expect(sessions.has('game-leave')).toBe(false);
    expect([...first.inbox, ...second.inbox].some((m) => m.t === 'closed')).toBe(false);
    first.ws.close();
    second.ws.close();
  });

  it('leaves the default session open when its last viewer leaves', async () => {
    const only = await viewer('sandbox');
    only.ws.send(JSON.stringify({ t: 'leave', id: 1 }));
    expect(await until(only.inbox, (m) => m.t === 'result')).toEqual({ t: 'result', id: 1, ok: true, data: { closed: false } });
    expect(sessions.has('sandbox')).toBe(true);
    only.ws.close();
  });

  it('answers a request that failed with an error carrying its id', async () => {
    openSession('game-failing');
    const v = await viewer('game-failing');
    v.ws.send(JSON.stringify({ t: 'cmd', id: 6, cmd: { type: FAILING_COMMAND } }));
    expect(await until(v.inbox, (m) => m.t === 'error')).toEqual({ t: 'error', id: 6, message: FAILURE });
    v.ws.close();
    sessions.delete('game-failing');
  });

  it('tells the viewers of a stopping server that their session stopped and closes their sockets as going away', async () => {
    const server = createServer();
    const own = new Map<string, SessionHost>([['sandbox', new InProcessHost(new Session('sandbox', counter()))]]);
    const wss = attachWebSocket(server, { token, sessions: own, defaultSession: 'sandbox' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws?token=${token}`);
    const inbox: ServerMessage[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
    const closed = new Promise<number>((resolve) => ws.on('close', resolve));
    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(JSON.stringify({ t: 'hello' }));
    await until(inbox, (m) => m.t === 'welcome');
    await own.get('sandbox')?.close('shutdown');
    closeSockets(wss);
    expect(await closed).toBe(1001);
    expect(inbox.at(-1)).toEqual({ t: 'closed', session: 'sandbox', reason: 'shutdown' });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
