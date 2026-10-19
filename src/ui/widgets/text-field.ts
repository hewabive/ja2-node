// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Text_Input.cc InitTextInputModeWithScheme (DEFAULT_SCHEME), AddTextInputField, HandleTextInput
// @src (the keys, the swallowing of unmodified keys while editing, Ctrl+Delete, Esc and Enter left to the screen),
// @src HandleRegularInput (full text and numeric filters), AddChar, DeleteHilitedText, RemoveChars, CalculateCursorPos,
// @src MouseMovedInTextRegionCallback, MouseClickedInTextRegionCallback, RenderBackgroundField, RenderActiveTextField
// @src (the caret blinks with GetJA2Clock() % 1000 < 500), RenderInactiveTextFieldNode, SelectNextField, SelectPrevField;
// @src src/game/Utils/Text_Input.h TEXT_CURSOR_BLINK_INTERVAL. See docs/28 §3.6.

import { FontColor } from '../../content/text/font-colors.ts';
import { idiv } from '../../core/int.ts';
import { CursorId } from '../cursors/cursor-ids.ts';
import { type DrawList, type RgbColor, rgb } from '../draw-list.ts';
import { KeyModifier, type UiInputEvent } from '../input/events.ts';
import { MouseButtonMask, MouseReason, Priority } from '../input/mouse.ts';
import type { MouseRegion, RegionDispatcher } from '../input/regions.ts';
import { type BitmapFont, fontHeight } from '../text/bitmap-font.ts';
import { charWidth, codePoints } from '../text/measure.ts';
import { mprint } from '../text/print.ts';
import type { UiSoundSink } from './button-sounds.ts';
import { type WidgetInfo, widgetRect } from './widget-info.ts';

export const TEXT_CURSOR_BLINK_INTERVAL = 500;
const BLINK_PERIOD = 1000;
const TEXT_INSET = 3;
const CARET_INSET = 2;
const BTN_VOLUME = 40;

export type TextFilter = 'full' | 'numeric';

export interface TextFieldScheme {
  readonly font: BitmapFont;
  readonly fieldColor: RgbColor;
  readonly foreground: number;
  readonly shadow: number;
  readonly hiForeground: number;
  readonly hiShadow: number;
  readonly hiBackground: number;
  readonly bevel: { readonly brighter: RgbColor; readonly darker: RgbColor } | null;
  readonly cursorColor: RgbColor;
}

export function defaultTextFieldScheme(font: BitmapFont): TextFieldScheme {
  return {
    font,
    fieldColor: rgb(250, 240, 188),
    foreground: FontColor.BLACK,
    shadow: FontColor.BLACK,
    hiForeground: FontColor.GRAY2,
    hiShadow: FontColor.GRAY2,
    hiBackground: FontColor.METALGRAY,
    bevel: { brighter: rgb(136, 138, 135), darker: rgb(24, 61, 81) },
    cursorColor: rgb(0, 0, 0),
  };
}

export interface TextFieldOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text?: string;
  readonly maxLength: number;
  readonly filter?: TextFilter;
  readonly priority?: number;
  readonly id?: string;
  readonly onChange?: (text: string) => void;
}

export class TextField {
  readonly id: string;
  readonly region: MouseRegion;
  readonly maxLength: number;
  readonly filter: TextFilter;
  readonly onChange: ((text: string) => void) | null;
  enabled = true;
  #text: number[];

  constructor(options: TextFieldOptions, region: MouseRegion) {
    this.id = options.id ?? 'textField';
    this.region = region;
    this.maxLength = options.maxLength;
    this.filter = options.filter ?? 'full';
    this.onChange = options.onChange ?? null;
    this.#text = codePoints(options.text ?? '').slice(0, options.maxLength);
  }

  get text(): string {
    return String.fromCodePoint(...this.#text);
  }

  set text(value: string) {
    this.#text = codePoints(value).slice(0, this.maxLength);
  }

  get length(): number {
    return this.#text.length;
  }

  get codes(): readonly number[] {
    return this.#text;
  }

  replace(codes: number[]): void {
    this.#text = codes;
    this.onChange?.(this.text);
  }
}

export class TextFieldGroup {
  readonly owner: unknown;
  readonly #regions: RegionDispatcher;
  readonly #sounds: UiSoundSink;
  readonly #scheme: TextFieldScheme;
  readonly #fields: TextField[] = [];
  #active: TextField | null = null;
  #editing = false;
  #cursor = 0;
  #startHilite = 0;

  constructor(regions: RegionDispatcher, sounds: UiSoundSink, scheme: TextFieldScheme, owner: unknown = {}) {
    this.#regions = regions;
    this.#sounds = sounds;
    this.#scheme = scheme;
    this.owner = owner;
  }

  get fields(): readonly TextField[] {
    return this.#fields;
  }

  get active(): TextField | null {
    return this.#active;
  }

  get editing(): boolean {
    return this.#editing;
  }

  get cursor(): number {
    return this.#cursor;
  }

  get selection(): readonly [number, number] {
    return [Math.min(this.#startHilite, this.#cursor), Math.max(this.#startHilite, this.#cursor)];
  }

  add(options: TextFieldOptions): TextField {
    let field: TextField | null = null;
    const region = this.#regions.define({
      x1: options.x,
      y1: options.y,
      x2: options.x + options.width,
      y2: options.y + options.height,
      priority: options.priority ?? Priority.NORMAL,
      cursor: CursorId.IBEAM,
      owner: this.owner,
      id: options.id,
      onMove: (r, reason) => {
        if (field) this.#mouseMoved(field, r, reason);
      },
      onButton: (r, reason) => {
        if (field) this.#mouseClicked(field, r, reason);
      },
    });
    field = new TextField(options, region);
    this.#fields.push(field);
    if (this.#fields.length === 1) {
      this.#active = field;
      this.#editing = true;
      this.#startHilite = 0;
      this.#cursor = field.length;
    }
    return field;
  }

  dispose(): void {
    for (const field of this.#fields) field.region.remove();
    this.#fields.length = 0;
    this.#active = null;
    this.#editing = false;
  }

  #play(sample: string): void {
    this.#sounds.play({ sample, volume: BTN_VOLUME });
  }

  #cursorAt(field: TextField, clickX: number): number {
    let position = 0;
    let i = 0;
    for (; i < field.length; i++) {
      position += charWidth(this.#scheme.font, field.codes[i] ?? 0);
      if (position >= clickX) break;
    }
    return i;
  }

  #setActive(field: TextField): void {
    if (field !== this.#active) this.#active = field;
  }

  #mouseMoved(field: TextField, region: MouseRegion, reason: number): void {
    if (!this.#regions.isButtonDown(MouseButtonMask.LEFT)) return;
    if (!(reason & (MouseReason.MOVE | MouseReason.LOST_MOUSE | MouseReason.GAIN_MOUSE))) return;
    this.#setActive(field);
    if (reason & MouseReason.LOST_MOUSE) {
      if (this.#regions.mouseY < region.y1) this.#cursor = 0;
      else if (this.#regions.mouseY > region.y2) this.#cursor = field.length;
    } else this.#cursor = this.#cursorAt(field, this.#regions.mouseX - region.x1);
  }

  #mouseClicked(field: TextField, region: MouseRegion, reason: number): void {
    if (!(reason & MouseReason.LBUTTON_DWN)) return;
    this.#setActive(field);
    this.#editing = true;
    const position = this.#cursorAt(field, this.#regions.mouseX - region.x1);
    this.#cursor = position;
    this.#startHilite = position;
  }

  #selectNext(step: 1 | -1): void {
    if (this.#fields.length === 0) return;
    const at = this.#active ? this.#fields.indexOf(this.#active) : -1;
    for (let k = 1; k <= this.#fields.length; k++) {
      const next = this.#fields[(at + step * k + this.#fields.length * 2) % this.#fields.length] as TextField;
      if (!next.enabled) continue;
      this.#active = next;
      this.#editing = true;
      this.#startHilite = 0;
      this.#cursor = next.length;
      return;
    }
  }

  #deleteHilited(): void {
    const [start, end] = this.selection;
    if (start === end) return;
    this.#startHilite = start;
    this.#cursor = start;
    this.#removeChars(start, end - start);
  }

  #removeChars(position: number, count: number): void {
    const field = this.#active;
    if (!field) return;
    const codes = [...field.codes];
    codes.splice(position, count);
    field.replace(codes);
  }

  #addChar(c: number): void {
    this.#play('ENTERING_TEXT');
    const field = this.#active;
    if (!field || field.length >= field.maxLength) return;
    const codes = [...field.codes];
    codes.splice(this.#cursor, 0, c);
    field.replace(codes);
    this.#cursor++;
    this.#startHilite = this.#cursor;
  }

  #regularInput(c: number): void {
    const field = this.#active;
    if (!field) return;
    if (field.filter === 'numeric') {
      if (c >= 0x30 && c <= 0x39) this.#addChar(c);
      return;
    }
    if (this.#scheme.font.table.has(c)) this.#addChar(c);
  }

  input(event: UiInputEvent): boolean {
    if (!this.#active) return false;
    if (event.kind === 'text') {
      if (!this.#editing) return false;
      this.#deleteHilited();
      for (const c of codePoints(event.text)) this.#regularInput(c);
      return true;
    }
    if (event.kind !== 'keyDown' && event.kind !== 'keyRepeat') return false;
    if (!this.#editing && event.key !== 'Tab') return false;
    const field = this.#active;
    switch (event.modifiers) {
      case 0:
        switch (event.key) {
          case 'Escape':
            return false;
          case 'Enter':
            this.#play('REMOVING_TEXT');
            return false;
          case 'Tab':
            this.#selectNext(1);
            return true;
          case 'ArrowLeft':
            if (this.#cursor !== 0) this.#cursor--;
            this.#startHilite = this.#cursor;
            return true;
          case 'ArrowRight':
            if (this.#cursor < field.length) this.#cursor++;
            this.#startHilite = this.#cursor;
            return true;
          case 'End':
            this.#cursor = field.length;
            this.#startHilite = this.#cursor;
            return true;
          case 'Home':
            this.#cursor = 0;
            this.#startHilite = 0;
            return true;
          case 'Delete':
            if (this.#startHilite !== this.#cursor) this.#deleteHilited();
            else if (this.#cursor < field.length) this.#removeChars(this.#cursor, 1);
            else return true;
            break;
          case 'Backspace':
            if (this.#startHilite !== this.#cursor) this.#deleteHilited();
            else if (this.#cursor > 0) {
              this.#cursor--;
              this.#startHilite = this.#cursor;
              this.#removeChars(this.#cursor, 1);
            } else return true;
            break;
          default:
            return true;
        }
        break;
      case KeyModifier.SHIFT:
        switch (event.key) {
          case 'Tab':
            this.#selectNext(-1);
            return true;
          case 'ArrowLeft':
            if (this.#cursor !== 0) this.#cursor--;
            return true;
          case 'ArrowRight':
            if (this.#cursor < field.length) this.#cursor++;
            return true;
          case 'End':
            this.#cursor = field.length;
            return true;
          case 'Home':
            this.#cursor = 0;
            return true;
          default:
            return true;
        }
      case KeyModifier.CTRL:
        if (event.key !== 'Delete') return false;
        this.#startHilite = 0;
        this.#cursor = field.length;
        this.#deleteHilited();
        break;
      default:
        return false;
    }
    this.#play('ENTERING_TEXT');
    return true;
  }

  #background(list: DrawList, field: TextField): void {
    const r = field.region;
    const scheme = this.#scheme;
    if (scheme.bevel) {
      list.fill(r.x1, r.y1, r.x2, r.y2, scheme.bevel.darker);
      list.fill(r.x1 + 1, r.y1 + 1, r.x2, r.y2, scheme.bevel.brighter);
    }
    list.fill(r.x1 + 1, r.y1 + 1, r.x2 - 1, r.y2 - 1, scheme.fieldColor);
  }

  #textY(field: TextField): number {
    const r = field.region;
    return r.y1 + idiv(r.y2 - r.y1 - fontHeight(this.#scheme.font), 2);
  }

  render(list: DrawList, ja2Now: number): void {
    for (const field of this.#fields) {
      if (field === this.#active) this.#renderActive(list, field, ja2Now);
      else this.#renderInactive(list, field);
    }
  }

  #renderInactive(list: DrawList, field: TextField): void {
    const scheme = this.#scheme;
    this.#background(list, field);
    mprint(list, scheme.font, field.region.x1 + TEXT_INSET, this.#textY(field), field.text, {
      foreground: scheme.foreground,
      shadow: scheme.shadow,
      background: FontColor.MCOLOR_BLACK,
    });
  }

  #renderActive(list: DrawList, field: TextField, ja2Now: number): void {
    const scheme = this.#scheme;
    this.#background(list, field);
    const y = this.#textY(field);
    const [start, end] = this.selection;
    let x = field.region.x1 + TEXT_INSET;
    if (start !== end) {
      field.codes.forEach((c, i) => {
        const hilited = start <= i && i < end;
        const colors = hilited
          ? { foreground: scheme.hiForeground, shadow: scheme.hiShadow, background: scheme.hiBackground }
          : { foreground: scheme.foreground, shadow: scheme.shadow, background: FontColor.MCOLOR_BLACK };
        x += mprint(list, scheme.font, x, y, String.fromCodePoint(c), colors);
      });
    } else
      mprint(list, scheme.font, x, y, field.text, {
        foreground: scheme.foreground,
        shadow: scheme.shadow,
        background: FontColor.MCOLOR_BLACK,
      });
    if (this.#editing && ja2Now % BLINK_PERIOD < TEXT_CURSOR_BLINK_INTERVAL) {
      let cx = field.region.x1 + CARET_INSET;
      for (let i = 0; i < this.#cursor; i++) cx += charWidth(scheme.font, field.codes[i] ?? 0);
      list.fill(cx, y, cx + 1, y + fontHeight(scheme.font), scheme.cursorColor);
    }
  }

  describe(): WidgetInfo[] {
    return this.#fields.map((field) => {
      const r = field.region;
      return {
        id: field.id,
        kind: 'textField',
        rect: widgetRect(r.x1, r.y1, r.width, r.height),
        visible: true,
        enabled: field.enabled,
        state: field === this.#active ? (this.#editing ? 'editing' : 'active') : 'inactive',
        text: field.text,
        frame: null,
      };
    });
  }
}
