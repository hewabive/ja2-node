import type { SimEvent, SimEventType } from './events.ts';

export const DEFAULT_ADVANCE_BUDGET_TICKS = 200_000;

export interface StopCondition {
  readonly idle?: true;
  readonly events?: readonly SimEventType[];
  readonly ticks?: number;
}

export type StopReason = 'idle' | 'decision' | 'event' | 'ticks' | 'budget';

export interface StopReport {
  readonly tick: number;
  readonly reason: StopReason;
  readonly events: readonly SimEvent[];
}

export interface Steppable {
  readonly tick: number;
  isIdle(): boolean;
  hasPendingDecision(): boolean;
  step(): void;
  drainEvents(): SimEvent[];
}

export function advance(sim: Steppable, until: StopCondition, budget = DEFAULT_ADVANCE_BUDGET_TICKS): StopReport {
  const start = sim.tick;
  const limit = Math.min(until.ticks ?? budget, budget);
  const collected: SimEvent[] = [];
  const watched = new Set(until.events ?? []);
  const report = (reason: StopReason): StopReport => ({ tick: sim.tick, reason, events: collected });
  for (;;) {
    if (sim.hasPendingDecision()) return report('decision');
    if (until.idle && sim.isIdle()) return report('idle');
    if (sim.tick - start >= limit) return report(until.ticks !== undefined && until.ticks <= budget ? 'ticks' : 'budget');
    sim.step();
    const events = sim.drainEvents();
    collected.push(...events);
    if (events.some((e) => watched.has(e.type))) return report('event');
  }
}
