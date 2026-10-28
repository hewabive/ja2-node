// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/sgp/Input.cc QueueMouseEvent, DequeueSpecificEvent (button events queued and taken one per game loop);
// @src src/game/Tactical/Turn_Based_Input.cc GetTBMouseButtonInput, Real_Time_Input.cc GetRTMouseButtonInput (the
// @src button state read once per frame, a release outside the viewport ending a held button).

import { MouseButtonMask, MouseReason } from '../../../input/mouse.ts';

export interface ButtonTransition {
  readonly mask: number;
  readonly down: boolean;
  readonly inViewport: boolean;
  readonly at: number;
}

const REASONS: readonly (readonly [number, number, boolean])[] = [
  [MouseReason.LBUTTON_DWN, MouseButtonMask.LEFT, true],
  [MouseReason.LBUTTON_UP, MouseButtonMask.LEFT, false],
  [MouseReason.RBUTTON_DWN, MouseButtonMask.RIGHT, true],
  [MouseReason.RBUTTON_UP, MouseButtonMask.RIGHT, false],
  [MouseReason.MBUTTON_DWN, MouseButtonMask.MIDDLE, true],
  [MouseReason.MBUTTON_UP, MouseButtonMask.MIDDLE, false],
];

export class PointerQueue {
  readonly #queue: ButtonTransition[] = [];
  #buttons = 0;
  #inViewport = false;

  get buttons(): number {
    return this.#buttons;
  }

  get inViewport(): boolean {
    return this.#inViewport;
  }

  isDown(mask: number): boolean {
    return (this.#buttons & mask) !== 0;
  }

  push(reason: number, inViewport: boolean, at: number): void {
    for (const [bit, mask, down] of REASONS) if (reason & bit) this.#queue.push({ mask, down, inViewport, at });
  }

  next(inViewport: boolean, globalButtons: (mask: number) => boolean, at: number): void {
    const transition = this.#queue.shift();
    if (transition) {
      this.#buttons = transition.down ? this.#buttons | transition.mask : this.#buttons & ~transition.mask;
      this.#inViewport = transition.inViewport;
      return;
    }
    this.#inViewport = inViewport;
    for (const mask of [MouseButtonMask.LEFT, MouseButtonMask.RIGHT, MouseButtonMask.MIDDLE])
      if (this.isDown(mask) && !globalButtons(mask)) this.#queue.push({ mask, down: false, inViewport: false, at });
  }

  clear(): void {
    this.#queue.length = 0;
    this.#buttons = 0;
  }
}
