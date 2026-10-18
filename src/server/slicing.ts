import type { PauseCheck } from '../sim/advance.ts';

export const SLICE_BUDGET_MS = 10;

export interface Slicer {
  claim(): boolean;
  begin(): void;
  readonly due: PauseCheck;
  pause(): Promise<void>;
}

export const NEVER_DUE: PauseCheck = () => false;

export const UNSLICED: Slicer = { claim: () => true, begin: () => undefined, due: NEVER_DUE, pause: () => Promise.resolve() };

export class SliceScheduler {
  readonly #waiting: (() => void)[] = [];
  #armed = false;
  #turnTaken = false;

  claim(): boolean {
    if (this.#turnTaken || this.#waiting.length > 0) return false;
    this.#take();
    return true;
  }

  turn(): Promise<void> {
    return new Promise((resolve) => {
      this.#waiting.push(resolve);
      this.#arm();
    });
  }

  #take(): void {
    this.#turnTaken = true;
    this.#arm();
  }

  #arm(): void {
    if (this.#armed || (!this.#turnTaken && this.#waiting.length === 0)) return;
    this.#armed = true;
    setImmediate(() => this.#endTurn());
  }

  #endTurn(): void {
    this.#armed = false;
    const taken = this.#turnTaken;
    this.#turnTaken = false;
    const next = taken ? undefined : this.#waiting.shift();
    if (next) this.#take();
    this.#arm();
    next?.();
  }
}

export class TimeSlicer implements Slicer {
  readonly #scheduler: SliceScheduler;
  readonly #budgetMs: number;
  #deadline = 0;
  #slices = 0;

  constructor(scheduler: SliceScheduler, budgetMs = SLICE_BUDGET_MS) {
    this.#scheduler = scheduler;
    this.#budgetMs = budgetMs;
  }

  get slices(): number {
    return this.#slices;
  }

  claim(): boolean {
    return this.#scheduler.claim();
  }

  begin(): void {
    this.#slices++;
    this.#deadline = performance.now() + this.#budgetMs;
  }

  readonly due: PauseCheck = () => performance.now() >= this.#deadline;

  pause(): Promise<void> {
    return this.#scheduler.turn();
  }
}
