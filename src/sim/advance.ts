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

export type StopReason = 'idle' | 'decision' | 'event' | 'ticks' | 'budget' | 'worldTime' | 'refused';

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
}

export interface Steppable {
  readonly tick: number;
  readonly worldClock?: WorldTimeControl | null;
  isIdle(): boolean;
  hasPendingDecision(): boolean;
  step(): void;
  drainEvents(): SimEvent[];
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

export function advance(sim: Steppable, until: StopCondition, budget = DEFAULT_ADVANCE_BUDGET_TICKS): StopReport {
  const start = sim.tick;
  const clock = sim.worldClock ?? null;
  const strategic = clock !== null && isStrategicCondition(until);
  const startSeconds = clock?.worldTime().seconds ?? 0;
  const target = clock ? targetSeconds(until, startSeconds) : null;
  const tickBudget = strategic ? Math.max(budget, STRATEGIC_ADVANCE_BUDGET_TICKS) : budget;
  const limit = Math.min(until.ticks ?? tickBudget, tickBudget);
  const collected: SimEvent[] = [];
  const watched = new Set<SimEventType>(until.events ?? []);
  if (strategic && until.compressionStopped !== false) watched.add('compressionStopped');
  const report = (reason: StopReason, refusal?: string): StopReport => ({
    tick: sim.tick,
    reason,
    events: collected,
    ...(clock ? { worldTime: clock.worldTime() } : {}),
    ...(refusal ? { refusal } : {}),
  });
  const startCompression = (): string | null => {
    const refused = clock?.startCompression(until.mode) ?? null;
    collected.push(...sim.drainEvents());
    return refused;
  };
  if (strategic && !clock.onMap() && target === null && !sim.hasPendingDecision())
    return report('refused', 'time compression works on the strategic map only');
  if (strategic && clock.onMap() && !clock.compressing() && !sim.hasPendingDecision()) {
    const refused = startCompression();
    if (refused) return report('refused', refused);
  }
  for (;;) {
    if (sim.hasPendingDecision()) return report('decision');
    if (until.idle && sim.isIdle()) return report('idle');
    if (clock && target !== null && clock.worldTime().seconds >= target) {
      clock.stopCompression();
      collected.push(...sim.drainEvents(), { type: 'worldTimeReached', tick: sim.tick, seconds: clock.worldTime().seconds });
      return report('worldTime');
    }
    if (strategic && clock.onMap() && !clock.compressing()) {
      if (until.compressionStopped !== false) return report('idle');
      const refused = startCompression();
      if (refused) return report('refused', refused);
      if (!clock.compressing()) return report('idle');
    }
    if (strategic && clock.worldTime().seconds - startSeconds >= STRATEGIC_ADVANCE_BUDGET_SECONDS) return report('budget');
    if (sim.tick - start >= limit) return report(until.ticks !== undefined && until.ticks <= tickBudget ? 'ticks' : 'budget');
    sim.step();
    const events = sim.drainEvents();
    collected.push(...events);
    if (sim.hasPendingDecision()) return report('decision');
    if (events.some((e) => watched.has(e.type))) return report('event');
  }
}
