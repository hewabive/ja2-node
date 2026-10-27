import { type ELDHistogram, monitorEventLoopDelay } from 'node:perf_hooks';

const RESOLUTION_MS = 10;
const NS_PER_MS = 1e6;

export class LoopDelayWindow {
  readonly #histogram: ELDHistogram;

  constructor() {
    this.#histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    this.#histogram.enable();
  }

  takeMaxMs(): number {
    const max = this.#histogram.count > 0 ? this.#histogram.max / NS_PER_MS : 0;
    this.#histogram.reset();
    return Math.round(max);
  }
}

let threadWindow: LoopDelayWindow | null = null;

export function threadLoopDelay(): LoopDelayWindow {
  threadWindow ??= new LoopDelayWindow();
  return threadWindow;
}
