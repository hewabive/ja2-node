import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import { type ClientMessage, parseClientMessage, type ServerMessage } from '../protocol/messages.ts';
import type { CommandResult } from '../sim/command.ts';
import type { QueryAnswer } from './query.ts';
import { loadProblemOf } from './save-service.ts';
import type { SessionHost } from './session-host.ts';
import { closeRegisteredSession } from './session-registry.ts';

const MAX_MESSAGE_BYTES = 1 << 20;
const COMPRESS_FROM_BYTES = 128;
const PER_MESSAGE_DEFLATE = { threshold: COMPRESS_FROM_BYTES };
const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export interface UpgradeServer {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

export interface WebSocketOptions {
  readonly token: string;
  readonly sessions: Map<string, SessionHost>;
  readonly defaultSession: string;
  readonly allowedHosts?: readonly string[];
}

function tokenFrom(req: IncomingMessage, url: URL): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const cookie = /(?:^|;\s*)ja2_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  return cookie ?? url.searchParams.get('token') ?? undefined;
}

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reject(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

type Reply = ServerMessage | null;

function resultOf(id: number, r: CommandResult): ServerMessage {
  return { t: 'result', id, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}), ...(r.data !== undefined ? { data: r.data } : {}) };
}

function savesMissing(id: number): ServerMessage {
  return { t: 'result', id, ok: false, reason: 'saves are not available' };
}

async function saveReply(host: SessionHost, id: number, name: string | undefined, description: string | undefined): Promise<Reply> {
  if (!host.savesAvailable) return savesMissing(id);
  const outcome = await host.save({ name, description });
  return { t: 'result', id, ok: outcome.ok, ...(outcome.ok ? {} : { reason: outcome.refused }), data: outcome };
}

async function loadReply(host: SessionHost, id: number, name: string, reseed: boolean): Promise<Reply> {
  if (!host.savesAvailable) return savesMissing(id);
  try {
    return { t: 'result', id, ok: true, data: await host.load(name, reseed) };
  } catch (err) {
    const refused = loadProblemOf(err);
    return { t: 'result', id, ok: false, reason: refused, data: { refused, reason: (err as Error).message } };
  }
}

async function closeReply(options: WebSocketOptions, host: SessionHost, id: number): Promise<Reply> {
  const outcome = await closeRegisteredSession(options.sessions, options.defaultSession, host.id);
  return { t: 'result', id, ok: outcome === 'closed', ...(outcome === 'closed' ? {} : { reason: outcome }) };
}

function answerOf(id: number, a: QueryAnswer): ServerMessage {
  return {
    t: 'answer',
    id,
    ok: a.ok,
    tick: a.tick,
    ...(a.reason ? { reason: a.reason } : {}),
    ...(a.data !== undefined ? { data: a.data } : {}),
  };
}

function reply(
  options: WebSocketOptions,
  host: SessionHost,
  message: Exclude<ClientMessage, { t: 'hello' } | { t: 'query' }>,
): Promise<Reply> {
  switch (message.t) {
    case 'closeSession':
      return closeReply(options, host, message.id);
    case 'cmd':
      return host.prepareAndDispatch(message.cmd).then((r) => resultOf(message.id, r));
    case 'advance':
      return host.advance(message.until).then((report) => ({ t: 'stopped', id: message.id, report }));
    case 'drive':
      return host.setDriver(message.driver).then(() => ({ t: 'result', id: message.id, ok: true }));
    case 'save':
      return saveReply(host, message.id, message.name, message.description);
    case 'load':
      return loadReply(host, message.id, message.name, message.reseed ?? true);
  }
}

function serve(ws: WebSocket, options: WebSocketOptions): void {
  let unsubscribe: (() => void) | null = null;
  let host: SessionHost | null = null;
  let replies: Promise<unknown> = Promise.resolve();
  const send = (m: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const inOrder = (pending: Promise<Reply>) => {
    replies = replies
      .then(() => pending)
      .then(
        (m) => {
          if (m) send(m);
        },
        (err: Error) => send({ t: 'error', message: err.message }),
      );
  };
  ws.on('message', (data) => {
    const message = parseClientMessage(data.toString());
    if (!message) return send({ t: 'error', message: 'malformed message' });
    if (message.t === 'hello') {
      unsubscribe?.();
      unsubscribe = null;
      host = options.sessions.get(message.session ?? options.defaultSession) ?? null;
      if (!host) return send({ t: 'error', message: 'no such session' });
      unsubscribe = host.subscribe(send);
      return;
    }
    if (!host) return send({ t: 'error', message: 'say hello first' });
    if (message.t === 'query') {
      const id = message.id;
      host.query(message.q).then(
        (a) => send(answerOf(id, a)),
        (err: Error) => send({ t: 'answer', id, ok: false, tick: 0, reason: err.message }),
      );
      return;
    }
    inOrder(reply(options, host, message));
  });
  ws.on('close', () => unsubscribe?.());
}

export function attachWebSocket(server: UpgradeServer, options: WebSocketOptions): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: PER_MESSAGE_DEFLATE });
  const hosts = new Set(options.allowedHosts ?? DEFAULT_HOSTS);
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'invalid'}`);
    if (url.pathname !== '/ws') return reject(socket, '404 Not Found');
    if (!hosts.has(url.hostname) && !hosts.has(`[${url.hostname}]`)) return reject(socket, '403 Forbidden');
    if (!sameToken(tokenFrom(req, url), options.token)) return reject(socket, '401 Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, options));
  });
  return wss;
}
