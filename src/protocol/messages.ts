import type { StopCondition, StopReport } from '../sim/advance.ts';
import type { SimEventType } from '../sim/events.ts';

export { TICK_MS } from '../sim/clock.ts';

import type { MessageEntry } from './message-log.ts';
import type { PlayerView, ViewFrame } from './view.ts';

export type { StopCondition, StopReport };

export type SessionStopReason = StopReport['reason'] | 'loaded';

export type SessionCloseReason = 'closed' | 'lost' | 'shutdown';

export interface SessionAdvanceReport extends StopReport {
  readonly messages: readonly MessageEntry[];
}

export interface SessionStopReport extends Omit<StopReport, 'reason'> {
  readonly reason: SessionStopReason;
  readonly messages?: readonly MessageEntry[];
}

export type DriverMode =
  | { readonly mode: 'manual' }
  | { readonly mode: 'instant' }
  | { readonly mode: 'realtime'; readonly speed: number; readonly pauseOn?: readonly SimEventType[] };

export interface CommandEnvelope {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type ClientMessage =
  | { readonly t: 'hello'; readonly session?: string }
  | { readonly t: 'cmd'; readonly id: number; readonly cmd: CommandEnvelope }
  | { readonly t: 'query'; readonly id: number; readonly q: CommandEnvelope }
  | { readonly t: 'advance'; readonly id: number; readonly until: StopCondition }
  | { readonly t: 'drive'; readonly id: number; readonly driver: DriverMode }
  | { readonly t: 'save'; readonly id: number; readonly name?: string; readonly description?: string }
  | { readonly t: 'load'; readonly id: number; readonly name: string; readonly reseed?: boolean }
  | { readonly t: 'closeSession'; readonly id: number }
  | { readonly t: 'leave'; readonly id: number }
  | { readonly t: 'ping'; readonly id: number };

export interface InputTimingView {
  readonly label: string;
  readonly waitedMs: number;
  readonly ranMs: number;
  readonly ticks: number;
}

export interface SessionHealthView {
  readonly tick: number;
  readonly pending: number;
  readonly last: InputTimingView | null;
  readonly loopDelayMs: number;
}

export interface EngineIdentityView {
  readonly version: string;
  readonly commit: string;
}

export interface RulePackIdentityView {
  readonly pack: string;
  readonly scripts: string;
}

export interface WelcomeIdentity {
  readonly engine: EngineIdentityView;
  readonly rules: RulePackIdentityView;
}

export const UNKNOWN_IDENTITY: WelcomeIdentity = {
  engine: { version: 'unknown', commit: 'unknown' },
  rules: { pack: 'unknown', scripts: 'unknown' },
};

export interface WelcomeMessage extends WelcomeIdentity {
  readonly t: 'welcome';
  readonly session: string;
  readonly instance: string;
  readonly view: PlayerView;
  readonly driver: DriverMode;
  readonly messages: readonly MessageEntry[];
  readonly campaign?: string;
}

export interface AnswerMessage {
  readonly t: 'answer';
  readonly id: number;
  readonly ok: boolean;
  readonly tick: number;
  readonly reason?: string;
  readonly data?: unknown;
}

export type ServerMessage =
  | WelcomeMessage
  | { readonly t: 'frames'; readonly frames: readonly ViewFrame[] }
  | { readonly t: 'result'; readonly id: number; readonly ok: boolean; readonly reason?: string; readonly data?: unknown }
  | AnswerMessage
  | { readonly t: 'stopped'; readonly id: number; readonly report: SessionStopReport }
  | { readonly t: 'pong'; readonly id: number; readonly health?: SessionHealthView }
  | { readonly t: 'closed'; readonly session: string; readonly reason: SessionCloseReason }
  | { readonly t: 'error'; readonly id?: number; readonly message: string };

export function parseClientMessage(text: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return m.session === undefined || typeof m.session === 'string' ? (m as ClientMessage) : null;
    case 'cmd':
      return typeof m.id === 'number' &&
        typeof m.cmd === 'object' &&
        m.cmd !== null &&
        typeof (m.cmd as { type?: unknown }).type === 'string'
        ? (m as ClientMessage)
        : null;
    case 'query':
      return typeof m.id === 'number' && typeof m.q === 'object' && m.q !== null && typeof (m.q as { type?: unknown }).type === 'string'
        ? (m as ClientMessage)
        : null;
    case 'advance':
      return typeof m.id === 'number' && typeof m.until === 'object' && m.until !== null ? (m as ClientMessage) : null;
    case 'drive': {
      const d = m.driver as { mode?: unknown; speed?: unknown; pauseOn?: unknown } | undefined;
      const valid =
        d?.mode === 'manual' ||
        d?.mode === 'instant' ||
        (d?.mode === 'realtime' && typeof d.speed === 'number' && d.speed > 0 && d.speed <= 64 && validPauseOn(d.pauseOn));
      return typeof m.id === 'number' && valid ? (m as ClientMessage) : null;
    }
    case 'save':
      return typeof m.id === 'number' && optionalString(m.name) && optionalString(m.description) ? (m as ClientMessage) : null;
    case 'load':
      return typeof m.id === 'number' && typeof m.name === 'string' && (m.reseed === undefined || typeof m.reseed === 'boolean')
        ? (m as ClientMessage)
        : null;
    case 'closeSession':
    case 'leave':
    case 'ping':
      return typeof m.id === 'number' ? (m as ClientMessage) : null;
    default:
      return null;
  }
}

const MAX_PAUSE_EVENTS = 64;

function validPauseOn(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length <= MAX_PAUSE_EVENTS && value.every((e) => typeof e === 'string'));
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}
