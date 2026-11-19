// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-18. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc SaveGame (zSaveLoadText[SLG_SAVING_GAME_MESSAGE] in the basic merc popup box, 300 wide,
// @src centred on the screen at STD_SCREEN_Y + 160, while the game is written).

import { idiv } from '../../core/int.ts';
import type { DrawList } from '../draw-list.ts';
import type { UiInputEvent } from '../input/events.ts';
import type { Modal } from '../screen.ts';
import type { UiServices } from '../services.ts';
import { MercTextBox, type MercTextBoxArt, type MercTextBoxFonts } from '../widgets/merc-text-box.ts';
import { type WidgetInfo, widgetRect } from '../widgets/widget-info.ts';

export const SAVING_BOX = 'savingGame';
const WIDTH = 300;
const TOP = 160;

export class SavingBox implements Modal {
  readonly id = SAVING_BOX;
  readonly #services: UiServices;
  readonly #box: MercTextBox;
  readonly #text: string;

  constructor(services: UiServices, art: MercTextBoxArt, fonts: MercTextBoxFonts, text: string) {
    this.#services = services;
    this.#text = text;
    this.#box = new MercTextBox(art, { text, width: WIDTH, marginX: 0, marginTop: 0, marginBottom: 0, transparent: false }, fonts);
  }

  #at(): { readonly x: number; readonly y: number } {
    const g = this.#services.geometry();
    return { x: idiv(g.width - this.#box.width, 2), y: g.stdY + TOP };
  }

  enter(): void {}

  exit(): void {}

  update(): void {}

  input(_event: UiInputEvent): boolean {
    return true;
  }

  render(list: DrawList): void {
    const { x, y } = this.#at();
    this.#box.render(list, x, y);
  }

  describe(): readonly WidgetInfo[] {
    const { x, y } = this.#at();
    return [
      {
        id: SAVING_BOX,
        kind: 'messageBox',
        rect: widgetRect(x, y, this.#box.width, this.#box.height),
        visible: true,
        enabled: true,
        state: 'open',
        text: this.#text,
        frame: null,
      },
    ];
  }
}
