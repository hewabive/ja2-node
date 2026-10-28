// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc RequestToggleTimeCompression, RequestIncreaseInTimeCompression (start
// @src over at 5 minutes per second), RequestDecreaseInTimeCompression; src/game/Strategic/Game_Clock.cc
// @src IncreaseGameTimeCompressionRate and DecreaseGameTimeCompressionRate (the map screen skips X1);
// @src src/game/Strategic/Map_Screen_Interface_Bottom.cc DisplayCompressMode.

import { FontColor } from '../../../content/text/font-colors.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { ClockView } from '../../../protocol/view.ts';

export const CompressMode = { X0: 0, X1: 1, MIN5: 2, MIN30: 3, MIN60: 4 } as const;

export type CompressRequest = 'more' | 'less' | 'toggle';

export function compressionCommand(clock: Pick<ClockView, 'compressing' | 'mode'>, request: CompressRequest): CommandEnvelope | null {
  const mode = clock.mode ?? CompressMode.X0;
  switch (request) {
    case 'toggle':
      return clock.compressing ? { type: 'stopTime' } : { type: 'compressTime' };
    case 'more':
      if (!clock.compressing) return { type: 'compressTime', mode: CompressMode.MIN5 };
      return mode < CompressMode.MIN60 ? { type: 'compressTime', mode: Math.max(CompressMode.MIN5, mode + 1) } : null;
    case 'less':
      if (!clock.compressing) return null;
      return mode > CompressMode.MIN5 ? { type: 'compressTime', mode: mode - 1 } : { type: 'stopTime' };
  }
}

export function compressionLabelIndex(clock: Pick<ClockView, 'compressing' | 'mode'> | null): number {
  return clock?.compressing ? (clock.mode ?? CompressMode.X0) : CompressMode.X0;
}

export function compressionLabelSteady(clock: Pick<ClockView, 'mode' | 'paused'> | null): boolean {
  return (clock?.mode ?? CompressMode.X0) !== CompressMode.X0 && clock?.paused !== true;
}

export class CompressionBlink {
  #colour: number = FontColor.LTGREEN;
  #since = 0;
  readonly #period: number;

  constructor(period: number) {
    this.#period = period;
  }

  colour(now: number, steady: boolean): number {
    if (now - this.#since >= this.#period) {
      this.#colour = this.#colour === FontColor.LTGREEN ? FontColor.WHITE : FontColor.LTGREEN;
      this.#since = now;
    }
    return steady ? FontColor.LTGREEN : this.#colour;
  }
}
