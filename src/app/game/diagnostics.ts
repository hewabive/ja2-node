import { TICK_MS } from '../../protocol/messages.ts';
import type { DiagnosticLine, DiagnosticsOverlay } from '../../ui/diagnostics-overlay.ts';
import type { OpenRead } from '../assets/http-vfs-layer.ts';
import type { OpenRequests, PingReply, SessionClient } from '../net/session-client.ts';
import type { AssetReads } from './ui-hook.ts';

export const DIAGNOSTICS_WINDOW_MS = 1000;
const SLOW_FPS = 20;
const SLOW_PING_MS = 250;
const SLOW_LOOP_MS = 100;
const LAG_MS = 250;
const SLOW_REPLY_MS = 1000;
const SLOW_INPUT_MS = 250;
const RAN_AHEAD_MS = 250;
const QUEUE_LENGTH = 1;
const SLOW_READ_MS = 1000;
const SHOWN_PATH_LENGTH = 40;
const PING_LABEL = 'ping';
const MS_PER_SECOND = 1000;

export type DiagnosedClient = Pick<SessionClient, 'latestTick' | 'shownTick' | 'openRequests' | 'ping' | 'onReply'>;

export interface SlowestReply {
  readonly label: string;
  readonly ms: number;
}

export interface FrameWindow {
  readonly ms: number;
  readonly frames: number;
  readonly drawn: number;
  readonly averageMs: number;
  readonly maxMs: number;
}

export interface SessionWindow {
  readonly lagMs: number;
  readonly behindServerMs: number | null;
  readonly ping: PingReply | null;
  readonly open: OpenRequests | null;
  readonly slowest: SlowestReply | null;
}

export interface ReadsWindow {
  readonly pending: number;
  readonly oldest: OpenRead | null;
}

export interface DiagnosticsSample {
  readonly frames: FrameWindow;
  readonly session: SessionWindow | null;
  readonly reads: ReadsWindow | null;
}

const ms = (value: number) => `${Math.round(value)} ms`;

function perSecond(count: number, windowMs: number): number {
  return Math.round((count * MS_PER_SECOND) / Math.max(1, windowMs));
}

function framesLine(f: FrameWindow): DiagnosticLine {
  const fps = perSecond(f.frames, f.ms);
  const text = `${fps} FPS, ${perSecond(f.drawn, f.ms)} drawn, frame ${f.averageMs.toFixed(1)} ms (max ${f.maxMs.toFixed(1)})`;
  return { text, alarm: fps < SLOW_FPS };
}

function networkLine(s: SessionWindow): DiagnosticLine {
  if (!s.ping) return { text: 'ping: no reply yet', alarm: false };
  const loop = s.ping.health?.loopDelayMs ?? 0;
  return { text: `ping ${ms(s.ping.rttMs)}, server loop ${ms(loop)}`, alarm: s.ping.rttMs > SLOW_PING_MS || loop > SLOW_LOOP_MS };
}

function playbackLine(s: SessionWindow): DiagnosticLine {
  const behind = s.behindServerMs === null ? '?' : ms(Math.max(0, s.behindServerMs));
  return { text: `playback lag ${ms(s.lagMs)}, behind server ${behind}`, alarm: s.lagMs > LAG_MS || (s.behindServerMs ?? 0) > LAG_MS };
}

function requestsLine(s: SessionWindow): DiagnosticLine {
  const waiting = s.open ? `waiting ${s.open.oldest} ${ms(s.open.ageMs)} (${s.open.count} open)` : 'waiting for nothing';
  const slowest = s.slowest ? `, slowest reply ${s.slowest.label} ${ms(s.slowest.ms)}` : '';
  return { text: `${waiting}${slowest}`, alarm: (s.open?.ageMs ?? 0) > SLOW_REPLY_MS || (s.slowest?.ms ?? 0) > SLOW_REPLY_MS };
}

function serverLine(s: SessionWindow): DiagnosticLine | null {
  const health = s.ping?.health;
  if (!health) return null;
  const last = health.last;
  if (!last) return { text: `server queue ${health.pending}, no input yet`, alarm: health.pending > QUEUE_LENGTH };
  const ahead = last.ticks * TICK_MS;
  return {
    text: `server queue ${health.pending}, last ${last.label}: waited ${ms(last.waitedMs)}, ran ${ms(last.ranMs)}, game time +${ms(ahead)}`,
    alarm: health.pending > QUEUE_LENGTH || last.waitedMs + last.ranMs > SLOW_INPUT_MS || ahead > RAN_AHEAD_MS,
  };
}

function shortPath(path: string): string {
  return path.length > SHOWN_PATH_LENGTH ? `...${path.slice(-SHOWN_PATH_LENGTH)}` : path;
}

function readsLine(r: ReadsWindow): DiagnosticLine {
  if (!r.oldest) return { text: 'reads: none open', alarm: false };
  return {
    text: `reads ${r.pending} open, oldest ${ms(r.oldest.ageMs)}: ${shortPath(r.oldest.path)}`,
    alarm: r.oldest.ageMs > SLOW_READ_MS,
  };
}

export function diagnosticLines(sample: DiagnosticsSample): DiagnosticLine[] {
  const s = sample.session;
  const session = s ? [networkLine(s), playbackLine(s), requestsLine(s), serverLine(s)] : [{ text: 'no game session', alarm: false }];
  const reads = sample.reads ? [readsLine(sample.reads)] : [];
  return [framesLine(sample.frames), ...session, ...reads].filter((line): line is DiagnosticLine => line !== null);
}

export interface DiagnosticsSources {
  overlay(): DiagnosticsOverlay | null;
  client(): DiagnosedClient | null;
  reads(): AssetReads | null;
  drawnFrames(): number;
}

export class DiagnosticsSampler {
  readonly #sources: DiagnosticsSources;
  readonly #noteReply = (label: string, replyMs: number) => this.#note(label, replyMs);
  #client: DiagnosedClient | null = null;
  #windowStart: number | null = null;
  #frames = 0;
  #frameMs = 0;
  #maxFrameMs = 0;
  #drawnAtStart = 0;
  #slowest: SlowestReply | null = null;
  #ping: PingReply | null = null;
  #behindServerMs: number | null = null;
  #pinging = false;

  constructor(sources: DiagnosticsSources) {
    this.#sources = sources;
  }

  frame(now: number, frameMs: number): void {
    const overlay = this.#sources.overlay();
    if (!overlay?.enabled) {
      this.#windowStart = null;
      return;
    }
    this.#follow(this.#sources.client());
    const start = this.#windowStart ?? this.#begin(now);
    this.#frames++;
    this.#frameMs += frameMs;
    this.#maxFrameMs = Math.max(this.#maxFrameMs, frameMs);
    if (now - start < DIAGNOSTICS_WINDOW_MS) return;
    overlay.show(diagnosticLines(this.#sample(now - start)));
    this.#begin(now);
  }

  #follow(client: DiagnosedClient | null): void {
    if (client === this.#client) return;
    if (this.#client?.onReply === this.#noteReply) this.#client.onReply = null;
    this.#client = client;
    this.#ping = null;
    this.#behindServerMs = null;
    this.#pinging = false;
    if (client) client.onReply = this.#noteReply;
  }

  #note(label: string, replyMs: number): void {
    if (label === PING_LABEL || replyMs <= (this.#slowest?.ms ?? -1)) return;
    this.#slowest = { label, ms: replyMs };
  }

  #begin(now: number): number {
    this.#windowStart = now;
    this.#frames = 0;
    this.#frameMs = 0;
    this.#maxFrameMs = 0;
    this.#drawnAtStart = this.#sources.drawnFrames();
    this.#slowest = null;
    this.#sendPing();
    return now;
  }

  #sendPing(): void {
    const client = this.#client;
    if (!client || this.#pinging) return;
    this.#pinging = true;
    client.ping().then(
      (reply) => {
        if (client !== this.#client) return;
        this.#pinging = false;
        this.#ping = reply;
        this.#behindServerMs = reply.health ? (reply.health.tick - client.shownTick) * TICK_MS : null;
      },
      () => {
        if (client !== this.#client) return;
        this.#pinging = false;
        this.#ping = null;
      },
    );
  }

  #sample(windowMs: number): DiagnosticsSample {
    const client = this.#client;
    const reads = this.#sources.reads();
    const frames: FrameWindow = {
      ms: windowMs,
      frames: this.#frames,
      drawn: this.#sources.drawnFrames() - this.#drawnAtStart,
      averageMs: this.#frameMs / Math.max(1, this.#frames),
      maxMs: this.#maxFrameMs,
    };
    const session: SessionWindow | null = client
      ? {
          lagMs: Math.max(0, client.latestTick - client.shownTick) * TICK_MS,
          behindServerMs: this.#behindServerMs,
          ping: this.#ping,
          open: client.openRequests(),
          slowest: this.#slowest,
        }
      : null;
    return { frames, session, reads: reads ? { pending: reads.pendingReads, oldest: reads.oldestRead() } : null };
  }
}
