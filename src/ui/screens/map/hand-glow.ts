// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc ItemRegionMvtCallback (fShowItemHighLight set as the pointer enters the hand
// @src while CanToggleSelectedCharInventory holds, cleared as it leaves or as any pointer event in the hand finds the
// @src check failing), GlowItem (GlowColor stepping 1 to 10 and down to 0 on the common glow timer, outlined from
// @src STD_SCREEN_X + 3, STD_SCREEN_Y + 80 to + 64, + 104 from its first step on, gone at once as the highlight ends).

import type { DrawList } from '../../draw-list.ts';
import { MouseReason } from '../../input/mouse.ts';
import { GLOW_STEPS, glowColour } from './team-list-view.ts';

export interface GlowBox {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export class HandGlow {
  #highlighted = false;
  #drawn = false;
  #colour = 0;
  #falling = true;

  get colour(): number | null {
    return this.#drawn ? this.#colour : null;
  }

  pointer(reason: number, canToggle: boolean): void {
    if (!canToggle) this.#highlighted = false;
    else if (reason & MouseReason.GAIN_MOUSE) this.#highlighted = true;
    else if (reason & MouseReason.LOST_MOUSE) this.#highlighted = false;
  }

  clear(): void {
    this.#highlighted = false;
  }

  step(timerExpired: boolean): void {
    if (!this.#highlighted) {
      this.#colour = 0;
      this.#falling = true;
      this.#drawn = false;
      return;
    }
    if (!timerExpired) return;
    this.#drawn = true;
    if (this.#colour === 0 || this.#colour === GLOW_STEPS) this.#falling = !this.#falling;
    this.#colour += this.#falling ? -1 : 1;
  }

  render(list: DrawList, box: GlowBox): void {
    if (this.#drawn) list.rectangle(box.x1, box.y1, box.x2, box.y2, glowColour(this.#colour));
  }
}
