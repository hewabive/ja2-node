import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeEdtFile } from '../content/formats/edt.ts';
import { MemoryLayer, Vfs } from '../content/vfs/vfs.ts';
import { DirLayer } from '../node/dir-layer.ts';
import { createApp, parseRange } from './app.ts';
import { VfsHashes } from './assets-manifest.ts';
import { Session, type SessionSim } from './session.ts';
import { InProcessHost, type SessionHost } from './session-host.ts';
import type { SessionRequest } from './session-registry.ts';

const token = 'test-token-0123456789';
const data = new TextEncoder().encode('0123456789');
const DATA_HASH = createHash('sha256').update(data).digest('hex').slice(0, 16);
const app = createApp({
  vfs: new Vfs([new MemoryLayer('mem', [['Interface/Panel.STI', data]])]),
  token,
  info: { originalData: false, slfCount: 0, stubs: true },
});
const auth = { authorization: `Bearer ${token}` };

describe('server', () => {
  it('rejects requests without a token or with a foreign host', async () => {
    expect((await app.request('http://localhost/api/health')).status).toBe(401);
    expect((await app.request('http://localhost/api/health', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await app.request('http://evil.example/api/health', { headers: auth })).status).toBe(403);
    expect((await app.request(`http://127.0.0.1/api/health?token=${token}`)).status).toBe(200);
    expect((await app.request('http://localhost/api/health', { headers: { cookie: `ja2_token=${token}` } })).status).toBe(200);
  });

  it('serves health and the file list', async () => {
    const health = await (await app.request('http://localhost/api/health', { headers: auth })).json();
    expect(health).toMatchObject({ ok: true, data: { original: false, stubs: true }, files: 1 });
    const list = await (await app.request('http://localhost/api/vfs', { headers: auth })).json();
    expect(list).toEqual({ layers: ['mem'], files: [['interface/panel.sti', 10, 0]] });
  });

  it('serves whole files and ranges, case-insensitively', async () => {
    const full = await app.request('http://localhost/vfs/INTERFACE/panel.sti', { headers: auth });
    expect(full.status).toBe(200);
    expect(full.headers.get('x-vfs-layer')).toBe('mem');
    expect(await full.text()).toBe('0123456789');
    const part = await app.request('http://localhost/vfs/interface/panel.sti', { headers: { ...auth, range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    const bad = await app.request('http://localhost/vfs/interface/panel.sti', { headers: { ...auth, range: 'bytes=20-' } });
    expect(bad.status).toBe(416);
  });

  it('answers 404 and 400 for bad paths', async () => {
    expect((await app.request('http://localhost/vfs/nope.sti', { headers: auth })).status).toBe(404);
    expect((await app.request('http://localhost/vfs/a/..%2Fb', { headers: auth })).status).toBe(400);
    expect((await app.request('http://localhost/vfs/%E0%A4%A', { headers: auth })).status).toBe(400);
  });

  it('answers 304 for a matching ETag, the content hash', async () => {
    const first = await app.request('http://localhost/vfs/interface/panel.sti', { headers: auth });
    const etag = first.headers.get('etag') ?? '';
    expect(etag).toBe(`"${DATA_HASH}"`);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    const again = await app.request('http://localhost/vfs/interface/panel.sti', { headers: { ...auth, 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });

  it('serves the asset manifest gzipped, with the content hash of every file', async () => {
    const zipped = await app.request('http://localhost/api/assets/manifest', { headers: { ...auth, 'accept-encoding': 'gzip, br' } });
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    const plain = await app.request('http://localhost/api/assets/manifest', { headers: auth });
    expect(plain.headers.get('content-encoding')).toBeNull();
    const manifest = await plain.json();
    expect(manifest).toEqual({
      format: 'ja2-node-assets',
      version: 1,
      source: 'stubs',
      stubText: true,
      files: [['interface/panel.sti', 10, DATA_HASH]],
    });
    expect(JSON.parse(gunzipSync(Buffer.from(await zipped.arrayBuffer())).toString('utf8'))).toEqual(manifest);
    const etag = plain.headers.get('etag') ?? '';
    expect((await app.request('http://localhost/api/assets/manifest', { headers: { ...auth, 'if-none-match': etag } })).status).toBe(304);
    expect((await app.request('http://localhost/api/assets/manifest')).status).toBe(401);
  });

  it('serves a file under its content hash as immutable, and refuses a stale or malformed hash', async () => {
    const pinned = await app.request(`http://localhost/vfs/@${DATA_HASH}/Interface/Panel.sti`, { headers: auth });
    expect(pinned.status).toBe(200);
    expect(pinned.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(await pinned.text()).toBe('0123456789');
    const part = await app.request(`http://localhost/vfs/@${DATA_HASH}/interface/panel.sti`, { headers: { ...auth, range: 'bytes=1-2' } });
    expect(await part.text()).toBe('12');
    expect((await app.request('http://localhost/vfs/@0000000000000000/interface/panel.sti', { headers: auth })).status).toBe(404);
    expect((await app.request('http://localhost/vfs/@xyz/interface/panel.sti', { headers: auth })).status).toBe(400);
    expect((await app.request(`http://localhost/vfs/@${DATA_HASH}/interface/panel.sti`)).status).toBe(401);
  });

  it('keeps the content hashes in the cache folder, so a restart reads no file again', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'ja2-hashes-'));
    const root = mkdtempSync(join(tmpdir(), 'ja2-loose-'));
    writeFileSync(join(root, 'panel.sti'), data);
    const vfs = new Vfs([await DirLayer.open('dir', root)]);
    const first = await VfsHashes.open(vfs, cacheDir);
    expect(await first.contentHash('panel.sti')).toBe(DATA_HASH);
    await first.flush();
    const reads: string[] = [];
    const counted = new Vfs([
      {
        name: 'dir',
        entries: () => vfs.layers[0]?.entries() ?? [],
        stamp: (path) => vfs.stamp(path),
        read: async (path, start, end) => {
          reads.push(path);
          return vfs.read(path, start, end);
        },
      },
    ]);
    const second = await VfsHashes.open(counted, cacheDir);
    expect(await second.contentHash('panel.sti')).toBe(DATA_HASH);
    expect(reads).toEqual([]);
  });

  it('logs in with a token link and serves the built client without a token', async () => {
    const clientDir = mkdtempSync(join(tmpdir(), 'ja2-client-'));
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>client</title>');
    const withClient = createApp({ vfs: new Vfs([]), token, info: { originalData: false, slfCount: 0, stubs: false }, clientDir });
    const page = await withClient.request('http://localhost/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('client');
    expect((await withClient.request('http://localhost/login?token=wrong')).status).toBe(401);
    const login = await withClient.request(`http://localhost/login?token=${token}`);
    expect(login.status).toBe(302);
    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/ja2_token=.*HttpOnly.*SameSite=Strict/);
    const health = await withClient.request('http://localhost/api/health', { headers: { cookie: cookie.split(';')[0] ?? '' } });
    expect(health.status).toBe(200);
  });

  it('serves dialogue rows from the original or the stub layer', async () => {
    const layouts = JSON.stringify({ files: [{ path: 'npcdata/{03d}.edt', columns: [240] }] });
    const texts = createApp({
      vfs: new Vfs([
        new MemoryLayer('stubs', [
          ['stubs/npcdata/094.edt', encodeEdtFile(['first line', 'second line'])],
          ['tables/edt-layouts.json', new TextEncoder().encode(layouts)],
        ]),
      ]),
      token,
      info: { originalData: false, slfCount: 0, stubs: true },
    });
    const ok = await texts.request('http://localhost/api/text?file=npcdata/094.edt&row=1', { headers: auth });
    expect(await ok.json()).toEqual({
      file: 'npcdata/094.edt',
      row: 1,
      layout: [240],
      columns: ['second line'],
      column: 0,
      width: 240,
      text: 'second line',
    });
    expect((await texts.request('http://localhost/api/text?file=npcdata/094.edt&row=9', { headers: auth })).status).toBe(404);
    expect((await texts.request('http://localhost/api/text?file=../prof.dat&row=1', { headers: auth })).status).toBe(400);
    expect((await texts.request('http://localhost/api/text?file=npcdata/094.edt&row=1')).status).toBe(401);
  });

  it('serves stub media under the original path names only on the stub data version', async () => {
    const layers = () => [
      new MemoryLayer('ja2-node-data', [['music/own.wav', data]]),
      new MemoryLayer('stubs', [['stubs/sounds/door open 01.wav', data]]),
    ];
    const stubbed = createApp({ vfs: new Vfs(layers()), token, info: { originalData: false, slfCount: 0, stubs: true } });
    const sound = await stubbed.request('http://localhost/vfs/sounds/door%20open%2001.wav', { headers: { ...auth, range: 'bytes=0-3' } });
    expect(sound.status).toBe(206);
    expect(sound.headers.get('x-vfs-layer')).toBe('stubs');
    expect(sound.headers.get('content-type')).toBe('audio/wav');
    expect(await sound.text()).toBe('0123');
    expect((await stubbed.request('http://localhost/vfs/stubs/sounds/door%20open%2001.wav', { headers: auth })).status).toBe(200);
    expect((await stubbed.request('http://localhost/vfs/music/own.wav', { headers: auth })).headers.get('x-vfs-layer')).toBe(
      'ja2-node-data',
    );
    const original = createApp({ vfs: new Vfs(layers()), token, info: { originalData: true, slfCount: 1, stubs: true } });
    expect((await original.request('http://localhost/vfs/sounds/door%20open%2001.wav', { headers: auth })).status).toBe(404);
  });

  it('parseRange', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=0-', 10)).toEqual({ start: 0, end: 10 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 10 });
    expect(parseRange('bytes=5-100', 10)).toEqual({ start: 5, end: 10 });
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=1-2,4-5', 10)).toBeNull();
    expect(parseRange('bytes=5-2', 10)).toBeNull();
  });
});

describe('session endpoints', () => {
  const still: SessionSim = {
    tick: 0,
    isIdle: () => true,
    hasPendingDecision: () => false,
    step: () => {},
    drainEvents: () => [],
    dispatch: () => ({ ok: true }),
    view: () => ({ tick: 0, mapPath: null, soldiers: [] }),
  };
  const requests: SessionRequest[] = [];
  const sessions = new Map<string, SessionHost>([['sandbox', new InProcessHost(new Session('sandbox', still))]]);
  const withSessions = createApp({
    vfs: new Vfs([]),
    token,
    info: { originalData: false, slfCount: 0, stubs: true },
    sessions,
    defaultSession: 'sandbox',
    createSession: async (id, request) => {
      requests.push(request);
      return new InProcessHost(new Session(id, still));
    },
  });
  const post = (body: unknown) =>
    withSessions.request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('creates a campaign session and lists it', async () => {
    const created = await (await post({ seed: 4, campaign: { difficulty: 3, mercs: 2 } })).json();
    expect(created).toMatchObject({ session: 'sandbox-1' });
    expect(requests.at(-1)).toEqual({ seed: 4, campaign: { difficulty: 3, mercs: 2 } });
    const list = await (await withSessions.request('http://localhost/api/sessions', { headers: auth })).json();
    expect(list.map((s: { session: string }) => s.session)).toEqual(['sandbox', 'sandbox-1']);
  });

  it('lists a session whose host fails with its error instead of failing the whole list', async () => {
    let broken = false;
    const failing: SessionSim = {
      ...still,
      view: () => {
        if (broken) throw new Error('worker gone');
        return still.view();
      },
    };
    const hosts = new Map<string, SessionHost>([
      ['sandbox', new InProcessHost(new Session('sandbox', still))],
      ['lost', new InProcessHost(new Session('lost', failing))],
    ]);
    broken = true;
    const listing = createApp({ vfs: new Vfs([]), token, info: { originalData: false, slfCount: 0, stubs: true }, sessions: hosts });
    const list = await (await listing.request('http://localhost/api/sessions', { headers: auth })).json();
    expect(list).toEqual([expect.objectContaining({ session: 'sandbox' }), { session: 'lost', kind: 'inprocess', error: 'worker gone' }]);
  });

  it('refuses malformed and contradictory requests', async () => {
    expect((await post({ campaign: { difficulty: 9 } })).status).toBe(400);
    expect((await post({ save: 'SaveGame01', campaign: {} })).status).toBe(400);
    expect((await post({ unknown: true })).status).toBe(400);
  });
});
