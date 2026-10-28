import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createSaveKit, type SaveKit, TEST_ENGINE } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { Vfs } from '../content/vfs/vfs.ts';
import type { ServerMessage } from '../protocol/messages.ts';
import { createApp } from './app.ts';
import { MAX_UPLOAD_BYTES } from './save-store.ts';
import { attachWebSocket } from './ws.ts';

const token = 'save-api-test-token-0123456789';

let kit: StubSectorKit;
let k: SaveKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function appWithSandbox() {
  k = await createSaveKit(kit, { entropy: () => 4242 });
  const host = await k.hostFactory('sandbox', { seed: 5 });
  const sandbox = host.session;
  k.hosts.set('sandbox', host);
  const app = createApp({
    vfs: new Vfs([]),
    token,
    info: { originalData: false, slfCount: 0, stubs: true },
    sessions: k.hosts,
    defaultSession: 'sandbox',
    createSession: k.hostFactory,
    saves: k.saves,
  });
  return { app, sandbox };
}

describe('save API', () => {
  it('lets an MCP agent save, list, load into a new session and in place, and delete', async () => {
    const { app, sandbox } = await appWithSandbox();
    try {
      const fetchViaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
      const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
        fetch: fetchViaApp,
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: 'test', version: '1' });
      await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
      const tools = (await client.listTools()).tools;
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['save', 'load', 'listSaves', 'deleteSave', 'newSession']));
      expect(tools.find((t) => t.name === 'load')?.description).toMatch(/reseed: false/);
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const r = await client.callTool({ name, arguments: args });
        return JSON.parse((r.content as { text: string }[])[0]?.text ?? 'null');
      };
      expect(await call('status')).toMatchObject({ saveMode: 'anywhere', canSave: true });
      expect(await call('observe')).toMatchObject({ saveMode: 'anywhere', canSave: true });
      expect(await call('listSaves')).toEqual([]);
      expect(await call('save', { name: '../escape' })).toMatchObject({ ok: false, refused: 'invalidName' });
      expect(await call('save', { name: 'Auto01' })).toMatchObject({ ok: false, refused: 'reservedName' });
      expect(await call('save', { name: 'mcp', description: 'from the agent' })).toMatchObject({
        ok: true,
        name: 'mcp',
        header: { description: 'from the agent', session: 'sandbox' },
      });
      expect(await call('save', { name: 'quick' })).toMatchObject({ ok: true, name: 'QuickSave', kind: 'quick' });
      expect((await call('listSaves')).map((s: { name: string }) => s.name).sort()).toEqual(['QuickSave', 'mcp']);
      const loaded = await call('load', { name: 'mcp', reseed: false });
      expect(loaded).toMatchObject({ ok: true, name: 'mcp', seed: null, session: 'sandbox-1' });
      expect(await call('newSession', { load: 'mcp' })).toMatchObject({ session: 'sandbox-2', load: { name: 'mcp', seed: 4242 } });
      const inPlace = await call('load', { name: 'QuickSave', session: 'sandbox' });
      expect(inPlace).toMatchObject({ ok: true, name: 'QuickSave', seed: 4242, session: 'sandbox' });
      expect(k.hosts.get('sandbox')?.session).toBe(sandbox);
      expect(await call('load', { name: 'missing' })).toMatchObject({ ok: false, refused: 'notFound' });
      expect(await call('deleteSave', { name: 'mcp' })).toEqual({ deleted: true });
      expect(await call('deleteSave', { name: 'mcp' })).toEqual({ deleted: false });
      await client.close();
    } finally {
      await k.dispose();
    }
  });

  it('serves the HTTP routes with the upload cap and never a path', async () => {
    const { app } = await appWithSandbox();
    try {
      const auth = { authorization: `Bearer ${token}` };
      const json = (body: unknown) => ({
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(await (await app.request('http://localhost/api/saves', { headers: auth })).json()).toEqual([]);
      const saved = await app.request('http://localhost/api/sessions/sandbox/save', json({ name: 'http' }));
      expect(saved.status).toBe(200);
      expect((await app.request('http://localhost/api/sessions/sandbox/save', json({ name: 'a/b' }))).status).toBe(400);
      expect((await app.request('http://localhost/api/sessions/nope/save', json({}))).status).toBe(404);
      const snapshot = await app.request('http://localhost/api/sessions/sandbox/snapshot', json({ name: 'dev' }));
      expect(await snapshot.json()).toMatchObject({ ok: true, name: 'dev' });
      const file = await app.request('http://localhost/api/saves/http/file', { headers: auth });
      expect(file.status).toBe(200);
      expect(file.headers.get('content-type')).toBe('application/gzip');
      const bytes = new Uint8Array(await file.arrayBuffer());
      expect(gunzipSync(bytes).toString('utf8').startsWith('{"format":"ja2-node-save"')).toBe(true);
      const put = (name: string, body: Uint8Array) =>
        app.request(`http://localhost/api/saves/${name}/file`, { method: 'PUT', headers: auth, body: new Uint8Array(body) });
      expect(await (await put('uploaded', bytes)).json()).toMatchObject({ ok: true, name: 'uploaded' });
      expect((await put('..%2Fescape', bytes)).status).toBe(400);
      expect((await put('junk', new TextEncoder().encode('junk'))).status).toBe(400);
      expect((await put('huge', new Uint8Array(MAX_UPLOAD_BYTES + 1))).status).toBe(413);
      const load = await app.request('http://localhost/api/sessions/sandbox/load', json({ name: 'uploaded', reseed: false }));
      expect(await load.json()).toMatchObject({ ok: true, name: 'uploaded', seed: null, session: 'sandbox' });
      const created = await app.request('http://localhost/api/sessions', json({ load: 'uploaded' }));
      expect(await created.json()).toMatchObject({ load: { name: 'uploaded', seed: 4242 } });
      expect((await app.request('http://localhost/api/sessions', json({ load: 'nothing' }))).status).toBe(404);
      expect((await app.request('http://localhost/api/saves/uploaded', { method: 'DELETE', headers: auth })).status).toBe(200);
      expect((await app.request('http://localhost/api/saves/uploaded', { method: 'DELETE', headers: auth })).status).toBe(404);
      expect((await app.request('http://localhost/api/saves/http/file')).status).toBe(401);
    } finally {
      await k.dispose();
    }
  });

  it('saves and loads over the WebSocket, stopping the real-time driver and sending a fresh welcome', async () => {
    const { sandbox } = await appWithSandbox();
    const http = createServer();
    attachWebSocket(http, { token, sessions: k.hosts, defaultSession: 'sandbox' });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const ws = new WebSocket(`ws://127.0.0.1:${(http.address() as AddressInfo).port}/ws?token=${token}`);
    const inbox: ServerMessage[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise((resolve) => ws.on('open', resolve));
    const until = async (predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> => {
      for (;;) {
        const hit = inbox.find(predicate);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    try {
      ws.send(JSON.stringify({ t: 'hello' }));
      await until((m) => m.t === 'welcome');
      ws.send(JSON.stringify({ t: 'save', id: 1, name: 'ws', description: 'over the socket' }));
      expect(await until((m) => m.t === 'result' && m.id === 1)).toMatchObject({ ok: true, data: { name: 'ws', kind: 'player' } });
      ws.send(JSON.stringify({ t: 'drive', id: 2, driver: { mode: 'realtime', speed: 1 } }));
      await until((m) => m.t === 'result' && m.id === 2);
      inbox.length = 0;
      ws.send(JSON.stringify({ t: 'load', id: 3, name: 'ws', reseed: false }));
      expect(await until((m) => m.t === 'result' && m.id === 3)).toMatchObject({ ok: true, data: { name: 'ws', seed: null } });
      expect(inbox.find((m) => m.t === 'stopped')).toMatchObject({ report: { reason: 'loaded' } });
      expect(inbox.find((m) => m.t === 'welcome')).toMatchObject({
        session: 'sandbox',
        driver: { mode: 'manual' },
        engine: TEST_ENGINE,
        rules: { pack: k.pack.hash, scripts: k.pack.scriptsHash },
      });
      expect(sandbox.driver).toEqual({ mode: 'manual' });
      ws.send(JSON.stringify({ t: 'load', id: 4, name: 'nothing' }));
      expect(await until((m) => m.t === 'result' && m.id === 4)).toMatchObject({ ok: false, reason: 'notFound' });
    } finally {
      ws.close();
      sandbox.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await k.dispose();
    }
  });
});
