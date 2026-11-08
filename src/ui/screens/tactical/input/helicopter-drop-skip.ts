// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Entering.cc HandleHeliDrop (_KeyDown(SDLK_ESCAPE), polled on every frame of a run before
// @src the tactical UI, lands the seats left).

import type { PlayerView } from '../../../../protocol/view.ts';
import type { CommandReply } from '../environment.ts';

export const ESCAPE_KEY = 'Escape';

export function helicopterDropRunning(view: PlayerView | null): boolean {
  return view?.helicopterDrop?.running === true;
}

export class HelicopterDropSkip {
  #asked = false;

  poll(running: boolean, escapeDown: boolean, skip: () => Promise<CommandReply>): void {
    if (!running) {
      this.#asked = false;
      return;
    }
    if (!escapeDown || this.#asked) return;
    this.#asked = true;
    void skip().then(
      (reply) => {
        if (!reply.ok) this.#asked = false;
      },
      () => {
        this.#asked = false;
      },
    );
  }
}
