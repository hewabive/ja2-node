import type { SimEvent, SimEventType } from './events.ts';

export const DEFAULT_ADVANCE_BUDGET_TICKS = 200_000;
export const STRATEGIC_ADVANCE_BUDGET_TICKS = 2_000_000;
export const STRATEGIC_ADVANCE_BUDGET_SECONDS = 7 * 86_400;

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

export type WorldTimeTarget = number | { readonly day: number; readonly hour?: number; readonly minute?: number };

export interface StopCondition {
  readonly idle?: true;
  readonly events?: readonly SimEventType[];
  readonly ticks?: number;
  readonly worldTime?: WorldTimeTarget;
  readonly worldSeconds?: number;
  readonly compressionStopped?: boolean;
  readonly mode?: number;
}

export type StopReason = 'idle' | 'decision' | 'event' | 'ticks' | 'budget' | 'worldTime' | 'refused' | 'ended' | 'timeout';

const ALWAYS_STOP_EVENTS: readonly SimEventType[] = ['meanwhileEnded', 'endgameDeferred'];

export interface WorldTimeReading {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly seconds: number;
}

export interface StopReport {
  readonly tick: number;
  readonly reason: StopReason;
  readonly events: readonly SimEvent[];
  readonly worldTime?: WorldTimeReading;
  readonly refusal?: string;
}

export interface WorldTimeControl {
  worldTime(): WorldTimeReading;
  onMap(): boolean;
  compressing(): boolean;
  startCompression(mode?: number): string | null;
  stopCompression(): void;
  modalRefusal?(): string | null;
}

export interface Steppable {
  readonly tick: number;
  readonly worldClock?: WorldTimeControl | null;
  isIdle(): boolean;
  hasPendingDecision(): boolean;
  step(): void;
  drainEvents(): SimEvent[];
  ended?(): boolean;
}

export function worldTimeReading(seconds: number): WorldTimeReading {
  const day = Math.trunc(seconds / SECONDS_PER_DAY);
  const inDay = seconds - day * SECONDS_PER_DAY;
  const hour = Math.trunc(inDay / SECONDS_PER_HOUR);
  const minute = Math.trunc((inDay - hour * SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return { day, hour, minute, seconds };
}

export function worldTimeTargetSeconds(target: WorldTimeTarget): number {
  if (typeof target === 'number') return target;
  return target.day * SECONDS_PER_DAY + (target.hour ?? 0) * SECONDS_PER_HOUR + (target.minute ?? 0) * SECONDS_PER_MINUTE;
}

export function isStrategicCondition(until: StopCondition): boolean {
  return (
    until.worldTime !== undefined || until.worldSeconds !== undefined || until.compressionStopped !== undefined || until.mode !== undefined
  );
}

function targetSeconds(until: StopCondition, now: number): number | null {
  const targets: number[] = [];
  if (until.worldTime !== undefined) targets.push(worldTimeTargetSeconds(until.worldTime));
  if (until.worldSeconds !== undefined) targets.push(now + until.worldSeconds);
  return targets.length === 0 ? null : Math.min(...targets);
}

export type PauseCheck = () => boolean;

const NEVER_PAUSE: PauseCheck = () => false;

export class AdvanceRun {
  readonly #sim: Steppable;
  readonly #until: StopCondition;
  readonly #clock: WorldTimeControl | null;
  readonly #strategic: boolean;
  readonly #start: number;
  readonly #startSeconds: number;
  readonly #target: number | null;
  readonly #tickBudget: number;
  readonly #limit: number;
  readonly #collected: SimEvent[] = [];
  readonly #watched: Set<SimEventType>;
  #started = false;
  #checked = false;

  constructor(sim: Steppable, until: StopCondition, budget = DEFAULT_ADVANCE_BUDGET_TICKS) {
    this.#sim = sim;
    this.#until = until;
    this.#start = sim.tick;
    this.#clock = sim.worldClock ?? null;
    this.#strategic = this.#clock !== null && isStrategicCondition(until);
    this.#startSeconds = this.#clock?.worldTime().seconds ?? 0;
    this.#target = this.#clock ? targetSeconds(until, this.#startSeconds) : null;
    this.#tickBudget = this.#strategic ? Math.max(budget, STRATEGIC_ADVANCE_BUDGET_TICKS) : budget;
    this.#limit = Math.min(until.ticks ?? this.#tickBudget, this.#tickBudget);
    this.#watched = new Set<SimEventType>([...(until.events ?? []), ...ALWAYS_STOP_EVENTS]);
    if (this.#strategic && until.compressionStopped !== false) this.#watched.add('compressionStopped');
  }

  resume(pause: PauseCheck = NEVER_PAUSE): StopReport | null {
    const refused = this.#begin();
    if (refused) return refused;
    let stepped = false;
    for (;;) {
      if (!this.#checked) {
        const stop = this.#beforeStep();
        if (stop) return stop;
        this.#checked = true;
      }
      if (stepped && pause()) return null;
      this.#checked = false;
      stepped = true;
      const stop = this.#step();
      if (stop) return stop;
    }
  }

  observe(events: readonly SimEvent[]): StopReport | null {
    return this.#begin() ?? this.#afterStep(events) ?? this.#beforeStep();
  }

  stopped(reason: StopReason, refusal?: string): StopReport {
    return this.#report(reason, refusal);
  }

  #begin(): StopReport | null {
    if (this.#started) return null;
    this.#started = true;
    return this.#opening();
  }

  #report(reason: StopReason, refusal?: string): StopReport {
    const clock = this.#clock;
    return {
      tick: this.#sim.tick,
      reason,
      events: this.#collected,
      ...(clock ? { worldTime: clock.worldTime() } : {}),
      ...(refusal ? { refusal } : {}),
    };
  }

  #startCompression(): string | null {
    const refused = this.#clock?.startCompression(this.#until.mode) ?? null;
    this.#collected.push(...this.#sim.drainEvents());
    return refused;
  }

  #opening(): StopReport | null {
    const sim = this.#sim;
    const clock = this.#clock;
    if (sim.ended?.()) return this.#report('ended');
    const modal = clock?.modalRefusal?.() ?? null;
    if (modal) return this.#report('refused', modal);
    if (!this.#strategic || !clock) return null;
    if (!clock.onMap() && this.#target === null && !sim.hasPendingDecision())
      return this.#report('refused', 'time compression works on the strategic map only');
    if (clock.onMap() && !clock.compressing() && !sim.hasPendingDecision()) {
      const refused = this.#startCompression();
      if (refused) return this.#report('refused', refused);
    }
    return null;
  }

  #beforeStep(): StopReport | null {
    const sim = this.#sim;
    const clock = this.#clock;
    const until = this.#until;
    if (sim.hasPendingDecision()) return this.#report('decision');
    if (until.idle && sim.isIdle()) return this.#report('idle');
    if (clock && this.#target !== null && clock.worldTime().seconds >= this.#target) {
      clock.stopCompression();
      this.#collected.push(...sim.drainEvents(), { type: 'worldTimeReached', tick: sim.tick, seconds: clock.worldTime().seconds });
      return this.#report('worldTime');
    }
    if (this.#strategic && clock && clock.onMap() && !clock.compressing()) {
      if (until.compressionStopped !== false) return this.#report('idle');
      const refused = this.#startCompression();
      if (refused) return this.#report('refused', refused);
      if (!clock.compressing()) return this.#report('idle');
    }
    if (this.#strategic && clock && clock.worldTime().seconds - this.#startSeconds >= STRATEGIC_ADVANCE_BUDGET_SECONDS)
      return this.#report('budget');
    if (sim.tick - this.#start >= this.#limit)
      return this.#report(until.ticks !== undefined && until.ticks <= this.#tickBudget ? 'ticks' : 'budget');
    return null;
  }

  #step(): StopReport | null {
    this.#sim.step();
    return this.#afterStep(this.#sim.drainEvents());
  }

  #afterStep(events: readonly SimEvent[]): StopReport | null {
    const sim = this.#sim;
    this.#collected.push(...events);
    if (sim.ended?.()) return this.#report('ended');
    if (sim.hasPendingDecision()) return this.#report('decision');
    if (events.some((e) => this.#watched.has(e.type))) return this.#report('event');
    return null;
  }
}

export function advance(sim: Steppable, until: StopCondition, budget = DEFAULT_ADVANCE_BUDGET_TICKS): StopReport {
  return new AdvanceRun(sim, until, budget).resume() as StopReport;
}
