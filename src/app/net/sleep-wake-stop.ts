import type { SessionStopReport, StopCondition } from '../../protocol/messages.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import type { Labels } from '../../ui/text/labels.ts';
import { fetchLabels } from '../launcher/labels.ts';
import { loadSettings } from '../settings.ts';
import { type SleepWakeNotice, sleepWakeNotice, sleepWakeStop } from '../sleep-wake.ts';
import type { SessionClient } from './session-client.ts';

export interface SleepWakeHook {
  notices: number;
  last: string | null;
}

declare global {
  interface Window {
    __ja2SleepWake: SleepWakeHook;
  }
}

export interface SleepWakeAdvance {
  readonly report: SessionStopReport | null;
  readonly notice: string | null;
}

const MANUAL = { mode: 'manual' } as const;
const MAX_QUIET_RESTARTS = 50;
const ADVANCE_STOP_EVENTS: ReadonlySet<string> = new Set(['compressionStopped', 'meanwhileEnded', 'endgameDeferred']);

export class SleepWakeStop {
  readonly hook: SleepWakeHook = { notices: 0, last: null };
  readonly #client: () => SessionClient | null;
  readonly #show: (text: string) => void;
  #labels: Labels | null = null;

  constructor(client: () => SessionClient | null, show: (text: string) => void) {
    this.#client = client;
    this.#show = show;
    window.__ja2SleepWake = this.hook;
    void fetchLabels(loadSettings().language).then((labels) => {
      this.#labels = labels;
    });
  }

  #notice(events: NonNullable<ViewFrame['events']>): SleepWakeNotice | null {
    return sleepWakeNotice(events, this.#client()?.strategic?.mercs ?? [], loadSettings());
  }

  #names(ids: readonly number[]): string {
    const mercs = this.#client()?.strategic?.mercs ?? [];
    return ids.map((id) => mercs.find((m) => m.id === id)?.name ?? `#${id}`).join(', ');
  }

  #text(notice: SleepWakeNotice): string {
    const lines: string[] = [];
    if (notice.asleep.length > 0) lines.push(`${this.#labels?.text('mercsAsleep') ?? 'fellAsleep'} ${this.#names(notice.asleep)}`);
    if (notice.awake.length > 0) lines.push(`${this.#labels?.text('mercsAwake') ?? 'wokeUp'} ${this.#names(notice.awake)}`);
    return lines.join('\n');
  }

  #record(notice: SleepWakeNotice): string {
    const text = this.#text(notice);
    this.hook.notices++;
    this.hook.last = text;
    return text;
  }

  frames(frames: readonly ViewFrame[]): void {
    const client = this.#client();
    if (client?.driver.mode !== 'realtime') return;
    const notice = this.#notice(frames.flatMap((f) => f.events ?? []));
    if (!notice) return;
    void client.drive(MANUAL);
    this.#show(this.#record(notice));
  }

  async plain(pending: Promise<SessionStopReport | null> | undefined): Promise<SleepWakeAdvance> {
    return { report: (await pending) ?? null, notice: null };
  }

  async advance(until: StopCondition): Promise<SleepWakeAdvance> {
    const client = this.#client();
    if (!client) return { report: null, notice: null };
    const watched = sleepWakeStop(until, loadSettings());
    for (let restart = 0; ; restart++) {
      const report = await client.advance(watched);
      if (report?.reason !== 'event' || watched === until) return { report, notice: null };
      const notice = this.#notice(report.events);
      if (notice) return { report, notice: this.#record(notice) };
      const ownStop = report.events.some((e) => ADVANCE_STOP_EVENTS.has(e.type) || until.events?.includes(e.type));
      if (ownStop || restart >= MAX_QUIET_RESTARTS) return { report, notice: null };
    }
  }
}
