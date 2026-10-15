import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import { parseClientMessage, type ServerMessage } from '../protocol/messages.ts';
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
    if (!session) return send({ t: 'error', message: 'say hello first' });
    switch (message.t) {
      case 'cmd': {
        const r = session.dispatch(message.cmd);
        return send({ t: 'result', id: message.id, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) });
      }
      case 'advance':
        return send({ t: 'stopped', id: message.id, report: session.advance(message.until) });
      case 'drive':
        session.setDriver(message.driver);
        return send({ t: 'result', id: message.id, ok: true });
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
