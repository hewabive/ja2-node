import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import { parseClientMessage, type ServerMessage } from '../protocol/messages.ts';
import { loadProblemOf, type SaveService } from './save-service.ts';
import type { Session } from './session.ts';

const MAX_MESSAGE_BYTES = 1 << 20;
const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export interface UpgradeServer {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

export interface WebSocketOptions {
  readonly token: string;
  readonly sessions: ReadonlyMap<string, Session>;
  readonly defaultSession: string;
  readonly allowedHosts?: readonly string[];
  readonly saves?: SaveService;
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

function serve(ws: WebSocket, options: WebSocketOptions): void {
  let unsubscribe: (() => void) | null = null;
  let session: Session | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  const inOrder = (work: () => unknown) => {
    pending = pending.then(work);
  };
  const send = (m: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  ws.on('message', (data) => {
    const message = parseClientMessage(data.toString());
    if (!message) return send({ t: 'error', message: 'malformed message' });
    if (message.t === 'hello') {
      unsubscribe?.();
      session = options.sessions.get(message.session ?? options.defaultSession) ?? null;
      if (!session) return send({ t: 'error', message: 'no such session' });
      unsubscribe = session.subscribe(send);
      return;
    }
    const current = session;
    if (!current) return send({ t: 'error', message: 'say hello first' });
    switch (message.t) {
      case 'cmd':
        return inOrder(async () => {
          const r = await current.prepareAndDispatch(message.cmd);
          send({
            t: 'result',
            id: message.id,
            ok: r.ok,
            ...(r.reason ? { reason: r.reason } : {}),
            ...(r.data !== undefined ? { data: r.data } : {}),
          });
        });
      case 'advance':
        return inOrder(() => send({ t: 'stopped', id: message.id, report: current.advance(message.until) }));
      case 'drive':
        return inOrder(() => {
          current.setDriver(message.driver);
          send({ t: 'result', id: message.id, ok: true });
        });
      case 'save':
        return inOrder(async () => {
          const saves = options.saves;
          if (!saves) return send({ t: 'result', id: message.id, ok: false, reason: 'saves are not available' });
          const outcome = await saves.save(current, { name: message.name, description: message.description });
          send({ t: 'result', id: message.id, ok: outcome.ok, ...(outcome.ok ? {} : { reason: outcome.refused }), data: outcome });
        });
      case 'load':
        return inOrder(async () => {
          const saves = options.saves;
          if (!saves) return send({ t: 'result', id: message.id, ok: false, reason: 'saves are not available' });
          try {
            const outcome = await saves.loadInto(current, message.name, message.reseed ?? true);
            send({ t: 'result', id: message.id, ok: true, data: outcome });
          } catch (err) {
            const refused = loadProblemOf(err);
            send({ t: 'result', id: message.id, ok: false, reason: refused, data: { refused, reason: (err as Error).message } });
          }
        });
    }
  });
  ws.on('close', () => unsubscribe?.());
}

export function attachWebSocket(server: UpgradeServer, options: WebSocketOptions): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
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
