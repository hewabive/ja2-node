import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { Vfs } from '../content/vfs/vfs.ts';
import type { ServerMessage } from '../protocol/messages.ts';
import { createApp } from './app.ts';
import { attachWebSocket } from './ws.ts';

const token = 'close-api-test-token-0123456789';
const auth = { authorization: `Bearer ${token}` };
const TEST_TIMEOUT_MS = 120_000;
const DEAD_IS_DEAD_NAME = /^\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}z-the-long-run$/;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function appWithSandbox(k: SaveKit) {
  k.hosts.set('sandbox', await k.hostFactory('sandbox', { seed: 5 }));
  return createApp({
    vfs: new Vfs([]),
    token,
    info: { originalData: false, slfCount: 0, stubs: true },
    sessions: k.hosts,
    defaultSession: 'sandbox',
    createSession: k.hostFactory,
    saves: k.saves,
  });
}

function post(body: unknown): RequestInit {
  return { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('closing a session', () => {
  it(
    'releases a session over HTTP and keeps the default session',
    async () => {
      const k = await createSaveKit(kit);
      try {
        const app = await appWithSandbox(k);
        const created = (await (await app.request('http://localhost/api/sessions', post({ seed: 3 }))).json()) as { session: string };
        expect(k.hosts.has(created.session)).toBe(true);
        const close = () => app.request(`http://localhost/api/sessions/${created.session}`, { method: 'DELETE', headers: auth });
        expect(await (await close()).json()).toEqual({ closed: true });
        expect(k.hosts.has(created.session)).toBe(false);
        expect((await close()).status).toBe(404);
        const keep = await app.request('http://localhost/api/sessions/sandbox', { method: 'DELETE', headers: auth });
        expect(keep.status).toBe(409);
        expect(await keep.json()).toEqual({ closed: false, refused: 'defaultSession' });
      } finally {
        await k.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'names a Dead is Dead campaign from its description and writes it when the session closes',
    async () => {
      const k = await createSaveKit(kit);
      try {
        const app = await appWithSandbox(k);
        const request = { campaign: { options: { saveMode: 'deadIsDead' }, deadIsDeadDescription: 'The long run', hire: [] } };
        const created = (await (await app.request('http://localhost/api/sessions', post(request))).json()) as { session: string };
        const host = k.hosts.get(created.session);
        if (!host) throw new Error('no campaign session');
        expect(k.saves.deadIsDeadName(host.session)).toMatch(DEAD_IS_DEAD_NAME);
        const both = { campaign: { deadIsDeadName: 'Mine', deadIsDeadDescription: 'Mine too' } };
        expect((await app.request('http://localhost/api/sessions', post(both))).status).toBe(400);
        await app.request(`http://localhost/api/sessions/${created.session}`, { method: 'DELETE', headers: auth });
        const saves = (await (await app.request('http://localhost/api/saves', { headers: auth })).json()) as {
          name: string;
          header?: { description: string; kind: string };
        }[];
        const written = saves.find((s) => DEAD_IS_DEAD_NAME.test(s.name));
        expect(written?.header).toMatchObject({ kind: 'deadIsDead', description: 'The long run' });
      } finally {
        await k.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'closes the session of a WebSocket and keeps the message ring through a save and a load',
    async () => {
      const k = await createSaveKit(kit);
      const app = await appWithSandbox(k);
      const created = (await (await app.request('http://localhost/api/sessions', post({ seed: 4 }))).json()) as { session: string };
      const host = k.hosts.get(created.session);
      if (!host) throw new Error('no session');
      expect(await host.save({ name: 'ring' })).toMatchObject({ ok: true });
      expect(host.session.messages.map((m) => [m.table, m.index])).toEqual([['pMessageStrings', 8]]);
      expect(await host.save({ name: 'ring2' })).toMatchObject({ ok: true });
      const reopened = await k.hostFactory('reopened', { seed: 1, load: { name: 'ring2', reseed: false } });
      expect(reopened.session.messages.map((m) => [m.table, m.index])).toEqual([['pMessageStrings', 8]]);
      const http = createServer();
      attachWebSocket(http, { token, sessions: k.hosts, defaultSession: 'sandbox' });
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const ws = new WebSocket(`ws://127.0.0.1:${(http.address() as AddressInfo).port}/ws?token=${token}`);
      const inbox: ServerMessage[] = [];
      ws.on('message', (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
      await new Promise((resolve) => ws.on('open', resolve));
      const until = async (predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> => {
        for (let i = 0; i < 500; i++) {
          const hit = inbox.find(predicate);
          if (hit) return hit;
          await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error('message did not arrive');
      };
      try {
        ws.send(JSON.stringify({ t: 'hello', session: created.session }));
        const saved = { table: 'pMessageStrings', index: 8 };
        expect(await until((m) => m.t === 'welcome')).toMatchObject({ messages: [saved, saved] });
        ws.send(JSON.stringify({ t: 'closeSession', id: 1 }));
        expect(await until((m) => m.t === 'result' && m.id === 1)).toMatchObject({ ok: true });
        expect(k.hosts.has(created.session)).toBe(false);
      } finally {
        ws.close();
        await reopened.close();
        await new Promise<void>((resolve) => http.close(() => resolve()));
        await k.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
