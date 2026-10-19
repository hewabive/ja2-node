// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/MercTextBox.cc PrepareMercPopupBox (the size from the text, the margins and the icons, capped at
// @src 349×199; the border tiled every 10 pixels; the text with IanDisplayWrappedString in FONT12ARIAL, gap 2),
// @src GetMercPopupBoxFontColors, RenderMercPopUpBox, TEXT_POPUP_* and MERC_* defines; src/game/Utils/MercTextBox.h
// @src MercPopUpBackground, MercPopUpBorder, MercPopupBoxFlags. See docs/28 §3.6.

import { DEFAULT_SHADOW, FontColor, NO_SHADOW } from '../../content/text/font-colors.ts';
import { u16 } from '../../core/int.ts';
import type { AssetKey, DrawList, FontColors } from '../draw-list.ts';
import type { BitmapFont } from '../text/bitmap-font.ts';
import { stringPixLength } from '../text/measure.ts';
import { withClip } from '../text/print.ts';
import { cleanOutControlCodes, ianDisplayWrappedString, ianWrappedStringHeight } from '../text/wrap.ts';

export const MercPopupBackground = { BASIC: 0, WHITE: 1, GREY: 2, DIALOG: 3, LAPTOP: 4, IMP: 5 } as const;
export const MercPopupBorder = { BASIC: 0, RED: 1, BLUE: 2, DIALOG: 3, LAPTOP: 4 } as const;

export const TEXT_POPUP_GAP_BN_LINES = 10;
export const MERC_TEXT_MIN_WIDTH = 10;
export const TEXT_OFFSET_X = 10;
export const TEXT_OFFSET_Y = 10;
export const MERC_BACKGROUND_WIDTH = 350;
export const MERC_BACKGROUND_HEIGHT = 200;
const TEXT_GAP = 2;
const ICON_MIN_HEIGHT = 45;
const ICON_WIDTH = 35;
const ICON_TEXT_SHIFT = 30;
const STOP_ICON_X = 5;
const SKULL_ICON_X = 9;
const ICON_Y = 4;
const SIDE_PIECE = 4;
const BOTTOM_PIECE_OFFSET = 6;
const TEXT_COLOR = FontColor.MCOLOR_WHITE;
const DARK_TEXT = 2;

export const BorderPiece = { TOP_LEFT: 0, TOP: 1, TOP_RIGHT: 2, LEFT: 3, RIGHT: 4, BOTTOM_LEFT: 5, BOTTOM: 6, BOTTOM_RIGHT: 7 } as const;

export type MercIcon = 'none' | 'stop' | 'skull';

export interface MercTextBoxArt {
  readonly background: AssetKey;
  readonly border: AssetKey;
  readonly backgroundIndex: number;
  readonly stopIcon?: AssetKey;
  readonly skullIcon?: AssetKey;
}

export interface MercTextBoxRequest {
  readonly text: string;
  readonly width: number;
  readonly marginX: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  readonly icon?: MercIcon;
  readonly transparent?: boolean;
}

export interface MercTextBoxFonts {
  readonly text: BitmapFont;
  readonly bold: BitmapFont;
}

export function mercTextColors(backgroundIndex: number): FontColors {
  switch (backgroundIndex) {
    case MercPopupBackground.WHITE:
      return { foreground: DARK_TEXT, shadow: FontColor.MCOLOR_WHITE, background: FontColor.MCOLOR_BLACK };
    case MercPopupBackground.GREY:
      return { foreground: DARK_TEXT, shadow: NO_SHADOW, background: FontColor.MCOLOR_BLACK };
    default:
      return { foreground: TEXT_COLOR, shadow: DEFAULT_SHADOW, background: FontColor.MCOLOR_BLACK };
  }
}

export class MercTextBox {
  readonly art: MercTextBoxArt;
  readonly request: MercTextBoxRequest;
  readonly fonts: MercTextBoxFonts;
  readonly width: number;
  readonly height: number;
  readonly textWidth: number;

  constructor(art: MercTextBoxArt, request: MercTextBoxRequest, fonts: MercTextBoxFonts) {
    this.art = art;
    this.request = request;
    this.fonts = fonts;
    let width = request.width <= MERC_TEXT_MIN_WIDTH ? MERC_TEXT_MIN_WIDTH : request.width;
    const length = stringPixLength(cleanOutControlCodes(request.text), fonts.text);
    let textWidth: number;
    if (length < width - TEXT_OFFSET_X * 2) {
      width = length + TEXT_OFFSET_X * 2;
      textWidth = u16(width - TEXT_OFFSET_X * 2 + 1);
    } else textWidth = u16(width - TEXT_OFFSET_X * 2 + 1 - request.marginX);
    let height = ianWrappedStringHeight(textWidth, TEXT_GAP, fonts.text, request.text, fonts.bold) + TEXT_OFFSET_Y * 2;
    height += request.marginTop + request.marginBottom;
    width += request.marginX * 2;
    if (this.#hasIcon) {
      if (height < ICON_MIN_HEIGHT) height = ICON_MIN_HEIGHT;
      width += ICON_WIDTH;
    }
    if (width >= MERC_BACKGROUND_WIDTH) width = MERC_BACKGROUND_WIDTH - 1;
    if (height >= MERC_BACKGROUND_HEIGHT) height = MERC_BACKGROUND_HEIGHT - 1;
    this.width = width;
    this.height = height;
    this.textWidth = textWidth;
  }

  get #hasIcon(): boolean {
    return (this.request.icon ?? 'none') !== 'none';
  }

  render(list: DrawList, x: number, y: number): void {
    const { width: w, height: h, art } = this;
    withClip(list, { x, y, width: w, height: h }, () => {
      if (!this.request.transparent) list.image(art.background, 0, x, y);
      for (let i = TEXT_POPUP_GAP_BN_LINES; i < w - TEXT_POPUP_GAP_BN_LINES; i += TEXT_POPUP_GAP_BN_LINES) {
        list.image(art.border, BorderPiece.TOP, x + i, y);
        list.image(art.border, BorderPiece.BOTTOM, x + i, y + h - TEXT_POPUP_GAP_BN_LINES + BOTTOM_PIECE_OFFSET);
      }
      for (let i = TEXT_POPUP_GAP_BN_LINES; i < h - TEXT_POPUP_GAP_BN_LINES; i += TEXT_POPUP_GAP_BN_LINES) {
        list.image(art.border, BorderPiece.LEFT, x, y + i);
        list.image(art.border, BorderPiece.RIGHT, x + w - SIDE_PIECE, y + i);
      }
      list.image(art.border, BorderPiece.TOP_LEFT, x, y);
      list.image(art.border, BorderPiece.TOP_RIGHT, x + w - TEXT_POPUP_GAP_BN_LINES, y);
      list.image(art.border, BorderPiece.BOTTOM_LEFT, x, y + h - TEXT_POPUP_GAP_BN_LINES);
      list.image(art.border, BorderPiece.BOTTOM_RIGHT, x + w - TEXT_POPUP_GAP_BN_LINES, y + h - TEXT_POPUP_GAP_BN_LINES);
      if (this.request.icon === 'stop' && art.stopIcon) list.image(art.stopIcon, 0, x + STOP_ICON_X, y + ICON_Y);
      if (this.request.icon === 'skull' && art.skullIcon) list.image(art.skullIcon, 0, x + SKULL_ICON_X, y + ICON_Y);
      const textX = TEXT_OFFSET_X + this.request.marginX + (this.#hasIcon ? ICON_TEXT_SHIFT : 0);
      ianDisplayWrappedString(
        list,
        x + textX,
        y + TEXT_OFFSET_Y + this.request.marginTop,
        this.textWidth,
        TEXT_GAP,
        this.fonts.text,
        mercTextColors(art.backgroundIndex),
        this.request.text,
        { bold: this.fonts.bold },
      );
    });
  }
}
