import type { PauseCheck } from '../sim/advance.ts';

export const SLICE_BUDGET_MS = 10;

export interface Slicer {
  begin(): void;
  readonly due: PauseCheck;
  pause(): Promise<void>;
}

export const NEVER_DUE: PauseCheck = () => false;

export const UNSLICED: Slicer = { begin: () => undefined, due: NEVER_DUE, pause: () => Promise.resolve() };

export class SliceScheduler {
  readonly #waiting: (() => void)[] = [];
  #armed = false;

  turn(): Promise<void> {
    return new Promise((resolve) => {
      this.#waiting.push(resolve);
      this.#arm();
    });
  }

  #arm(): void {
    if (this.#armed || this.#waiting.length === 0) return;
    this.#armed = true;
    setImmediate(() => {
      this.#armed = false;
      const next = this.#waiting.shift();
      this.#arm();
      next?.();
    });
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

  begin(): void {
    this.#slices++;
    this.#deadline = performance.now() + this.#budgetMs;
  }

  readonly due: PauseCheck = () => performance.now() >= this.#deadline;

  pause(): Promise<void> {
    return this.#scheduler.turn();
  }
}
