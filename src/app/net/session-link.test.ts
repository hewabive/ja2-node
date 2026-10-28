import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage, WelcomeMessage } from '../../protocol/messages.ts';
import type { SessionConnection } from '../../ui/client/front-end-client.ts';
import { SessionClient } from './session-client.ts';
import { HEARTBEAT_ID, HEARTBEAT_MS, RECONNECT_DELAYS_MS, SILENT_SERVER_MS } from './session-link.ts';

type SocketEvent = 'open' | 'message' | 'close';

class FakeSocket {
  readonly sent: ClientMessage[] = [];
  closed = false;
  readonly #listeners = new Map<SocketEvent, ((event: { data?: string }) => void)[]>();

  addEventListener(type: SocketEvent, listener: (event: { data?: string }) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ClientMessage);
  }

  close(): void {
    this.closed = true;
  }

  #emit(type: SocketEvent, event: { data?: string } = {}): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }

  opened(): void {
    this.#emit('open');
  }

  deliver(message: ServerMessage): void {
    this.#emit('message', { data: JSON.stringify(message) });
  }

  drop(): void {
    this.#emit('close');
  }
}

function welcome(session: string, instance: string, tick = 0): WelcomeMessage {
  return {
    t: 'welcome',
    session,
    instance,
    view: { tick, mapPath: null, soldiers: [] },
    driver: { mode: 'manual' },
    messages: [],
    engine: { version: 'test', commit: 'test' },
    rules: { pack: 'test', scripts: 'test' },
  };
}

interface Rig {
  readonly sockets: FakeSocket[];
  readonly connections: SessionConnection[];
  readonly client: SessionClient;
  latest(): FakeSocket;
}

function opener(sockets: FakeSocket[]) {
  return {
    open: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    now: () => Date.now(),
  };
}

async function connected(session = 's1', instance = 'first'): Promise<Rig> {
  const sockets: FakeSocket[] = [];
  const connecting = SessionClient.connect(session, opener(sockets));
  const socket = sockets[0] as FakeSocket;
  socket.opened();
  socket.deliver(welcome(session, instance));
  const client = await connecting;
  const connections: SessionConnection[] = [];
  client.onConnection = (c) => connections.push(c);
  return { sockets, connections, client, latest: () => sockets.at(-1) as FakeSocket };
}

async function redial(rig: Rig, attempt = 0): Promise<FakeSocket> {
  const before = rig.sockets.length;
  await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[attempt] ?? 0);
  expect(rig.sockets.length).toBe(before + 1);
  const socket = rig.latest();
  socket.opened();
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connecting to a session', () => {
  it('says hello to the session asked for and resolves with the welcome view', async () => {
    const rig = await connected('s1');
    expect(rig.sockets[0]?.sent[0]).toEqual({ t: 'hello', session: 's1' });
    expect(rig.client.session).toBe('s1');
    expect(rig.client.view?.tick).toBe(0);
    expect(rig.client.connection).toEqual({ state: 'open' });
  });

  it('fails instead of waiting when the server refuses the hello, closes the session or cannot be reached', async () => {
    const sockets: FakeSocket[] = [];
    const missing = SessionClient.connect('gone', opener(sockets));
    sockets[0]?.opened();
    sockets[0]?.deliver({ t: 'error', message: 'no such session' });
    await expect(missing).rejects.toThrow('no such session');
    expect(sockets[0]?.closed).toBe(true);
    const lost = SessionClient.connect('crashed', opener(sockets));
    sockets[1]?.opened();
    sockets[1]?.deliver({ t: 'closed', session: 'crashed', reason: 'lost' });
    await expect(lost).rejects.toThrow('session crashed is lost');
    const unreachable = SessionClient.connect('s1', opener(sockets));
    sockets[2]?.drop();
    await expect(unreachable).rejects.toThrow('cannot connect to the game server');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS.at(-1) ?? 0);
    expect(sockets.length).toBe(3);
  });
});

describe('a dropped connection', () => {
  it('rejects the requests in flight, refuses new ones and reconnects to the same session instance', async () => {
    const rig = await connected('s1', 'first');
    const command = rig.client.command({ type: 'wait' });
    rig.sockets[0]?.drop();
    await expect(command).rejects.toThrow('the connection to the game server was lost');
    expect(rig.connections).toEqual([{ state: 'reconnecting' }]);
    await expect(rig.client.query({ type: 'previewMove' })).rejects.toThrow('not connected to the game session');
    const down = await redial(rig, 0);
    down.drop();
    const back = await redial(rig, 1);
    expect(back.sent[0]).toEqual({ t: 'hello', session: 's1' });
    back.deliver(welcome('s1', 'first', 40));
    expect(rig.connections).toEqual([{ state: 'reconnecting' }, { state: 'open' }]);
    expect(rig.client.view?.tick).toBe(40);
    const again = rig.client.command({ type: 'wait' });
    expect(back.sent.at(-1)).toMatchObject({ t: 'cmd', cmd: { type: 'wait' } });
    back.deliver({ t: 'result', id: (back.sent.at(-1) as { id: number }).id, ok: true });
    await expect(again).resolves.toEqual({ ok: true });
  });

  it('waits longer between attempts up to the last delay', async () => {
    const rig = await connected();
    rig.sockets[0]?.drop();
    for (let attempt = 0; attempt < RECONNECT_DELAYS_MS.length + 2; attempt++) {
      const socket = await redial(rig, Math.min(attempt, RECONNECT_DELAYS_MS.length - 1));
      socket.drop();
    }
    await vi.advanceTimersByTimeAsync((RECONNECT_DELAYS_MS.at(-1) ?? 0) - 1);
    const waiting = rig.sockets.length;
    await vi.advanceTimersByTimeAsync(1);
    expect(rig.sockets.length).toBe(waiting + 1);
  });

  it('ends the session when the server answers with another instance of the same id or no longer knows it', async () => {
    const restarted = await connected('s1', 'first');
    restarted.sockets[0]?.drop();
    const fresh = await redial(restarted);
    fresh.deliver(welcome('s1', 'second'));
    expect(restarted.connections).toEqual([{ state: 'reconnecting' }, { state: 'ended', reason: 'gone' }]);
    expect(fresh.closed).toBe(true);
    expect(restarted.client.view?.tick).toBe(0);
    const forgotten = await connected('s2');
    forgotten.sockets[0]?.drop();
    (await redial(forgotten)).deliver({ t: 'error', message: 'no such session' });
    expect(forgotten.connections.at(-1)).toEqual({ state: 'ended', reason: 'gone' });
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS.at(-1) ?? 0);
    expect(forgotten.sockets.length).toBe(2);
  });
});

describe('a session closed on the server', () => {
  it('ends at once with the reason, rejects the requests in flight and stops dialling', async () => {
    const rig = await connected('s1');
    const advance = rig.client.advance({ ticks: 10 });
    rig.sockets[0]?.deliver({ t: 'closed', session: 's1', reason: 'closed' });
    await expect(advance).rejects.toThrow('the game session ended');
    expect(rig.connections).toEqual([{ state: 'ended', reason: 'closed' }]);
    expect(rig.client.connection).toEqual({ state: 'ended', reason: 'closed' });
    expect(rig.sockets[0]?.closed).toBe(true);
    rig.sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS.at(-1) ?? 0);
    expect(rig.sockets.length).toBe(1);
  });
});

describe('requests', () => {
  it('rejects only the request an error names and every request on an error without an id', async () => {
    const rig = await connected();
    const socket = rig.sockets[0] as FakeSocket;
    const first = rig.client.command({ type: 'a' });
    const second = rig.client.command({ type: 'b' });
    const [a, b] = (socket.sent.slice(-2) as { id: number }[]).map((m) => m.id);
    socket.deliver({ t: 'error', id: a ?? -1, message: 'broke' });
    await expect(first).rejects.toThrow('broke');
    socket.deliver({ t: 'result', id: b ?? -1, ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    const third = rig.client.command({ type: 'c' });
    socket.deliver({ t: 'error', message: 'malformed message' });
    await expect(third).rejects.toThrow('malformed message');
  });

  it('leaves the session with its own message and rejects what is in flight on a local close without reporting a drop', async () => {
    const rig = await connected();
    const socket = rig.sockets[0] as FakeSocket;
    const leaving = rig.client.leave();
    expect(socket.sent.at(-1)).toMatchObject({ t: 'leave' });
    socket.deliver({ t: 'result', id: (socket.sent.at(-1) as { id: number }).id, ok: true, data: { closed: false } });
    await expect(leaving).resolves.toEqual({ ok: true, data: { closed: false } });
    const pending = rig.client.command({ type: 'wait' });
    rig.client.close();
    await expect(pending).rejects.toThrow('left the game session');
    expect(socket.closed).toBe(true);
    socket.drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS.at(-1) ?? 0);
    expect(rig.connections).toEqual([]);
    expect(rig.sockets.length).toBe(1);
  });
});

describe('the heartbeat', () => {
  it('pings a quiet server, keeps its pong to itself and treats a server silent after a ping as a dropped connection', async () => {
    const rig = await connected();
    const socket = rig.sockets[0] as FakeSocket;
    const replies: string[] = [];
    rig.client.onReply = (label) => replies.push(label);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(socket.sent.at(-1)).toEqual({ t: 'ping', id: HEARTBEAT_ID });
    socket.deliver({ t: 'pong', id: HEARTBEAT_ID });
    expect(replies).toEqual([]);
    const pings = () => socket.sent.filter((m) => m.t === 'ping').length;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(pings()).toBe(2);
    await vi.advanceTimersByTimeAsync(SILENT_SERVER_MS - HEARTBEAT_MS);
    expect(rig.connections).toEqual([]);
    expect(pings()).toBe(2);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(rig.connections).toEqual([{ state: 'reconnecting' }]);
    expect(socket.closed).toBe(true);
  });

  it('sends no ping while the server keeps talking', async () => {
    const rig = await connected();
    const socket = rig.sockets[0] as FakeSocket;
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS / 2);
      socket.deliver({ t: 'frames', frames: [] });
    }
    expect(socket.sent.some((m) => m.t === 'ping')).toBe(false);
  });
});
