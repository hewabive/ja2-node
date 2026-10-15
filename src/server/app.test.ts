import { describe, expect, it } from 'vitest';
import { MemoryLayer, Vfs } from '../content/vfs/vfs.ts';
import { createApp, parseRange } from './app.ts';

const token = 'test-token-0123456789';
const data = new TextEncoder().encode('0123456789');
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
