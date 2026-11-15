// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Mercs.cc SPECK_IDLE_CHAT_DELAY, HandleSpeckIdleConversation (more than 10 s of the laptop's
// @src clock since the last reset: the quote said least while no video is up, the timer reset either way),
// @src GetRandomQuoteThatHasBeenSaidTheLeast (the first quote with the lowest count, in the order of the available
// @src quotes), IncreaseMercRandomQuoteValue (one more for quotes 47 to 57, three for the rest), gNumberOfTimesQuoteSaid
// @src (unsaved, never reset).

import { u32 } from '../../../../core/int.ts';

export const SPECK_IDLE_CHAT_DELAY = 10000;
const FIRST_SELLS_QUOTE = 47;
const LAST_SELLS_QUOTE = 57;
const SELLS_QUOTE_WEIGHT = 1;
const OTHER_QUOTE_WEIGHT = 3;

export type SpeckQuotesSaid = Map<number, number>;

function timesSaid(said: SpeckQuotesSaid, quote: number): number {
  return said.get(quote) ?? 0;
}

function sayWeight(quote: number): number {
  return quote >= FIRST_SELLS_QUOTE && quote <= LAST_SELLS_QUOTE ? SELLS_QUOTE_WEIGHT : OTHER_QUOTE_WEIGHT;
}

export function leastSaidQuote(quotes: readonly number[], said: SpeckQuotesSaid): number | null {
  let least: number | null = null;
  for (const quote of quotes) if (least === null || timesSaid(said, quote) < timesSaid(said, least)) least = quote;
  return least;
}

export class SpeckIdleChat {
  readonly #said: SpeckQuotesSaid;
  #last: number;

  constructor(said: SpeckQuotesSaid, now: number) {
    this.#said = said;
    this.#last = now;
  }

  reset(now: number): void {
    this.#last = now;
  }

  update(now: number, videoShown: boolean, quotes: readonly number[]): number | null {
    if (u32(now - this.#last) <= SPECK_IDLE_CHAT_DELAY) return null;
    this.#last = now;
    if (videoShown) return null;
    const quote = leastSaidQuote(quotes, this.#said);
    if (quote === null) return null;
    this.#said.set(quote, u32(timesSaid(this.#said, quote) + sayWeight(quote)));
    return quote;
  }
}
