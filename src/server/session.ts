import type { CommandEnvelope, DriverMode, ServerMessage } from '../protocol/messages.ts';
import { diffView, type PlayerView, type SoldierView, type ViewFrame } from '../protocol/view.ts';
import { advance, type Steppable, type StopCondition, type StopReport } from '../sim/advance.ts';
import { TICK_MS } from '../sim/clock.ts';

export const FRAME_TICKS = 10;
const REALTIME_INTERVAL_MS = 16;
const MAX_FRAMES_PER_MESSAGE = 500;

export interface CommandResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface SessionSim extends Steppable {
  dispatch(cmd: CommandEnvelope): CommandResult;
  view(): PlayerView;
}

export type Listener = (message: ServerMessage) => void;

export class Session {
  readonly id: string;
  readonly sim: SessionSim;
  #driver: DriverMode = { mode: 'manual' };
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastRealtime = 0;
  #carryMs = 0;
  #lastSoldiers: readonly SoldierView[];
  readonly #listeners = new Set<Listener>();

  constructor(id: string, sim: SessionSim) {
    this.id = id;
    this.sim = sim;
    this.#lastSoldiers = sim.view().soldiers;
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
      isIdle: () => sim.isIdle(),
      hasPendingDecision: () => sim.hasPendingDecision(),
      drainEvents: () => sim.drainEvents(),
      step: () => {
        sim.step();
        if (sim.tick % FRAME_TICKS === 0) this.#capture(frames);
      },
    };
  }

  #capture(frames: ViewFrame[]): void {
    const soldiers = this.sim.view().soldiers;
    const frame = diffView(this.#lastSoldiers, soldiers, this.sim.tick);
    this.#lastSoldiers = soldiers;
    if (frame) frames.push(frame);
  }

  dispatch(cmd: CommandEnvelope): CommandResult {
    const result = this.sim.dispatch(cmd);
    const frames: ViewFrame[] = [];
    this.#capture(frames);
    this.#publish(frames);
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
