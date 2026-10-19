// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/MessageBoxScreen.cc DoMessageBox (the box 300 wide with margins 40/10/30, centred on the screen or a
// @src rectangle, the full-screen MSYS_PRIORITY_HIGHEST back region with the style's cursor, the button sets and their
// @src positions, the game paused and the UI timers stopped), ExitMsgBox, MessageBoxScreenHandle (the keys on KEY_UP),
// @src g_msg_box_style, MSGBOX_* defines; src/game/MessageBoxScreen.h MessageBoxFlags, MessageBoxReturnValue,
// @src MessageBoxStyleID; src/game/Utils/Text.h MSG_OK, MSG_YES, MSG_NO, MSG_REHIRE, MSG_LIE, MSG_SKIP. See docs/28 §3.6.

import { idiv } from '../../core/int.ts';
import type { AssetKey, DrawList } from '../draw-list.ts';
import { isPointerEvent, type UiInputEvent } from '../input/events.ts';
import { ANY_MODIFIERS, findHotkey, type Hotkey, type HotkeyTable } from '../input/hotkeys.ts';
import { MouseReason, Priority } from '../input/mouse.ts';
import type { MouseRegion } from '../input/regions.ts';
import type { Modal } from '../screen.ts';
import type { UiServices } from '../services.ts';
import { FontName } from '../text/fonts.ts';
import type { UiTextService } from '../text/text-service.ts';
import { type Button, NO_IMAGE } from './button.ts';
import { UiScreenKind } from './button-sounds.ts';
import { MercTextBox, type MercTextBoxArt } from './merc-text-box.ts';
import { type WidgetInfo, widgetRect } from './widget-info.ts';

export const MSGBOX_DEFAULT_WIDTH = 300;
export const MSGBOX_BUTTON_WIDTH = 61;
export const MSGBOX_BUTTON_HEIGHT = 20;
export const MSGBOX_BUTTON_X_SEP = 15;
export const MSGBOX_SMALL_BUTTON_WIDTH = 31;
export const MSGBOX_SMALL_BUTTON_X_SEP = 8;
const MARGIN_X = 40;
const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 30;
const BUTTON_BOTTOM_GAP = 10;
const NUMBERED_BUTTONS = 4;

export const MessageBoxFlag = {
  OK: 0,
  YESNO: 1,
  FOUR_NUMBERED_BUTTONS: 2,
  OKCONTRACT: 3,
  YESNOLIE: 4,
  CONTINUESTOP: 5,
  OKSKIP: 6,
  GENERICCONTRACT: 7,
  GENERIC: 8,
} as const;
export type MessageBoxFlag = (typeof MessageBoxFlag)[keyof typeof MessageBoxFlag];

export const MessageBoxReturn = { NONE: 0, OK: 1, YES: 2, NO: 3, CONTRACT: 4, LIE: 5, ONE: 1, TWO: 2, THREE: 3, FOUR: 4 } as const;

export const MessageBoxStyleId = { BASIC: 0, RED_ON_WHITE: 1, BLUE_ON_GREY: 2, BASIC_SMALL_BUTTONS: 3, IMP: 4, LAPTOP_DEFAULT: 5 } as const;

export const MessageString = { OK: 1, YES: 2, NO: 3, REHIRE: 5, LIE: 6, SKIP: 61 } as const;
export const MESSAGE_STRINGS = 'pMessageStrings';
export const UPDATE_PANEL_BUTTONS = 'pUpdatePanelButtons';

export interface MessageBoxStyle {
  readonly textBox: MercTextBoxArt;
  readonly buttons: AssetKey;
  readonly buttonOff: number;
  readonly buttonOn: number;
  readonly fontColor: number;
  readonly shadowColor: number;
  readonly cursor: number;
}

export interface MessageBoxLabels {
  readonly ok: string;
  readonly yes: string;
  readonly no: string;
  readonly rehire: string;
  readonly lie: string;
  readonly skip: string;
  readonly continue: string;
  readonly stop: string;
  readonly user1?: string;
  readonly user2?: string;
}

export interface MessageBoxRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MessageBoxOptions {
  readonly style: MessageBoxStyle;
  readonly text: string;
  readonly flags: MessageBoxFlag;
  readonly labels: MessageBoxLabels;
  readonly centeringRect?: MessageBoxRect;
  readonly onClose?: (result: number) => void;
  readonly id?: string;
}

export function messageBoxLabels(text: UiTextService): MessageBoxLabels {
  const message = (index: number) => text.string(MESSAGE_STRINGS, index) ?? '';
  return {
    ok: message(MessageString.OK),
    yes: message(MessageString.YES),
    no: message(MessageString.NO),
    rehire: message(MessageString.REHIRE),
    lie: message(MessageString.LIE),
    skip: message(MessageString.SKIP),
    continue: text.string(UPDATE_PANEL_BUTTONS, 0) ?? '',
    stop: text.string(UPDATE_PANEL_BUTTONS, 1) ?? '',
  };
}

interface ButtonPlan {
  readonly label: string;
  readonly result: number;
  readonly suffix: string;
}

const up = (key: string, result: number): Hotkey => ({ key, on: 'up', mods: ANY_MODIFIERS, action: 'close', args: [result] });

export const MESSAGE_BOX_HOTKEYS: Readonly<Partial<Record<MessageBoxFlag, HotkeyTable>>> = {
  [MessageBoxFlag.YESNO]: [
    up('n', MessageBoxReturn.NO),
    up('Escape', MessageBoxReturn.NO),
    up('y', MessageBoxReturn.YES),
    up('Enter', MessageBoxReturn.YES),
  ],
  [MessageBoxFlag.OK]: [up('o', MessageBoxReturn.OK), up('Enter', MessageBoxReturn.OK)],
  [MessageBoxFlag.CONTINUESTOP]: [up('Enter', MessageBoxReturn.OK)],
  [MessageBoxFlag.FOUR_NUMBERED_BUTTONS]: [
    up('1', MessageBoxReturn.ONE),
    up('2', MessageBoxReturn.TWO),
    up('3', MessageBoxReturn.THREE),
    up('4', MessageBoxReturn.FOUR),
  ],
};

export class MessageBox implements Modal {
  readonly id: string;
  readonly freezesScreen = true;
  readonly rendersTooltips = false;
  readonly soundScreen = UiScreenKind.MSG_BOX;
  readonly #services: UiServices;
  readonly #options: MessageBoxOptions;
  readonly #owner = {};
  #box: MercTextBox | null = null;
  #x = 0;
  #y = 0;
  #back: MouseRegion | null = null;
  #buttons: Button[] = [];
  #handled: number = MessageBoxReturn.NONE;
  #closed = false;

  constructor(services: UiServices, options: MessageBoxOptions) {
    this.#services = services;
    this.#options = options;
    this.id = options.id ?? 'messageBox';
  }

  get result(): number {
    return this.#handled;
  }

  get box(): { x: number; y: number; width: number; height: number } {
    return { x: this.#x, y: this.#y, width: this.#box?.width ?? 0, height: this.#box?.height ?? 0 };
  }

  enter(): void {
    const services = this.#services;
    const { style, text, centeringRect } = this.#options;
    const fonts = { text: services.fonts.get(FontName.FONT12ARIAL), bold: services.fonts.get(FontName.FONT10ARIALBOLD) };
    const box = new MercTextBox(
      style.textBox,
      { text, width: MSGBOX_DEFAULT_WIDTH, marginX: MARGIN_X, marginTop: MARGIN_TOP, marginBottom: MARGIN_BOTTOM },
      fonts,
    );
    this.#box = box;
    const geometry = services.geometry();
    const rect = centeringRect ?? { x: 0, y: 0, width: geometry.width, height: geometry.height };
    this.#x = rect.x + idiv(rect.width - box.width, 2);
    this.#y = rect.y + idiv(rect.height - box.height, 2);
    this.#back = services.regions.define({
      x1: 0,
      y1: 0,
      x2: geometry.width,
      y2: geometry.height,
      priority: Priority.HIGHEST,
      cursor: style.cursor,
      owner: this.#owner,
      id: `${this.id}.back`,
    });
    this.#createButtons(box);
    services.clock.pause();
    services.pauseGame?.(true);
  }

  #plans(): { plans: ButtonPlan[]; dx: number; x: number } {
    const { flags, labels } = this.#options;
    const box = this.#box as MercTextBox;
    const dx = MSGBOX_BUTTON_WIDTH + MSGBOX_BUTTON_X_SEP;
    const two = this.#x + idiv(box.width - (MSGBOX_BUTTON_WIDTH + dx), 2);
    const three = this.#x + idiv(box.width - (MSGBOX_BUTTON_WIDTH + dx * 2), 2);
    switch (flags) {
      case MessageBoxFlag.FOUR_NUMBERED_BUTTONS: {
        const small = MSGBOX_SMALL_BUTTON_WIDTH + MSGBOX_SMALL_BUTTON_X_SEP;
        const plans = Array.from({ length: NUMBERED_BUTTONS }, (_, i) => ({ label: String(i + 1), result: i + 1, suffix: String(i + 1) }));
        return { plans, dx: small, x: this.#x + idiv(box.width - (MSGBOX_SMALL_BUTTON_WIDTH + small * 3), 2) };
      }
      case MessageBoxFlag.OK: {
        const width = this.#services.buttons.imageSize(this.#image()).width;
        return { plans: [{ label: labels.ok, result: MessageBoxReturn.OK, suffix: 'ok' }], dx, x: this.#x + idiv(box.width - width, 2) };
      }
      case MessageBoxFlag.YESNO:
        return { plans: [this.#yes(labels.yes), this.#no(labels.no)], dx, x: two };
      case MessageBoxFlag.CONTINUESTOP:
        return { plans: [this.#yes(labels.continue), this.#no(labels.stop)], dx, x: two };
      case MessageBoxFlag.OKCONTRACT:
        return { plans: [this.#yes(labels.ok), { label: labels.rehire, result: MessageBoxReturn.CONTRACT, suffix: 'no' }], dx, x: two };
      case MessageBoxFlag.GENERICCONTRACT:
        return {
          plans: [
            this.#yes(labels.user1 ?? ''),
            this.#no(labels.user2 ?? ''),
            { label: labels.rehire, result: MessageBoxReturn.CONTRACT, suffix: 'ok' },
          ],
          dx,
          x: three,
        };
      case MessageBoxFlag.GENERIC:
        return { plans: [this.#yes(labels.user1 ?? ''), this.#no(labels.user2 ?? '')], dx, x: two };
      case MessageBoxFlag.YESNOLIE:
        return {
          plans: [this.#yes(labels.yes), this.#no(labels.no), { label: labels.lie, result: MessageBoxReturn.LIE, suffix: 'ok' }],
          dx,
          x: three,
        };
      case MessageBoxFlag.OKSKIP:
        return { plans: [this.#yes(labels.ok), this.#no(labels.skip)], dx, x: two };
    }
  }

  #yes(label: string): ButtonPlan {
    return { label, result: MessageBoxReturn.YES, suffix: 'yes' };
  }

  #no(label: string): ButtonPlan {
    return { label, result: MessageBoxReturn.NO, suffix: 'no' };
  }

  #image() {
    const style = this.#options.style;
    return {
      asset: style.buttons,
      grayed: NO_IMAGE,
      offNormal: style.buttonOff,
      offHilite: NO_IMAGE,
      onNormal: style.buttonOn,
      onHilite: NO_IMAGE,
    };
  }

  #createButtons(box: MercTextBox): void {
    const { style } = this.#options;
    const services = this.#services;
    const y = this.#y + box.height - MSGBOX_BUTTON_HEIGHT - BUTTON_BOTTOM_GAP;
    const { plans, dx, x } = this.#plans();
    const font = services.fonts.get(FontName.FONT12ARIAL);
    this.#buttons = plans.map((plan, i) => {
      const button = services.buttons.create({
        x: x + dx * i,
        y,
        image: this.#image(),
        priority: Priority.HIGHEST,
        owner: this.#owner,
        id: `${this.id}.${plan.suffix}`,
        text: {
          text: plan.label,
          font,
          color: style.fontColor,
          shadow: style.shadowColor,
          downColor: style.fontColor,
          downShadow: style.shadowColor,
        },
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) this.#handled = plan.result;
        },
      });
      button.setCursor(style.cursor);
      return button;
    });
  }

  exit(): void {
    const services = this.#services;
    services.buttons.removeOwner(this.#owner);
    this.#back?.remove();
    this.#back = null;
    this.#buttons = [];
    services.clock.resume();
    services.pauseGame?.(false);
  }

  update(): void {
    if (this.#handled === MessageBoxReturn.NONE || this.#closed) return;
    this.#closed = true;
    this.#services.host.closeModal(this);
    this.#options.onClose?.(this.#handled);
  }

  input(event: UiInputEvent): boolean {
    if (isPointerEvent(event)) return false;
    if (event.kind === 'text' || this.#handled !== MessageBoxReturn.NONE) return true;
    const hotkey = findHotkey(MESSAGE_BOX_HOTKEYS[this.#options.flags] ?? [], event);
    if (hotkey) this.#handled = hotkey.args?.[0] ?? MessageBoxReturn.NONE;
    return true;
  }

  render(list: DrawList): void {
    this.#box?.render(list, this.#x, this.#y);
    this.#services.buttons.render(list, this.#owner);
  }

  describe(): WidgetInfo[] {
    const box = this.#box;
    return [
      {
        id: this.id,
        kind: 'messageBox',
        rect: widgetRect(this.#x, this.#y, box?.width ?? 0, box?.height ?? 0),
        visible: true,
        enabled: true,
        state: this.#options.flags,
        text: this.#options.text,
        frame: null,
      },
      ...this.#buttons.map((b) => b.describe()),
    ];
  }
}
