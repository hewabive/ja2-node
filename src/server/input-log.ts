import { gunzipSync, gzipSync } from 'node:zlib';
import type { CampaignRequest } from './campaign-factory.ts';

export const INPUT_LOG_FORMAT = 'ja2-node-input-log';
export const INPUT_LOG_VERSION = 1;
export const MAX_MERGED_REALTIME_TICKS = 100_000;
const MAX_LOG_BYTES = 512 * 1024 * 1024;

export type InputKind = 'cmd' | 'answer' | 'advance' | 'drive' | 'reseed' | 'load' | 'prepare';

export interface InputEntry {
  readonly seq: number;
  readonly tick: number;
  readonly kind: InputKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface LoadPayload {
  readonly name: string;
  readonly digest: string;
}

export type LogOrigin =
  | { readonly kind: 'sandbox'; readonly seed: number }
  | { readonly kind: 'campaign'; readonly seed: number; readonly campaign: CampaignRequest }
  | { readonly kind: 'import'; readonly seed: number; readonly save: string; readonly digest: string }
  | ({ readonly kind: 'load' } & LoadPayload)
  | { readonly kind: 'unknown' };

export const UNKNOWN_ORIGIN: LogOrigin = { kind: 'unknown' };

export interface LogSegment {
  readonly origin: LogOrigin;
  readonly entries: readonly InputEntry[];
}

interface MutableEntry {
  seq: number;
  tick: number;
  kind: InputKind;
  payload: Record<string, unknown>;
}

function realtimeTicks(entry: MutableEntry): number {
  const until = entry.payload.until as { readonly ticks?: number } | undefined;
  return until?.ticks ?? 0;
}

export function isReplayable(origin: LogOrigin): boolean {
  return origin.kind !== 'unknown';
}

export function describeOrigin(origin: LogOrigin): string {
  switch (origin.kind) {
    case 'sandbox':
      return `sandbox seed ${origin.seed}`;
    case 'campaign':
      return `new campaign seed ${origin.seed}`;
    case 'import':
      return `native save ${origin.save}`;
    case 'load':
      return `save ${origin.name}`;
    case 'unknown':
      return 'unknown';
  }
}

export class InputLog {
  readonly origin: LogOrigin;
  readonly #entries: MutableEntry[] = [];
  #mergeableRealtime: MutableEntry | null = null;

  constructor(origin: LogOrigin = UNKNOWN_ORIGIN) {
    this.origin = origin;
  }

  get length(): number {
    return this.#entries.length;
  }

  entries(): readonly InputEntry[] {
    return this.#entries;
  }

  append(kind: InputKind, tick: number, payload: Readonly<Record<string, unknown>>): InputEntry {
    const entry: MutableEntry = { seq: this.#entries.length, tick, kind, payload: { ...payload } };
    this.#entries.push(entry);
    this.#mergeableRealtime = null;
    return entry;
  }

  appendRealtime(tick: number, ticks: number): InputEntry {
    const previous = this.#mergeableRealtime;
    const previousTicks = previous ? realtimeTicks(previous) : 0;
    if (previous && previous === this.#entries.at(-1) && previousTicks + ticks <= MAX_MERGED_REALTIME_TICKS) {
      previous.payload = { ...previous.payload, until: { ticks: previousTicks + ticks } };
      this.#mergeableRealtime = null;
      return previous;
    }
    return this.append('advance', tick, { until: { ticks }, realtime: true });
  }

  realtimeBatchCompleted(entry: InputEntry): void {
    this.#mergeableRealtime = this.#entries.at(-1) === entry ? (entry as MutableEntry) : null;
  }

  segment(length = this.#entries.length): LogSegment {
    const entries = this.#entries.slice(0, length);
    let start = 0;
    let origin = this.origin;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as MutableEntry;
      if (e.kind !== 'load') continue;
      origin = { kind: 'load', name: String(e.payload.name), digest: String(e.payload.digest) };
      start = i + 1;
      break;
    }
    return { origin, entries: entries.slice(start).map((e, i) => ({ seq: i, tick: e.tick, kind: e.kind, payload: { ...e.payload } })) };
  }

  full(length = this.#entries.length): LogSegment {
    return { origin: this.origin, entries: this.#entries.slice(0, length).map((e) => ({ ...e, payload: { ...e.payload } })) };
  }
}

export function inputLogText(segment: LogSegment, save: string | null): string {
  const head = JSON.stringify({ format: INPUT_LOG_FORMAT, version: INPUT_LOG_VERSION, save, origin: segment.origin });
  return [head, ...segment.entries.map((e) => JSON.stringify(e))].join('\n').concat('\n');
}

export function encodeInputLog(text: string): Uint8Array {
  return gzipSync(Buffer.from(text, 'utf8'));
}

function parseEntry(line: string, index: number): InputEntry {
  const e = JSON.parse(line) as Partial<InputEntry>;
  if (typeof e.seq !== 'number' || typeof e.tick !== 'number' || typeof e.kind !== 'string' || typeof e.payload !== 'object')
    throw new Error(`bad input log entry at line ${index + 2}`);
  return e as InputEntry;
}

export interface DecodedInputLog extends LogSegment {
  readonly save: string | null;
}

export function decodeInputLog(bytes: Uint8Array): DecodedInputLog {
  const lines = gunzipSync(bytes, { maxOutputLength: MAX_LOG_BYTES })
    .toString('utf8')
    .split('\n')
    .filter((l) => l.length > 0);
  const head = JSON.parse(lines[0] ?? 'null') as { format?: unknown; version?: unknown; save?: unknown; origin?: unknown } | null;
  if (!head || head.format !== INPUT_LOG_FORMAT) throw new Error('not a ja2-node input log');
  if (typeof head.version !== 'number' || head.version > INPUT_LOG_VERSION)
    throw new Error(`unsupported input log version ${head.version}`);
  return {
    save: typeof head.save === 'string' ? head.save : null,
    origin: head.origin as LogOrigin,
    entries: lines.slice(1).map(parseEntry),
  };
}
