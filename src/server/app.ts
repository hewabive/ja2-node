import { timingSafeEqual } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import {
  DEFAULT_VANILLA_VERSION,
  displayLanguageOf,
  isUiLanguage,
  STUB_DATA_VERSION,
  UI_LANGUAGES,
  type UiLanguage,
} from '../content/text/data-version.ts';
import { vfsExtension } from '../content/vfs/path.ts';
import { type Vfs, VfsNotFoundError } from '../content/vfs/vfs.ts';
import { clientPagePath } from '../node/client-pages.ts';
import { ASSET_MANIFEST_ROUTE, isAssetHash, PINNED_PREFIX, VFS_ROUTE } from '../protocol/assets.ts';
import type { WelcomeIdentity } from '../protocol/messages.ts';
import { type EncodedAssetManifest, encodeAssetManifest, VfsHashes } from './assets-manifest.ts';
import { handleMcpRequest } from './mcp.ts';
import { SAVE_EXTENSION } from './save-file.ts';
import { type LoadProblem, loadProblemOf, type SaveOutcome, type SaveService } from './save-service.ts';
import { MAX_UPLOAD_BYTES, playerSaveName } from './save-store.ts';
import type { HostFactory, SessionHost } from './session-host.ts';
import { newSessionRequest, openSession } from './session-registry.ts';
import { textKeyFor } from './text-keys.ts';
import { STUB_TEXT_PREFIX, TextService } from './text-service.ts';

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
  readonly hashes?: VfsHashes;
  readonly rules?: WelcomeIdentity['rules'];
  readonly sessions?: Map<string, SessionHost>;
  readonly defaultSession?: string;
  readonly createSession?: HostFactory;
  readonly texts?: TextService;
  readonly defaultLanguage?: UiLanguage;
  readonly saves?: SaveService;
}

export const TOKEN_COOKIE = 'ja2_token';

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const MAX_TEXT_ROW = 4096;
const STRINGS_CACHE_CONTROL = 'private, max-age=3600';
const LANGUAGE_ERROR = `lang must be one of ${UI_LANGUAGES.join(', ')}`;
const EDT_ERRORS = {
  noLayout: { status: 400, message: 'file must be an EDT file the game reads (data/tables/edt-layouts.json)' },
  notFound: { status: 404, message: 'not found' },
  noRow: { status: 404, message: 'no such row' },
} as const;

const LOAD_STATUS: Readonly<Record<LoadProblem, 400 | 404 | 409 | 413>> = {
  notFound: 404,
  invalidName: 400,
  contentMismatch: 409,
  versionTooNew: 409,
  noMigration: 409,
  notASave: 400,
  corrupt: 400,
  tooLarge: 413,
};
const SNAPSHOT_DESCRIPTION = 'developer snapshot';
const IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'private, no-cache';

interface VfsRequest {
  readonly path: string;
  readonly pinned: string | null;
}

function vfsRequestOf(raw: string): VfsRequest | 'malformed' {
  if (!raw.startsWith(PINNED_PREFIX)) return { path: raw, pinned: null };
  const slash = raw.indexOf('/');
  const hash = slash < 0 ? '' : raw.slice(PINNED_PREFIX.length, slash);
  return isAssetHash(hash) ? { path: raw.slice(slash + 1), pinned: hash } : 'malformed';
}

function acceptsGzip(header: string | undefined): boolean {
  return header?.split(',').some((part) => part.trim().split(';')[0]?.trim().toLowerCase() === 'gzip') ?? false;
}

const saveRequest = z.object({ name: z.string().max(64).optional(), description: z.string().max(200).optional() }).strict();
const loadRequest = z.object({ name: z.string().max(64), reseed: z.boolean().optional() }).strict();

function loadFailure(c: Context, err: unknown): Response {
  const problem = loadProblemOf(err);
  return c.json({ ok: false, refused: problem, reason: (err as Error).message }, LOAD_STATUS[problem]);
}

function saveResponse(c: Context, outcome: SaveOutcome): Response {
  if (outcome.ok) return c.json(outcome);
  return c.json(outcome, outcome.refused === 'invalidName' || outcome.refused === 'reservedName' ? 400 : 409);
}

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

function rowNumber(value: string | undefined, fallback?: number): number | null {
  if (value === undefined) return fallback ?? null;
  const n = Number(value);
  return value !== '' && Number.isInteger(n) && n >= 0 && n <= MAX_TEXT_ROW ? n : null;
}

export function createApp(options: AppOptions): Hono {
  const { vfs, token, info } = options;
  const texts = options.texts ?? new TextService({ vfs, dataVersion: info.originalData ? DEFAULT_VANILLA_VERSION : STUB_DATA_VERSION });
  const defaultLanguage = options.defaultLanguage ?? displayLanguageOf(texts.dataVersion);
  const languageParam = (value: string | undefined): UiLanguage | null => {
    const wanted = value?.toLowerCase() ?? defaultLanguage;
    return isUiLanguage(wanted) ? wanted : null;
  };
  const hosts = new Set(options.allowedHosts ?? DEFAULT_HOSTS);
  const hashes = options.hashes ?? VfsHashes.memory(vfs);
  const stubFallback = texts.dataVersion === STUB_DATA_VERSION;
  let manifest: Promise<EncodedAssetManifest> | null = null;
  const assetManifest = (): Promise<EncodedAssetManifest> => {
    manifest ??= hashes.manifest(info.originalData ? 'original' : 'stubs', stubFallback).then(encodeAssetManifest);
    manifest.catch(() => {
      manifest = null;
    });
    return manifest;
  };
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
  app.use('/mcp', requireToken);
  app.all('/mcp', (c) =>
    handleMcpRequest(c.req.raw, {
      sessions: options.sessions ?? new Map(),
      defaultSession: options.defaultSession ?? 'sandbox',
      createSession: options.createSession,
      texts,
      saves: options.saves,
    }),
  );
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
      dataVersion: texts.dataVersion,
      language: defaultLanguage,
      ...(options.saves ? { engine: options.saves.engine } : {}),
      ...(options.rules ? { rules: options.rules } : {}),
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

  app.get(ASSET_MANIFEST_ROUTE, async (c) => {
    const encoded = await assetManifest();
    const headers = {
      'content-type': 'application/json',
      'cache-control': REVALIDATE_CACHE_CONTROL,
      etag: encoded.etag,
      vary: 'Accept-Encoding',
    };
    if (c.req.header('if-none-match') === encoded.etag) return c.body(null, 304, headers);
    if (acceptsGzip(c.req.header('accept-encoding')))
      return c.body(new Uint8Array(encoded.gzip), 200, { ...headers, 'content-encoding': 'gzip' });
    return c.body(new Uint8Array(encoded.json), 200, headers);
  });

  app.get('/api/strings', async (c) => {
    const language = languageParam(c.req.query('lang'));
    if (!language) return c.json({ error: LANGUAGE_ERROR }, 400);
    const loaded = await texts.strings(language).catch((err: Error) => err);
    if (loaded instanceof Error) return c.json({ error: loaded.message }, 500);
    const headers = { 'content-type': 'application/json', 'cache-control': STRINGS_CACHE_CONTROL, etag: loaded.etag };
    if (c.req.header('if-none-match') === loaded.etag) return c.body(null, 304, headers);
    return c.body(loaded.body, 200, headers);
  });

  app.get('/api/text', async (c) => {
    const { file, table, key } = c.req.query();
    if (table !== undefined || key !== undefined) {
      const language = languageParam(c.req.query('lang'));
      if (!language) return c.json({ error: LANGUAGE_ERROR }, 400);
      const uiKey = key !== undefined ? textKeyFor(key) : { table: table ?? '', index: rowNumber(c.req.query('index'), 0) ?? -1 };
      if (!uiKey || uiKey.index < 0)
        return c.json({ error: key !== undefined ? `unknown key ${key}` : 'index must be a non-negative integer' }, 400);
      const text = await texts.uiText(language, uiKey.table, uiKey.index).catch(() => null);
      if (text === null) return c.json({ error: `no string ${uiKey.table}[${uiKey.index}]` }, 404);
      return c.json({ ...(key !== undefined ? { key } : {}), table: uiKey.table, index: uiKey.index, language, text });
    }
    const row = rowNumber(c.req.query('row'));
    if (row === null) return c.json({ error: 'row must be a non-negative integer' }, 400);
    const found = await texts.edtRecord(file ?? '', row);
    if (!found.ok) return c.json({ error: `${EDT_ERRORS[found.error].message}: ${file ?? ''}` }, EDT_ERRORS[found.error].status);
    const { record } = found;
    const column = rowNumber(c.req.query('column'), 0);
    if (column === null || column >= record.columns.length) return c.json({ error: `column must be below ${record.columns.length}` }, 400);
    return c.json({ ...record, column, width: record.layout[column], text: record.columns[column] });
  });

  const describeOrFail = (host: SessionHost) =>
    host.describe().catch((err: Error) => ({ session: host.id, kind: host.kind, error: err.message }));
  app.get('/api/sessions', async (c) => c.json(await Promise.all([...(options.sessions?.values() ?? [])].map(describeOrFail))));

  app.post('/api/sessions', async (c) => {
    const { sessions, createSession } = options;
    if (!sessions || !createSession) return c.json({ error: 'sessions are not available' }, 404);
    const request = newSessionRequest.safeParse(await c.req.json().catch(() => null));
    if (!request.success) return c.json({ error: request.error.message }, 400);
    try {
      const created = await openSession(sessions, options.defaultSession ?? 'sandbox', createSession, request.data);
      return c.json({ ...(await created.describe()), ...(await created.report()) });
    } catch (err) {
      if (request.data.load) return loadFailure(c, err);
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  const saves = options.saves;
  if (saves) {
    const sessionOf = (c: Context): SessionHost | null => options.sessions?.get(c.req.param('id') ?? '') ?? null;
    const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | null> => {
      const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
      return parsed.success ? parsed.data : null;
    };
    app.get('/api/saves', async (c) => c.json(await saves.list()));
    app.post('/api/sessions/:id/save', async (c) => {
      const session = sessionOf(c);
      if (!session) return c.json({ error: 'no such session' }, 404);
      const request = await body(c, saveRequest);
      if (!request) return c.json({ error: 'expected {name?, description?}' }, 400);
      return saveResponse(c, await session.save(request));
    });
    app.post('/api/sessions/:id/snapshot', async (c) => {
      const session = sessionOf(c);
      if (!session) return c.json({ error: 'no such session' }, 404);
      const request = await body(c, saveRequest);
      if (!request) return c.json({ error: 'expected {name?, description?}' }, 400);
      const description = request.description ?? SNAPSHOT_DESCRIPTION;
      return saveResponse(c, await session.saveSnapshot(request.name ?? playerSaveName(description, new Date()), description));
    });
    app.post('/api/sessions/:id/load', async (c) => {
      const session = sessionOf(c);
      if (!session) return c.json({ error: 'no such session' }, 404);
      const request = await body(c, loadRequest);
      if (!request) return c.json({ error: 'expected {name, reseed?}' }, 400);
      try {
        return c.json({ ...(await session.load(request.name, request.reseed ?? true)), ...(await session.describe()) });
      } catch (err) {
        return loadFailure(c, err);
      }
    });
    app.delete('/api/saves/:name', async (c) => {
      try {
        const deleted = await saves.delete(c.req.param('name'));
        return c.json({ deleted }, deleted ? 200 : 404);
      } catch (err) {
        return loadFailure(c, err);
      }
    });
    app.get('/api/saves/:name/file', async (c) => {
      const name = c.req.param('name');
      try {
        const bytes = await saves.download(name);
        return c.body(new Uint8Array(bytes), 200, {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${name}${SAVE_EXTENSION}"`,
          'cache-control': 'no-store',
        });
      } catch (err) {
        return loadFailure(c, err);
      }
    });
    app.put(
      '/api/saves/:name/file',
      bodyLimit({
        maxSize: MAX_UPLOAD_BYTES,
        onError: (c) => c.json({ ok: false, refused: 'tooLarge', reason: `a save may hold at most ${MAX_UPLOAD_BYTES} bytes` }, 413),
      }),
      async (c) => {
        try {
          return c.json(await saves.upload(c.req.param('name'), new Uint8Array(await c.req.arrayBuffer())));
        } catch (err) {
          return loadFailure(c, err);
        }
      },
    );
  }

  app.get('/vfs/*', async (c) => {
    let request: VfsRequest | 'malformed';
    try {
      request = vfsRequestOf(decodeURIComponent(new URL(c.req.url).pathname.slice(VFS_ROUTE.length)));
    } catch {
      return c.json({ error: 'bad path encoding' }, 400);
    }
    if (request === 'malformed') return c.json({ error: 'expected /vfs/@<16 hex digits>/<path>' }, 400);
    const { path, pinned } = request;
    let info: ReturnType<Vfs['stat']>;
    try {
      info = vfs.stat(path) ?? (stubFallback ? vfs.stat(`${STUB_TEXT_PREFIX}${path}`) : undefined);
    } catch (err) {
      if (err instanceof RangeError) return c.json({ error: err.message }, 400);
      throw err;
    }
    if (!info) return c.json({ error: `not found: ${path}` }, 404);
    const hash = await hashes.contentHash(info.path);
    if (pinned !== null && pinned !== hash) return c.json({ error: `stale: ${path} has changed, fetch the manifest again` }, 404);
    const etag = `"${hash}"`;
    const headers: Record<string, string> = {
      'content-type': MIME[vfsExtension(info.path)] ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': pinned !== null ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL,
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

  if (options.clientDir) app.use('*', serveStatic({ root: options.clientDir, rewriteRequestPath: clientPagePath }));

  return app;
}
