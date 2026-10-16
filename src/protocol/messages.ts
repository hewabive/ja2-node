import type { StopCondition, StopReport } from '../sim/advance.ts';

export { TICK_MS } from '../sim/clock.ts';

import type { PlayerView, ViewFrame } from './view.ts';

export type { StopCondition, StopReport };

export type DriverMode = { readonly mode: 'manual' } | { readonly mode: 'instant' } | { readonly mode: 'realtime'; readonly speed: number };

export interface CommandEnvelope {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type ClientMessage =
  | { readonly t: 'hello'; readonly session?: string }
  | { readonly t: 'cmd'; readonly id: number; readonly cmd: CommandEnvelope }
  | { readonly t: 'advance'; readonly id: number; readonly until: StopCondition }
  | { readonly t: 'drive'; readonly id: number; readonly driver: DriverMode };

export type ServerMessage =
  | { readonly t: 'welcome'; readonly session: string; readonly view: PlayerView; readonly driver: DriverMode }
  | { readonly t: 'frames'; readonly frames: readonly ViewFrame[] }
  | { readonly t: 'result'; readonly id: number; readonly ok: boolean; readonly reason?: string; readonly data?: unknown }
  | { readonly t: 'stopped'; readonly id: number; readonly report: StopReport }
  | { readonly t: 'error'; readonly message: string };

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
    case 'advance':
      return typeof m.id === 'number' && typeof m.until === 'object' && m.until !== null ? (m as ClientMessage) : null;
    case 'drive': {
      const d = m.driver as { mode?: unknown; speed?: unknown } | undefined;
      const valid =
        d?.mode === 'manual' ||
        d?.mode === 'instant' ||
        (d?.mode === 'realtime' && typeof d.speed === 'number' && d.speed > 0 && d.speed <= 64);
      return typeof m.id === 'number' && valid ? (m as ClientMessage) : null;
    }
    default:
      return null;
  }
}
