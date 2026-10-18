import { type DataVersion, STUB_DATA_VERSION, type UiLanguage } from '../content/text/data-version.ts';
import type { CommandEnvelope, DriverMode, ServerMessage, SessionStopReport } from '../protocol/messages.ts';
import { diffPlayerView, type PlayerView, type ViewFrame } from '../protocol/view.ts';
import { advance, type Steppable, type StopCondition, type StopReport } from '../sim/advance.ts';
import { TICK_MS } from '../sim/clock.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import { type InputEntry, InputLog, type LoadPayload, type LogOrigin, UNKNOWN_ORIGIN } from './input-log.ts';

export const FRAME_TICKS = 10;
const REALTIME_INTERVAL_MS = 16;
const MAX_FRAMES_PER_MESSAGE = 500;
const LOADED_STOP_ID = 0;

export type { CommandResult };

export interface SessionSim extends Steppable {
  dispatch(cmd: CommandEnvelope): CommandResult;
  view(): PlayerView;
  prepare?(cmd: CommandEnvelope): Promise<void>;
  preparedMaps?(): readonly string[];
  prepareMaps?(paths: readonly string[]): Promise<void>;
}

export type Listener = (message: ServerMessage) => void;

export interface SessionText {
  readonly language: UiLanguage;
  readonly dataVersion: DataVersion;
}

export interface SessionHooks {
  beforeDispatch?(session: Session, cmd: CommandEnvelope): void;
  afterDispatch?(session: Session, cmd: CommandEnvelope, result: CommandResult): void;
  beforeAdvance?(session: Session): void;
  afterAdvance?(session: Session, report: StopReport): void;
  afterInput?(session: Session): void;
  failed?(session: Session, error: unknown): void;
}

export type SessionEvent =
  | { readonly type: 'gameSaved'; readonly tick: number; readonly name: string; readonly kind: string }
  | { readonly type: 'gameLoaded'; readonly tick: number; readonly name: string; readonly seed: number | null };

export const DEFAULT_SESSION_TEXT: SessionText = { language: 'eng', dataVersion: STUB_DATA_VERSION };

export class Session {
  readonly id: string;
  readonly dataVersion: DataVersion;
  readonly log: InputLog;
  language: UiLanguage;
  hooks: SessionHooks | null = null;
  #sim: SessionSim;
  #driver: DriverMode = { mode: 'manual' };
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastRealtime = 0;
  #carryMs = 0;
  #lastView: PlayerView;
  #depth = 0;
  readonly #held: SimEvent[] = [];
  readonly #listeners = new Set<Listener>();

  constructor(id: string, sim: SessionSim, text: SessionText = DEFAULT_SESSION_TEXT, origin: LogOrigin = UNKNOWN_ORIGIN) {
    this.id = id;
    this.#sim = sim;
    this.dataVersion = text.dataVersion;
    this.language = text.language;
    this.log = new InputLog(origin);
    this.#lastView = sim.view();
  }

  get sim(): SessionSim {
    return this.#sim;
  }

  get driver(): DriverMode {
    return this.#driver;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#welcome());
    return () => this.#listeners.delete(listener);
  }

  #welcome(): ServerMessage {
    return { t: 'welcome', session: this.id, view: this.#sim.view(), driver: this.#driver };
  }

  #broadcast(message: ServerMessage): void {
    for (const l of this.#listeners) l(message);
  }

  #publish(frames: ViewFrame[]): void {
    for (let i = 0; i < frames.length; i += MAX_FRAMES_PER_MESSAGE)
      this.#broadcast({ t: 'frames', frames: frames.slice(i, i + MAX_FRAMES_PER_MESSAGE) });
  }

  holdEvents(): void {
    this.#held.push(...this.#sim.drainEvents());
  }

  notify(event: SessionEvent): void {
    this.#held.push(event as unknown as SimEvent);
  }

  #recordingStepper(frames: ViewFrame[]): Steppable {
    const sim = this.#sim;
    const held = this.#held;
    return {
      get tick() {
        return sim.tick;
      },
      get worldClock() {
        return sim.worldClock ?? null;
      },
      isIdle: () => sim.isIdle(),
      hasPendingDecision: () => sim.hasPendingDecision(),
      ended: () => sim.ended?.() ?? false,
      drainEvents: () => [...held.splice(0), ...sim.drainEvents()],
      step: () => {
        sim.step();
        if (sim.tick % FRAME_TICKS === 0) this.#capture(frames);
      },
    };
  }

  #capture(frames: ViewFrame[]): void {
    const view = this.#sim.view();
    const frame = diffPlayerView(this.#lastView, view);
    this.#lastView = view;
    if (frame) frames.push(frame);
  }

  #input<T>(work: () => T): T {
    this.#depth++;
    let failed = false;
    try {
      return work();
    } catch (err) {
      failed = true;
      if (this.#depth === 1) this.hooks?.failed?.(this, err);
      throw err;
    } finally {
      this.#depth--;
      if (this.#depth === 0 && !failed) this.hooks?.afterInput?.(this);
    }
  }

  async prepareAndDispatch(cmd: CommandEnvelope): Promise<CommandResult> {
    const before = new Set(this.#sim.preparedMaps?.() ?? []);
    await this.#sim.prepare?.(cmd);
    const maps = (this.#sim.preparedMaps?.() ?? []).filter((path) => !before.has(path));
    if (maps.length > 0) this.log.append('prepare', this.#sim.tick, { maps });
    return this.dispatch(cmd);
  }

  async prepareMaps(maps: readonly string[]): Promise<void> {
    if (maps.length === 0) return;
    this.log.append('prepare', this.#sim.tick, { maps });
    await this.#sim.prepareMaps?.(maps);
  }

  dispatch(cmd: CommandEnvelope): CommandResult {
    return this.#input(() => {
      this.hooks?.beforeDispatch?.(this, cmd);
      this.log.append(cmd.type === 'answer' ? 'answer' : 'cmd', this.#sim.tick, { cmd });
      const result = this.#sim.dispatch(cmd);
      this.hooks?.afterDispatch?.(this, cmd, result);
      const frames: ViewFrame[] = [];
      this.#capture(frames);
      this.#publish(frames);
      if (result.ok && this.#driver.mode === 'instant') this.advance({ idle: true });
      return result;
    });
  }

  advance(until: StopCondition, budget?: number): StopReport {
    return this.#input(() => {
      this.log.append('advance', this.#sim.tick, { until, ...(budget !== undefined ? { budget } : {}) });
      return this.#advance(until, budget);
    });
  }

  #advance(until: StopCondition, budget?: number): StopReport {
    this.hooks?.beforeAdvance?.(this);
    const frames: ViewFrame[] = [];
    const report = advance(this.#recordingStepper(frames), until, budget);
    this.#capture(frames);
    this.#publish(frames);
    this.hooks?.afterAdvance?.(this, report);
    return report;
  }

  reseed(seed: number, apply: () => void): void {
    this.log.append('reseed', this.#sim.tick, { seed });
    apply();
  }

  setDriver(driver: DriverMode, now: () => number = () => performance.now()): void {
    this.log.append('drive', this.#sim.tick, { driver });
    this.#driver = driver;
    this.#stopTimer();
    if (driver.mode === 'realtime') {
      this.#lastRealtime = now();
      this.#carryMs = 0;
      this.#timer = setInterval(() => this.runRealtime(now()), REALTIME_INTERVAL_MS);
    }
    if (driver.mode === 'instant') this.advance({ idle: true });
  }

  #stopTimer(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  runRealtime(at: number): void {
    if (this.#driver.mode !== 'realtime') return;
    this.#carryMs += (at - this.#lastRealtime) * this.#driver.speed;
    this.#lastRealtime = at;
    const ticks = Math.floor(this.#carryMs / TICK_MS);
    if (ticks <= 0) return;
    this.#carryMs -= ticks * TICK_MS;
    const report = this.#input(() => {
      const entry: InputEntry = this.log.appendRealtime(this.#sim.tick, ticks);
      const stopped = this.#advance({ ticks });
      if (stopped.reason === 'ticks') this.log.realtimeBatchCompleted(entry);
      return stopped;
    });
    if (report.reason === 'decision') this.setDriver({ mode: 'manual' });
  }

  replace(sim: SessionSim, loaded: LoadPayload): void {
    const wasRunning = this.#driver.mode === 'realtime';
    this.#stopTimer();
    this.#driver = { mode: 'manual' };
    this.log.append('load', this.#sim.tick, { ...loaded });
    this.#held.length = 0;
    this.#sim = sim;
    this.#lastView = sim.view();
    if (wasRunning) this.#broadcast({ t: 'stopped', id: LOADED_STOP_ID, report: this.#loadedStop() });
    this.#broadcast(this.#welcome());
  }

  #loadedStop(): SessionStopReport {
    return { tick: this.#sim.tick, reason: 'loaded', events: [] };
  }

  close(): void {
    this.#stopTimer();
    this.#listeners.clear();
  }
}
