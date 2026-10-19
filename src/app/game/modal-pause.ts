import type { DriverMode } from '../../protocol/messages.ts';
import type { SessionClient } from '../net/session-client.ts';

const MANUAL: DriverMode = { mode: 'manual' };

export interface DriverControl {
  readonly driver: DriverMode;
  drive(driver: DriverMode): Promise<void>;
}

export class ModalPause {
  readonly #client: () => DriverControl | null;
  #depth = 0;
  #held: { readonly client: DriverControl; readonly restore: DriverMode } | null = null;

  constructor(client: () => DriverControl | SessionClient | null) {
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
    const client = this.#client();
    if (client?.driver.mode !== 'realtime') return;
    this.#held = { client, restore: client.driver };
    void client.drive(MANUAL);
  }

  #release(): void {
    const held = this.#held;
    this.#held = null;
    if (held && held.client === this.#client() && held.client.driver.mode === 'manual') void held.client.drive(held.restore);
  }
}
