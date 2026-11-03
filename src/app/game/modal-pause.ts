const MODAL_HOLD = 'modal';

export interface TimeHolder {
  hold(reason: string, held: boolean): void;
}

export class ModalPause {
  readonly #client: () => TimeHolder | null;
  #depth = 0;
  #held: TimeHolder | null = null;

  constructor(client: () => TimeHolder | null) {
    this.#client = client;
  }

  get depth(): number {
    return this.#depth;
  }

  get holding(): boolean {
    return this.#held !== null;
  }

  set(paused: boolean): void {
    if (paused) {
      if (this.#depth++ === 0) this.#hold();
      return;
    }
    if (this.#depth === 0) return;
    if (--this.#depth === 0) this.#release();
  }

  #hold(): void {
    this.#held = this.#client();
    this.#held?.hold(MODAL_HOLD, true);
  }

  #release(): void {
    this.#held?.hold(MODAL_HOLD, false);
    this.#held = null;
  }
}
