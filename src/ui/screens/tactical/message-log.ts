// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Message.cc TacticalScreenMsg (MSG_INTERFACE and MSG_DIALOG force their colours, LineWrap at
// @src LINE_WIDTH in TINYFONT1, one queued line each, the first marked as a new string), ScrollString (the aging against
// @src MAX_AGE - 1000 per queued line, the ditched last line, one line in per frame when the top slot is free, the positions
// @src Y_START - slot × the SMALLFONT1 height - WIDTH_BETWEEN_NEW_STRINGS per new string, the beep when slot 4 was free),
// @src BlitString (TINYFONT1, DEFAULT_SHADOW, black background), HideMessagesDuringNPCDialogue and
// @src UnHideMessagesDuringNPCDialogue (the age frozen while hidden), ClearDisplayedListOfTacticalStrings.

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import type { DrawList } from '../../draw-list.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { lineWrap } from '../../text/wrap.ts';

export const MAX_LINE_COUNT = 6;
export const MAX_AGE = 10000;
export const LINE_WIDTH = 320;
export const WIDTH_BETWEEN_NEW_STRINGS = 5;
const AGE_PER_QUEUED_LINE = 1000;
const MAX_QUEUED_FOR_AGE = MAX_AGE / AGE_PER_QUEUED_LINE;
const SECOND_TO_LAST = MAX_LINE_COUNT - 2;

export interface LogLine {
  readonly text: string;
  readonly colour: number;
  readonly startsMessage: boolean;
}

interface ShownLine extends LogLine {
  shownAt: number;
  y: number;
}

export class TacticalMessageLog {
  readonly #queue: LogLine[] = [];
  readonly #shown: (ShownLine | null)[] = Array.from({ length: MAX_LINE_COUNT }, () => null);
  #hiddenSince: number | null = null;

  get queued(): number {
    return this.#queue.length;
  }

  get lines(): readonly (LogLine & { readonly y: number })[] {
    return this.#shown.filter((l): l is ShownLine => l !== null);
  }

  push(text: string, colour: number, font: BitmapFont): void {
    let first = true;
    for (const line of lineWrap(font, LINE_WIDTH, text)) {
      this.#queue.push({ text: line, colour, startsMessage: first });
      first = false;
    }
  }

  clearShown(): void {
    this.#shown.fill(null);
  }

  clearQueue(): void {
    this.#queue.length = 0;
  }

  hide(now: number): void {
    if (this.#hiddenSince === null) this.#hiddenSince = now;
  }

  unhide(now: number): void {
    if (this.#hiddenSince === null) return;
    for (const line of this.#shown) if (line) line.shownAt += now - this.#hiddenSince;
    this.#hiddenSince = null;
  }

  get hidden(): boolean {
    return this.#hiddenSince !== null;
  }

  scroll(now: number, yStart: number, lineHeight: number): boolean {
    if (this.#hiddenSince !== null) return false;
    const queued = Math.min(this.#queue.length, MAX_QUEUED_FOR_AGE);
    const ditchLast = this.#queue.length > 0 && this.#shown[MAX_LINE_COUNT - 1] !== null;
    const maxAge = MAX_AGE - AGE_PER_QUEUED_LINE * queued;
    for (let slot = 0; slot < MAX_LINE_COUNT; slot++) {
      const line = this.#shown[slot];
      if (!line) continue;
      if (ditchLast && slot === MAX_LINE_COUNT - 1) line.shownAt = MAX_AGE;
      if ((now - line.shownAt) >>> 0 > maxAge >>> 0) this.#shown[slot] = null;
    }
    const head = this.#queue[0];
    if (!head || this.#shown[MAX_LINE_COUNT - 1] !== null) return false;
    for (let slot = MAX_LINE_COUNT - 1; slot > 0; slot--) this.#shown[slot] = this.#shown[slot - 1] ?? null;
    const entered: ShownLine = { ...head, shownAt: now, y: yStart };
    this.#shown[0] = entered;
    this.#queue.shift();
    let newStrings = head.startsMessage ? 1 : 0;
    for (let slot = 0; slot < MAX_LINE_COUNT; slot++) {
      const line = this.#shown[slot];
      if (!line) continue;
      line.y = yStart - slot * lineHeight - WIDTH_BETWEEN_NEW_STRINGS * newStrings;
      if (line.startsMessage) newStrings++;
    }
    return this.#shown[SECOND_TO_LAST] === null;
  }

  render(list: DrawList, font: BitmapFont, x: number): void {
    if (this.#hiddenSince !== null) return;
    for (const line of this.#shown) {
      if (!line) continue;
      mprint(list, font, x, line.y, line.text, fontColors(line.colour, DEFAULT_SHADOW, FontColor.MCOLOR_BLACK));
    }
  }
}

export function lineHeightOf(font: BitmapFont): number {
  return fontHeight(font);
}
