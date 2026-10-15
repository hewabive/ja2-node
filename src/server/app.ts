import { timingSafeEqual } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { vfsExtension } from '../content/vfs/path.ts';
import { type Vfs, VfsNotFoundError } from '../content/vfs/vfs.ts';

export interface AppInfo {
  readonly originalData: boolean;
  readonly slfCount: number;
  readonly stubs: boolean;
}

export interface AppOptions {
  readonly vfs: Vfs;
  readonly token: string;
  readonly info: AppInfo;
  readonly allowedHosts?: readonly string[];
  readonly clientDir?: string;
  readonly vfsGeneration?: string;
}

export const TOKEN_COOKIE = 'ja2_token';

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const MIME: Record<string, string> = {
  json: 'application/json',
  png: 'image/png',
  txt: 'text/plain; charset=utf-8',
  wav: 'audio/wav',
};

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size : Math.min(size, Number(m[2]) + 1);
    if (m[2] !== '' && Number(m[2]) < start) return null;
  }
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

export function createApp(options: AppOptions): Hono {
  const { vfs, token, info } = options;
  const hosts = new Set(options.allowedHosts ?? DEFAULT_HOSTS);
  const generation = options.vfsGeneration ?? 'dev';
  const app = new Hono();

  app.use('*', async (c, next) => {
    const host = new URL(c.req.url).hostname;
    if (!hosts.has(host) && !hosts.has(`[${host}]`)) return c.json({ error: 'host not allowed' }, 403);
    return next();
  });
  const requireToken = createMiddleware(async (c, next) => {
    const auth = c.req.header('authorization');
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!sameToken(bearer ?? getCookie(c, TOKEN_COOKIE) ?? c.req.query('token'), token)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  });
  app.use('/api/*', requireToken);
  app.use('/vfs/*', requireToken);
  app.get('/login', (c) => {
    if (!sameToken(c.req.query('token'), token)) return c.json({ error: 'unauthorized' }, 401);
    setCookie(c, TOKEN_COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/' });
    return c.redirect('/');
  });
  app.use('/api/*', compress());

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      name: 'ja2-node',
      data: { original: info.originalData, slf: info.slfCount, stubs: info.stubs },
      files: vfs.size,
    }),
  );

  app.get('/api/vfs', (c) => {
    const layers: string[] = [];
    const layerIndex = new Map<string, number>();
    const files = vfs.list().map((f) => {
      let i = layerIndex.get(f.layer);
      if (i === undefined) {
        i = layers.length;
        layers.push(f.layer);
        layerIndex.set(f.layer, i);
      }
      return [f.path, f.size, i] as const;
    });
    return c.json({ layers, files });
  });

  app.get('/vfs/*', async (c) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(c.req.url).pathname.slice('/vfs/'.length));
    } catch {
      return c.json({ error: 'bad path encoding' }, 400);
    }
    let info: ReturnType<Vfs['stat']>;
    try {
      info = vfs.stat(path);
    } catch (err) {
      if (err instanceof RangeError) return c.json({ error: err.message }, 400);
      throw err;
    }
    if (!info) return c.json({ error: `not found: ${path}` }, 404);
    const etag = `"${generation}-${info.layer}-${info.size}"`;
    const headers: Record<string, string> = {
      'content-type': MIME[vfsExtension(info.path)] ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-cache',
      etag,
      'x-vfs-layer': info.layer,
    };
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
    const range = parseRange(c.req.header('range'), info.size);
    if (range === 'unsatisfiable') {
      return c.body(null, 416, { ...headers, 'content-range': `bytes */${info.size}` });
    }
    try {
      if (range) {
        const data = await vfs.read(info.path, range.start, range.end);
        return c.body(data, 206, { ...headers, 'content-range': `bytes ${range.start}-${range.end - 1}/${info.size}` });
      }
      return c.body(await vfs.read(info.path), 200, headers);
    } catch (err) {
      if (err instanceof VfsNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  if (options.clientDir) app.use('*', serveStatic({ root: options.clientDir }));

  return app;
}
