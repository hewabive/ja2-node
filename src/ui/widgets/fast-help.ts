// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc SetUpFastHelpRegion, HandleShowingOfTacticalInterfaceFastHelpText,
// @src (PauseGame while it is up), DisplayUserDefineHelpTextRegions (the box 14 pixels wider than the text and 14 taller,
// @src three quarters of its height above the point, kept on the screen; two outlines, the inside shadowed twice, the
// @src text in FONT10ARIAL beige),
// @src SetUpShutDownMapScreenHelpTextScreenMask and MapScreenHelpTextScreenMaskBtnCallback (a mask over the whole screen
// @src at MSYS_PRIORITY_HIGHEST that any button release ends it on); src/game/Tactical/Turn_Based_Input.cc
// @src GetKeyboardInput (every key taken while it is up, a key release ends it).

import { DEFAULT_SHADOW, FontColor } from '../../content/text/font-colors.ts';
import { idiv } from '../../core/int.ts';
import { type DrawList, rgb } from '../draw-list.ts';
import type { UiInputEvent } from '../input/events.ts';
import { MouseReason, NO_CURSOR, Priority } from '../input/mouse.ts';
import type { MouseRegion } from '../input/regions.ts';
import type { UiServices } from '../services.ts';
import type { BitmapFont } from '../text/bitmap-font.ts';
import { displayWrappedString, ianWrappedStringHeight, TextFlag } from '../text/wrap.ts';

const OWNER = 'fastHelp';
const BORDER = 14;
const TEXT_DX = 10;
const TEXT_DY = 6;
const RIGHT_MARGIN = 4;
const BOTTOM_MARGIN = 15;
const OUTER_LINE = rgb(65, 57, 15);
const INNER_LINE = rgb(227, 198, 88);
const ANY_BUTTON_UP =
  MouseReason.LBUTTON_UP | MouseReason.RBUTTON_UP | MouseReason.MBUTTON_UP | MouseReason.X1BUTTON_UP | MouseReason.X2BUTTON_UP;

export interface FastHelpText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface FastHelpFonts {
  readonly text: BitmapFont;
  readonly bold: BitmapFont;
}

export class FastHelp {
  readonly #services: UiServices;
  readonly #fonts: () => FastHelpFonts;
  #shown: FastHelpText | null = null;
  #mask: MouseRegion | null = null;

  constructor(services: UiServices, fonts: () => FastHelpFonts) {
    this.#services = services;
    this.#fonts = fonts;
  }

  get shown(): FastHelpText | null {
    return this.#shown;
  }

  show(help: FastHelpText): void {
    if (!this.#shown) this.#services.pauseGame?.(true);
    this.#shown = help;
    this.#mask ??= this.#services.regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority: Priority.HIGHEST,
      cursor: NO_CURSOR,
      owner: OWNER,
      id: 'fastHelpMask',
      onButton: (_r, reason) => {
        if (reason & ANY_BUTTON_UP) this.close();
      },
    });
  }

  close(): void {
    if (!this.#shown) return;
    this.#shown = null;
    this.#mask?.remove();
    this.#mask = null;
    this.#services.pauseGame?.(false);
  }

  keyInput(event: UiInputEvent): boolean {
    if (!this.#shown || (event.kind !== 'keyDown' && event.kind !== 'keyUp' && event.kind !== 'text')) return false;
    if (event.kind === 'keyUp') this.close();
    return true;
  }

  render(list: DrawList): void {
    const help = this.#shown;
    if (!help) return;
    const fonts = this.#fonts();
    const { width: screenWidth, height: screenHeight } = this.#services.geometry();
    const w = help.width + BORDER;
    const h = ianWrappedStringHeight(help.width, 0, fonts.text, help.text, fonts.bold) + BORDER;
    let x = Math.max(0, help.x);
    if (help.x + w >= screenWidth) x = screenWidth - w - RIGHT_MARGIN;
    let y = Math.max(0, help.y - idiv(h * 3, 4));
    if (y + h >= screenHeight) y = screenHeight - h - BOTTOM_MARGIN;
    list.rectangle(x + 1, y + 1, x + w - 1, y + h - 1, OUTER_LINE);
    list.rectangle(x, y, x + w - 2, y + h - 2, INNER_LINE);
    list.shadow(x + 2, y + 2, x + w - 3, y + h - 3);
    list.shadow(x + 2, y + 2, x + w - 3, y + h - 3);
    const colors = { foreground: FontColor.BEIGE, shadow: DEFAULT_SHADOW, background: FontColor.NEARBLACK };
    displayWrappedString(list, x + TEXT_DX, y + TEXT_DY, help.width, 0, fonts.text, colors, help.text, TextFlag.LEFT_JUSTIFIED);
  }
}
