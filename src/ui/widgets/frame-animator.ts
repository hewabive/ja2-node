export class FrameAnimator {
  readonly frames: number;
  readonly delayMs: number;
  #frame: number;
  #last: number;

  constructor(frames: number, delayMs: number, now = 0, first = 0) {
    this.frames = frames;
    this.delayMs = delayMs;
    this.#frame = first;
    this.#last = now;
  }

  get frame(): number {
    return this.#frame;
  }

  reset(now: number, first = 0): void {
    this.#frame = first;
    this.#last = now;
  }

  update(now: number): number {
    if (now - this.#last > this.delayMs) {
      this.#frame = (this.#frame + 1) % this.frames;
      this.#last = now;
    }
    return this.#frame;
  }
}
