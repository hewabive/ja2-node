// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/HelpScreen.cc RenderCurrentHelpScreenTextToBuffer (the lines of a page: its pixels divided by
// @src HLP_SCRN__HEIGHT_OF_1_LINE_IN_BUFFER), ChangeHelpScreenSubPage (back to the first line; the arrows enabled when
// @src the page has more lines than HLP_SCRN__MAX_NUMBER_DISPLAYED_LINES_IN_BUFFER), ChangeTopLineInTextBufferByAmount
// @src (clamped to the last full screen, then to the first line), CalculateHeightAndPositionForHelpScreenScrollBox
// @src (FLOAT ratios rounded by + 0.5), HelpScreenMouseMoveScrollBox (the grab offset kept from the first press),
// @src SelectHelpScrollAreaCallBack (the wheel moves three lines).

import { idiv } from '../../../core/int.ts';

export const WHEEL_LINES = 3;
const NO_CLICK = -1;
const ROUND = 0.5;

export interface ScrollBox {
  readonly top: number;
  readonly height: number;
}

export interface HelpScrollGeometry {
  readonly lineHeight: number;
  readonly textAreaHeight: number;
  readonly scrollTop: number;
  readonly scrollHeight: number;
}

export class HelpScroll {
  readonly lineHeight: number;
  readonly visibleLines: number;
  readonly #scrollTop: number;
  readonly #scrollHeight: number;
  #totalLines = 0;
  #top = 0;
  #lastClickY = NO_CLICK;

  constructor(geometry: HelpScrollGeometry) {
    this.lineHeight = geometry.lineHeight;
    this.visibleLines = idiv(geometry.textAreaHeight, geometry.lineHeight);
    this.#scrollTop = geometry.scrollTop;
    this.#scrollHeight = geometry.scrollHeight;
  }

  get totalLines(): number {
    return this.#totalLines;
  }

  get top(): number {
    return this.#top;
  }

  get enabled(): boolean {
    return this.#totalLines > this.visibleLines;
  }

  get pageLines(): number {
    return this.visibleLines - 1;
  }

  setContent(pixels: number): void {
    this.#top = 0;
    this.#totalLines = idiv(pixels, this.lineHeight);
  }

  move(delta: number): boolean {
    const maxTop = this.#totalLines - this.visibleLines;
    let next = this.#top + delta;
    if (next > maxTop) next = maxTop;
    if (next < 0) next = 0;
    if (next === this.#top) return false;
    this.#top = next;
    return true;
  }

  box(): ScrollBox {
    const ratio = Math.fround(this.visibleLines / Math.fround(this.#totalLines));
    if (ratio >= 1) return { top: this.#scrollTop, height: this.#scrollHeight };
    const height = Math.trunc(Math.fround(ratio * this.#scrollHeight) + ROUND);
    const step = Math.fround(this.#scrollHeight / Math.fround(this.#totalLines));
    const offset = Math.fround(step * this.#top);
    return { top: Math.trunc(offset + ROUND) + this.#scrollTop, height };
  }

  drag(mouseY: number): void {
    const bar = this.box();
    const maxHeight = this.#scrollHeight - bar.height;
    if (maxHeight === 0) return;
    if (this.#lastClickY === NO_CLICK)
      this.#lastClickY = bar.top <= mouseY && mouseY < bar.top + bar.height ? mouseY - bar.top : idiv(bar.height, 2);
    const minY = this.#scrollTop + this.#lastClickY;
    const textHeight = this.#totalLines - this.visibleLines;
    const position = idiv(textHeight * (mouseY - minY), maxHeight);
    this.move(position - this.#top);
  }

  release(): void {
    this.#lastClickY = NO_CLICK;
  }
}
