// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Credits.cc HandleCreditScreen (when the next row is read, when the screen ends), HandleCreditNodes
// @src (1 px per scroll delay, the head node dropped above the screen), AddCreditNode, CRDT_START_POS_Y,
// @src CRDT_TEXT_START_LOC, CRDT_WIDTH_OF_TEXT_AREA. See docs/27 §4.1.

import { type CreditNode, type CreditStyle, INITIAL_CREDIT_STYLE, readCreditRow } from '../../content/formats/credits.ts';

export const CREDITS_SCREEN_WIDTH = 640;
export const CREDITS_SCREEN_HEIGHT = 480;
export const CREDIT_START_Y = CREDITS_SCREEN_HEIGHT - 1;
export const CREDIT_TEXT_X = 10;
export const CREDIT_TEXT_WIDTH = 210;
export const CREDIT_TAIL_OVERLAP = 16;
export const CREDIT_SCROLL_PIXELS = 1;
const MAX_CATCH_UP_STEPS = 64;
const MIN_SCROLL_DELAY_MS = 1;

export interface RolledNode {
  readonly node: CreditNode;
  readonly height: number;
  y: number;
}

export type RowFeed = () => string | null | undefined;
export type MeasureNode = (node: CreditNode) => number;

export class CreditRoll {
  readonly nodes: RolledNode[] = [];
  readonly #feed: RowFeed;
  readonly #measure: MeasureNode;
  #style: CreditStyle = INITIAL_CREDIT_STYLE;
  #tail: RolledNode | null = null;
  #lastScrollMs: number;
  #rowsRead = 0;
  #finished = false;

  constructor(startMs: number, feed: RowFeed, measure: MeasureNode) {
    this.#lastScrollMs = startMs;
    this.#feed = feed;
    this.#measure = measure;
  }

  get style(): CreditStyle {
    return this.#style;
  }

  get rowsRead(): number {
    return this.#rowsRead;
  }

  get finished(): boolean {
    return this.#finished;
  }

  update(nowMs: number): void {
    if (this.#finished) return;
    this.#scroll(nowMs);
    if (!this.#readyForRow()) return;
    const text = this.#feed();
    if (text === undefined) return;
    if (text === null) {
      if (!this.#tail) this.#finished = true;
      return;
    }
    this.#rowsRead++;
    const row = readCreditRow(text, this.#style);
    this.#style = row.style;
    if (!row.node) return;
    const rolled: RolledNode = { node: row.node, height: this.#measure(row.node), y: CREDIT_START_Y };
    this.nodes.push(rolled);
    this.#tail = rolled;
  }

  #readyForRow(): boolean {
    const tail = this.#tail;
    return !tail || CREDIT_START_Y - (tail.y + tail.height - CREDIT_TAIL_OVERLAP) >= this.#style.gapBeforeNextRow;
  }

  #scroll(nowMs: number): void {
    if (this.nodes.length === 0) {
      this.#lastScrollMs = nowMs;
      return;
    }
    const delay = Math.max(MIN_SCROLL_DELAY_MS, this.#style.scrollDelayMs);
    let steps = 0;
    while (nowMs - this.#lastScrollMs > delay && steps < MAX_CATCH_UP_STEPS) {
      this.#lastScrollMs += delay;
      steps++;
    }
    if (steps === MAX_CATCH_UP_STEPS) this.#lastScrollMs = nowMs;
    if (steps === 0) return;
    for (const rolled of this.nodes) rolled.y -= steps * CREDIT_SCROLL_PIXELS;
    const head = this.nodes[0];
    if (head && head.y + head.height < 0) {
      this.nodes.shift();
      if (head === this.#tail) this.#tail = null;
    }
  }
}
