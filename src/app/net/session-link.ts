import type { ClientMessage, ServerMessage, SessionCloseReason, WelcomeMessage } from '../../protocol/messages.ts';
import type { SessionConnection, SessionEndReason } from '../../ui/client/front-end-client.ts';

export type OpenSocket = () => WebSocket;

export interface LinkListener {
  message(message: ServerMessage): void;
  connection(connection: SessionConnection): void;
}

export interface LinkOptions {
  readonly open?: OpenSocket;
  readonly now?: () => number;
}

type LinkState = 'connecting' | 'open' | 'reconnecting' | 'ended' | 'closed';

export const RECONNECT_DELAYS_MS = [0, 500, 1000, 2000, 5000] as const;
export const HEARTBEAT_MS = 5000;
export const SILENT_SERVER_MS = 20_000;
export const HEARTBEAT_ID = 0;
const CANNOT_CONNECT = 'cannot connect to the game server';

function openGameSocket(): WebSocket {
  return new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
}

const CLOSED_AS: Readonly<Record<SessionCloseReason, string>> = { closed: 'closed', lost: 'lost', shutdown: 'stopped' };

function closedSessionError(session: string, reason: SessionCloseReason): Error {
  return new Error(`session ${session} is ${CLOSED_AS[reason]}`);
}

export class SessionLink {
  readonly #listener: LinkListener;
  readonly #open: OpenSocket;
  readonly #now: () => number;
  #session: string | undefined;
  #instance: string | null = null;
  #state: LinkState = 'connecting';
  #socket: WebSocket | null = null;
  #attempt = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #heardAt = 0;
  #probedAt: number | null = null;
  #started: { readonly resolve: () => void; readonly reject: (error: Error) => void } | null = null;

  constructor(session: string | undefined, listener: LinkListener, options: LinkOptions = {}) {
    this.#session = session;
    this.#listener = listener;
    this.#open = options.open ?? openGameSocket;
    this.#now = options.now ?? (() => performance.now());
  }

  get open(): boolean {
    return this.#state === 'open';
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#started = { resolve, reject };
      this.#dial();
    });
  }

  send(message: ClientMessage): boolean {
    if (this.#state !== 'open' || !this.#socket) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.#state = 'closed';
    this.#stop();
  }

  #dial(): void {
    const socket = this.#open();
    this.#socket = socket;
    const current = () => this.#socket === socket;
    socket.addEventListener('open', () => {
      if (current()) socket.send(JSON.stringify(this.#hello()));
    });
    socket.addEventListener('message', (e) => {
      if (current()) this.#receive(JSON.parse(String(e.data)) as ServerMessage);
    });
    socket.addEventListener('close', () => {
      if (current()) this.#dropped();
    });
  }

  #hello(): ClientMessage {
    return { t: 'hello', ...(this.#session ? { session: this.#session } : {}) };
  }

  #receive(message: ServerMessage): void {
    this.#heardAt = this.#now();
    if (this.#state === 'open') this.#receiveOpen(message);
    else if (this.#state === 'connecting' || this.#state === 'reconnecting') this.#receiveGreeting(message);
  }

  #receiveGreeting(message: ServerMessage): void {
    if (message.t === 'welcome') this.#greeted(message);
    else if (message.t === 'closed') this.#refused(closedSessionError(message.session, message.reason), message.reason);
    else if (message.t === 'error') this.#refused(new Error(message.message), 'gone');
  }

  #receiveOpen(message: ServerMessage): void {
    if (message.t === 'pong' && message.id === HEARTBEAT_ID) return;
    if (message.t === 'closed') this.#end(message.reason);
    else this.#listener.message(message);
  }

  #greeted(welcome: WelcomeMessage): void {
    const reconnected = this.#state === 'reconnecting';
    if (reconnected && welcome.instance !== this.#instance) {
      this.#end('gone');
      return;
    }
    this.#state = 'open';
    this.#attempt = 0;
    this.#session = welcome.session;
    this.#instance = welcome.instance;
    this.#probedAt = null;
    this.#heartbeat = setInterval(() => this.#beat(), HEARTBEAT_MS);
    this.#listener.message(welcome);
    if (reconnected) this.#listener.connection({ state: 'open' });
    this.#started?.resolve();
    this.#started = null;
  }

  #refused(error: Error, reason: SessionEndReason): void {
    if (this.#state === 'reconnecting') this.#end(reason);
    else this.#fail(error);
  }

  #dropped(): void {
    if (this.#state === 'connecting') this.#fail(new Error(CANNOT_CONNECT));
    else if (this.#state === 'open') this.#lose();
    else if (this.#state === 'reconnecting') this.#scheduleRetry();
  }

  #fail(error: Error): void {
    this.#state = 'closed';
    this.#stop();
    this.#started?.reject(error);
    this.#started = null;
  }

  #lose(): void {
    this.#state = 'reconnecting';
    this.#stop();
    this.#listener.connection({ state: 'reconnecting' });
    this.#scheduleRetry();
  }

  #end(reason: SessionEndReason): void {
    this.#state = 'ended';
    this.#stop();
    this.#listener.connection({ state: 'ended', reason });
  }

  #scheduleRetry(): void {
    const delay = RECONNECT_DELAYS_MS[Math.min(this.#attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.#attempt++;
    this.#retry = setTimeout(() => {
      this.#retry = null;
      if (this.#state === 'reconnecting') this.#dial();
    }, delay);
  }

  #beat(): void {
    if (this.#state !== 'open') return;
    const now = this.#now();
    const probedAt = this.#probedAt;
    const probing = probedAt !== null && this.#heardAt < probedAt;
    if (probing && now - probedAt >= SILENT_SERVER_MS) this.#lose();
    else if (!probing && now - this.#heardAt >= HEARTBEAT_MS) this.#probe(now);
  }

  #probe(now: number): void {
    this.#probedAt = now;
    this.send({ t: 'ping', id: HEARTBEAT_ID });
  }

  #stop(): void {
    if (this.#heartbeat !== null) clearInterval(this.#heartbeat);
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#heartbeat = null;
    this.#retry = null;
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
  }
}
