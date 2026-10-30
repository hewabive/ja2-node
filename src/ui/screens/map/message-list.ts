// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Message.cc MapScreenMessage (MSG_DIALOG in DIALOGUE_COLOR, MSG_INTERFACE in INTERFACE_COLOR, the
// @src feedback kinds not kept, LineWrap(MAP_SCREEN_MESSAGE_FONT, MAP_LINE_WIDTH)), AddStringToMapScreenMessageList (a
// @src 256-slot ring of lines, the oldest dropped), DisplayStringsInMapScreenMessageList (nine lines from the current index at
// @src STD_SCREEN_X + 20, STD_SCREEN_Y + 377, spaced by the font height, clipped to 17, 366 .. 407, 461),
// @src MoveToEndOfMapScreenMessageList, GetRangeOfMapScreenMessages; src/game/Strategic/Map_Screen_Interface_Bottom.cc
// @src MapScreenMsgScrollUp, MapScreenMsgScrollDown, ChangeCurrentMapscreenMessageIndex, DisplayScrollBarSlider,
// @src MapScreenMessageScrollBarCallBack, EnableDisableMessageScrollButtonsAndRegions; src/game/Tactical/Dialogue_Control.cc
// @src (a dialogue line printed as `Name: "line"`); src/game/Utils/Message.cc ScreenMsg (a message the screen itself
// @src prints joins the list in time order).

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import { MESSAGE_LOG_SIZE, type MessageEntry } from '../../../protocol/message-log.ts';
import type { DrawList } from '../../draw-list.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import { fontColors, mprint, withClip } from '../../text/print.ts';
import { lineWrap } from '../../text/wrap.ts';

export const MAX_MESSAGES_ON_MAP_BOTTOM = 9;
const RING_SIZE = 256;
const MAP_LINE_WIDTH = 300;
const MESSAGE_SCROLL_AREA_HEIGHT = 59;
const SLIDER_HEIGHT = 11;
const SLIDER_BAR_RANGE = MESSAGE_SCROLL_AREA_HEIGHT - SLIDER_HEIGHT;
const SLIDER_FRAME = 8;

export interface MessageLine {
  readonly text: string;
  readonly colour: number;
}

export type EntryText = (entry: MessageEntry) => string | null;

export function entryColour(entry: MessageEntry): number {
  if (entry.kind === 'dialog') return FontColor.WHITE;
  if (entry.kind === 'interface') return FontColor.YELLOW;
  return entry.colour;
}

export function localMessage(tick: number, text: string): MessageEntry {
  return { tick, kind: 'interface', colour: FontColor.MCOLOR_LTYELLOW, args: [{ text }] };
}

function withLocal(entries: readonly MessageEntry[], local: readonly MessageEntry[]): readonly MessageEntry[] {
  if (local.length === 0) return entries;
  return [...entries, ...local].sort((a, b) => a.tick - b.tick);
}

export class MapMessageList {
  #lines: MessageLine[] = [];
  #first = 0;
  #entries = 0;
  #key = '';
  readonly #local: MessageEntry[] = [];

  get lines(): readonly MessageLine[] {
    return this.#lines;
  }

  get first(): number {
    return this.#first;
  }

  get range(): number {
    return this.#lines.length;
  }

  addLocal(entry: MessageEntry): void {
    this.#local.push(entry);
    if (this.#local.length > MESSAGE_LOG_SIZE) this.#local.shift();
  }

  rebuild(server: readonly MessageEntry[], format: EntryText, font: BitmapFont): boolean {
    const entries = withLocal(server, this.#local);
    const texts = entries.map((e) => format(e));
    const key = `${entries.length}:${texts.map((t) => (t === null ? '' : t.length)).join(',')}:${entries[entries.length - 1]?.tick ?? 0}`;
    if (key === this.#key) return false;
    const grew = entries.length > this.#entries;
    this.#key = key;
    this.#entries = entries.length;
    const lines: MessageLine[] = [];
    entries.forEach((entry, i) => {
      const text = texts[i];
      if (!text) return;
      for (const line of lineWrap(font, MAP_LINE_WIDTH, text)) lines.push({ text: line, colour: entryColour(entry) });
    });
    this.#lines = lines.slice(Math.max(0, lines.length - (RING_SIZE - 1)));
    this.moveToEnd();
    return grew;
  }

  moveToEnd(): void {
    this.#first = Math.max(0, this.range - MAX_MESSAGES_ON_MAP_BOTTOM);
  }

  setFirst(index: number): void {
    this.#first = Math.max(0, Math.min(index, Math.max(0, this.range - MAX_MESSAGES_ON_MAP_BOTTOM)));
  }

  scrollUp(n: number): void {
    if (this.range <= MAX_MESSAGES_ON_MAP_BOTTOM) return;
    this.setFirst(this.#first - n);
  }

  scrollDown(n: number): void {
    if (this.range <= MAX_MESSAGES_ON_MAP_BOTTOM) return;
    this.setFirst(this.#first + n);
  }

  get canScrollUp(): boolean {
    return this.range > MAX_MESSAGES_ON_MAP_BOTTOM && this.#first > 0;
  }

  get canScrollDown(): boolean {
    return this.range > MAX_MESSAGES_ON_MAP_BOTTOM && this.#first + MAX_MESSAGES_ON_MAP_BOTTOM < this.range;
  }

  scrollBarClick(relativeY: number): void {
    const n = this.range;
    if (n <= MAX_MESSAGES_ON_MAP_BOTTOM) return;
    let index: number;
    if (relativeY < idiv(SLIDER_HEIGHT, 2)) index = 0;
    else if (relativeY >= MESSAGE_SCROLL_AREA_HEIGHT - idiv(SLIDER_HEIGHT, 2)) index = n - MAX_MESSAGES_ON_MAP_BOTTOM;
    else {
      const offset = relativeY - idiv(SLIDER_HEIGHT, 2);
      index = idiv(offset * (n - MAX_MESSAGES_ON_MAP_BOTTOM) + idiv(SLIDER_BAR_RANGE, 2), SLIDER_BAR_RANGE);
    }
    this.setFirst(index);
  }

  render(list: DrawList, font: BitmapFont, origin: { x: number; y: number }, at: { x: number; y: number }): void {
    const spacing = fontHeight(font);
    withClip(list, { x: origin.x + 17, y: origin.y + 366, width: 390, height: 95 }, () => {
      for (let k = 0; k < MAX_MESSAGES_ON_MAP_BOTTOM; k++) {
        const line = this.#lines[this.#first + k];
        if (!line) break;
        mprint(list, font, at.x, at.y + k * spacing, line.text, fontColors(line.colour, DEFAULT_SHADOW, FontColor.BLACK));
      }
    });
  }

  renderSlider(list: DrawList, art: string, x: number, y: number): void {
    const n = this.range;
    if (n <= MAX_MESSAGES_ON_MAP_BOTTOM) return;
    const offset = idiv(SLIDER_BAR_RANGE * this.#first, n - MAX_MESSAGES_ON_MAP_BOTTOM);
    list.image(art, SLIDER_FRAME, x, y + offset);
  }
}

export function dialogueLine(name: string, line: string): string {
  return `${name}: "${line}"`;
}
