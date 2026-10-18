import { type DataVersion, STUB_DATA_VERSION, type UiLanguage } from '../content/text/data-version.ts';
import type { CommandEnvelope, DriverMode, ServerMessage } from '../protocol/messages.ts';
import { diffPlayerView, type PlayerView, type ViewFrame } from '../protocol/view.ts';
import { advance, type Steppable, type StopCondition, type StopReport } from '../sim/advance.ts';
import { TICK_MS } from '../sim/clock.ts';
import type { CommandResult } from '../sim/command.ts';

export const FRAME_TICKS = 10;
const REALTIME_INTERVAL_MS = 16;
const MAX_FRAMES_PER_MESSAGE = 500;

export type { CommandResult };

export interface SessionSim extends Steppable {
  dispatch(cmd: CommandEnvelope): CommandResult;
  view(): PlayerView;
  prepare?(cmd: CommandEnvelope): Promise<void>;
}

export type Listener = (message: ServerMessage) => void;

export interface SessionText {
  readonly language: UiLanguage;
  readonly dataVersion: DataVersion;
}

export const DEFAULT_SESSION_TEXT: SessionText = { language: 'eng', dataVersion: STUB_DATA_VERSION };

export class Session {
  readonly id: string;
  readonly sim: SessionSim;
  readonly dataVersion: DataVersion;
  language: UiLanguage;
  #driver: DriverMode = { mode: 'manual' };
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastRealtime = 0;
  #carryMs = 0;
  #lastView: PlayerView;
  readonly #listeners = new Set<Listener>();

  constructor(id: string, sim: SessionSim, text: SessionText = DEFAULT_SESSION_TEXT) {
    this.id = id;
    this.sim = sim;
    this.dataVersion = text.dataVersion;
    this.language = text.language;
    this.#lastView = sim.view();
  }

  get driver(): DriverMode {
    return this.#driver;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener({ t: 'welcome', session: this.id, view: this.sim.view(), driver: this.#driver });
    return () => this.#listeners.delete(listener);
  }

  #broadcast(message: ServerMessage): void {
    for (const l of this.#listeners) l(message);
  }

  #publish(frames: ViewFrame[]): void {
    for (let i = 0; i < frames.length; i += MAX_FRAMES_PER_MESSAGE)
      this.#broadcast({ t: 'frames', frames: frames.slice(i, i + MAX_FRAMES_PER_MESSAGE) });
  }

  #recordingStepper(frames: ViewFrame[]): Steppable {
    const sim = this.sim;
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
      drainEvents: () => sim.drainEvents(),
      step: () => {
        sim.step();
        if (sim.tick % FRAME_TICKS === 0) this.#capture(frames);
      },
    };
  }

  #capture(frames: ViewFrame[]): void {
    const view = this.sim.view();
    const frame = diffPlayerView(this.#lastView, view);
    this.#lastView = view;
    if (frame) frames.push(frame);
  }

  async prepareAndDispatch(cmd: CommandEnvelope): Promise<CommandResult> {
    await this.sim.prepare?.(cmd);
    return this.dispatch(cmd);
  }

  dispatch(cmd: CommandEnvelope): CommandResult {
    const result = this.sim.dispatch(cmd);
    const frames: ViewFrame[] = [];
    this.#capture(frames);
    this.#publish(frames);
    if (result.ok && this.#driver.mode === 'instant') this.advance({ idle: true });
    return result;
  }

  advance(until: StopCondition, budget?: number): StopReport {
    const frames: ViewFrame[] = [];
    const report = advance(this.#recordingStepper(frames), until, budget);
    this.#capture(frames);
    this.#publish(frames);
    return report;
  }

  setDriver(driver: DriverMode, now: () => number = () => performance.now()): void {
    this.#driver = driver;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (driver.mode === 'realtime') {
      this.#lastRealtime = now();
      this.#carryMs = 0;
      this.#timer = setInterval(() => this.runRealtime(now()), REALTIME_INTERVAL_MS);
    }
    if (driver.mode === 'instant') this.advance({ idle: true });
  }

  runRealtime(at: number): void {
    if (this.#driver.mode !== 'realtime') return;
    this.#carryMs += (at - this.#lastRealtime) * this.#driver.speed;
    this.#lastRealtime = at;
    const ticks = Math.floor(this.#carryMs / TICK_MS);
    if (ticks <= 0) return;
    this.#carryMs -= ticks * TICK_MS;
    const report = this.advance({ ticks });
    if (report.reason === 'decision') this.setDriver({ mode: 'manual' });
  }

  close(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#listeners.clear();
  }
}
