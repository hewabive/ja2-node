import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../protocol/messages.ts';
import type { SoldierView } from '../protocol/view.ts';
import { Session, type SessionSim } from './session.ts';
import { attachWebSocket } from './ws.ts';

const token = 'ws-test-token-0123456789';

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
      target = Number(cmd.until ?? 0);
      return { ok: true };
    },
    view: () => ({ tick, mapPath: null, soldiers: [{ id: 1, x: tick } as SoldierView] }),
  };
}

const http = createServer();
const sessions = new Map([['sandbox', new Session('sandbox', counter())]]);
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

async function until(inbox: ServerMessage[], predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> {
  for (let i = 0; i < 100; i++) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('message did not arrive');
}

describe('websocket transport', () => {
  it('refuses connections without a token', async () => {
    await expect(open('')).rejects.toThrow(/401/);
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
});
