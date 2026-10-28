// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/PopUpBox.cc DrawBox (the background cropped to the box, 2×2 corners, 16×2 and 2×8 edge pieces with
// @src an overlapping last piece), DrawBoxText (line colours highlight > secondary shade > shade > normal, the second
// @src column, centring), ResizeBoxToText, BORDER_WIDTH, BORDER_HEIGHT and the piece indices; src/game/Strategic/Assignments.cc
// @src CreateDestroyMouseRegionsForAssignmentMenu, AssignmentMenuMvtCallBack, CreateDestroyScreenMaskForAssignmentAndContractMenus,
// @src AssignmentScreenMaskBtnCallback (one region per line at MSYS_PRIORITY_HIGHEST - 4 over a screen mask that closes the
// @src menu on a release).

import { DEFAULT_SHADOW, FontColor } from '../../content/text/font-colors.ts';
import { idiv } from '../../core/int.ts';
import type { AssetKey, DrawList } from '../draw-list.ts';
import { MouseReason, NO_CURSOR, Priority } from '../input/mouse.ts';
import type { MouseRegion, RegionDispatcher } from '../input/regions.ts';
import { type BitmapFont, fontHeight } from '../text/bitmap-font.ts';
import { hCenterVCenterAlign, stringPixLength } from '../text/measure.ts';
import { mprint, withClip } from '../text/print.ts';
import { type WidgetInfo, widgetRect } from './widget-info.ts';

export const PopupPiece = {
  TOP_LEFT: 0,
  TOP_RIGHT: 1,
  BOTTOM_LEFT: 2,
  BOTTOM_RIGHT: 3,
  TOP_EDGE: 4,
  BOTTOM_EDGE: 4,
  SIDE_EDGE: 5,
} as const;
export const POPUP_BORDER_PIECES: readonly number[] = [0, 1, 2, 3, 4, 5];
export const POPUP_BORDER_WIDTH = 16;
export const POPUP_BORDER_HEIGHT = 8;
export const POPUP_MENU_PRIORITY = Priority.HIGHEST - 4;
const CORNER = 2;
const ANY_BUTTON_UP =
  MouseReason.LBUTTON_UP | MouseReason.RBUTTON_UP | MouseReason.MBUTTON_UP | MouseReason.X1BUTTON_UP | MouseReason.X2BUTTON_UP;

export type LineShade = 'none' | 'shade' | 'secondary';

export interface PopupColors {
  readonly foreground: number;
  readonly background: number;
  readonly highlight: number;
  readonly shade: number;
  readonly secondaryShade: number;
}

export interface PopupLine {
  readonly text: string;
  readonly second?: string;
  readonly shade?: LineShade;
  readonly foreground?: number;
}

export interface PopupBoxStyle {
  readonly border: AssetKey;
  readonly background: AssetKey;
  readonly font: BitmapFont;
  readonly marginLeft: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  readonly marginRight: number;
  readonly lineSpace: number;
  readonly colors: PopupColors;
  readonly secondColors?: PopupColors;
  readonly shadow?: number;
  readonly centerText?: boolean;
  readonly resize?: boolean;
  readonly minWidth?: number;
  readonly secondColumnMinOffset?: number;
}

export const DEFAULT_POPUP_COLORS: PopupColors = {
  foreground: FontColor.LTGREEN,
  background: FontColor.BLACK,
  highlight: FontColor.WHITE,
  shade: FontColor.GRAY7,
  secondaryShade: FontColor.YELLOW,
};

export class PopupBox {
  x: number;
  y: number;
  width: number;
  height: number;
  readonly style: PopupBoxStyle;
  lines: PopupLine[] = [];
  highlighted = -1;
  secondColumnOffset = 0;

  constructor(style: PopupBoxStyle, x: number, y: number, width = 0, height = 0) {
    this.style = style;
    this.x = x;
    this.y = y;
    this.width = Math.max(width, style.minWidth ?? 0);
    this.height = height;
  }

  setLines(lines: readonly PopupLine[]): void {
    this.lines = [...lines];
    if (this.style.resize) this.resizeToText();
  }

  get lineStep(): number {
    return this.style.lineSpace + fontHeight(this.style.font);
  }

  resizeToText(): void {
    const font = this.style.font;
    let left = 0;
    let right = 0;
    for (const line of this.lines) {
      left = Math.max(left, stringPixLength(line.text, font));
      if (line.second !== undefined) right = Math.max(right, stringPixLength(line.second, font));
    }
    this.secondColumnOffset = left + (this.style.secondColumnMinOffset ?? 0);
    this.width = Math.max(this.style.marginLeft + this.secondColumnOffset + right + this.style.marginRight, this.style.minWidth ?? 0);
    this.height = this.style.marginTop + this.lines.length * (fontHeight(font) + this.style.lineSpace) + this.style.marginBottom;
  }

  draw(list: DrawList): void {
    this.#drawBox(list);
    this.#drawText(list);
  }

  #drawBox(list: DrawList): void {
    const { x, y, width: w, height: h } = this;
    const border = this.style.border;
    const tilesWide = idiv(w - 4, POPUP_BORDER_WIDTH);
    const tilesHigh = idiv(h - 4, POPUP_BORDER_HEIGHT);
    withClip(list, { x, y, width: w, height: h }, () => list.image(this.style.background, 0, x, y));
    list.image(border, PopupPiece.TOP_LEFT, x, y);
    list.image(border, PopupPiece.TOP_RIGHT, x + w - CORNER, y);
    list.image(border, PopupPiece.BOTTOM_RIGHT, x + w - CORNER, y + h - CORNER);
    list.image(border, PopupPiece.BOTTOM_LEFT, x, y + h - CORNER);
    if (tilesWide > 0) {
      for (let i = 0; i < tilesWide; i++) {
        const lx = x + CORNER + i * POPUP_BORDER_WIDTH;
        list.image(border, PopupPiece.TOP_EDGE, lx, y);
        list.image(border, PopupPiece.BOTTOM_EDGE, lx, y + h - CORNER);
      }
      const lx = x + w - CORNER - POPUP_BORDER_WIDTH;
      list.image(border, PopupPiece.TOP_EDGE, lx, y);
      list.image(border, PopupPiece.BOTTOM_EDGE, lx, y + h - CORNER);
    }
    if (tilesHigh > 0) {
      for (let i = 0; i < tilesHigh; i++) {
        const ly = y + CORNER + i * POPUP_BORDER_HEIGHT;
        list.image(border, PopupPiece.SIDE_EDGE, x, ly);
        list.image(border, PopupPiece.SIDE_EDGE, x + w - CORNER, ly);
      }
      const ly = y + h - CORNER - POPUP_BORDER_HEIGHT;
      list.image(border, PopupPiece.SIDE_EDGE, x, ly);
      list.image(border, PopupPiece.SIDE_EDGE, x + w - CORNER, ly);
    }
  }

  #foreground(index: number, line: PopupLine, colors: PopupColors): number {
    if (index === this.highlighted) return colors.highlight;
    if (line.shade === 'secondary') return colors.secondaryShade;
    if (line.shade === 'shade') return colors.shade;
    return line.foreground ?? colors.foreground;
  }

  #drawText(list: DrawList): void {
    const { style } = this;
    const font = style.font;
    const tlx = this.x + style.marginLeft;
    const tly = this.y + style.marginTop;
    const brx = this.x + this.width - style.marginRight;
    const bry = this.y + this.height - style.marginBottom;
    const w = this.width - (style.marginRight + style.marginLeft + 2);
    const h = fontHeight(font);
    const shadow = style.shadow ?? DEFAULT_SHADOW;
    withClip(list, { x: tlx - 1, y: tly, width: brx - tlx + 1, height: bry - tly }, () => {
      this.lines.forEach((line, i) => {
        const y = tly + i * (h + style.lineSpace);
        const colors = style.colors;
        const at = style.centerText ? hCenterVCenterAlign(tlx, y, w, h, line.text, font) : { x: tlx, y };
        mprint(list, font, at.x, at.y, line.text, { foreground: this.#foreground(i, line, colors), shadow, background: colors.background });
        if (line.second === undefined) return;
        const second = style.secondColors ?? colors;
        const at2 = style.centerText ? hCenterVCenterAlign(tlx, y, w, h, line.second, font) : { x: tlx + this.secondColumnOffset, y };
        mprint(list, font, at2.x, at2.y, line.second, { foreground: second.foreground, shadow, background: second.background });
      });
    });
  }
}

export interface PopupMenuOptions {
  readonly regions: RegionDispatcher;
  readonly onSelect: (line: number) => void;
  readonly onClose: () => void;
  readonly priority?: number;
  readonly owner?: unknown;
  readonly id?: string;
  readonly ignoreFirstRelease?: boolean;
}

export class PopupMenu {
  readonly box: PopupBox;
  readonly id: string;
  readonly #options: PopupMenuOptions;
  #mask: MouseRegion | null = null;
  #lines: MouseRegion[] = [];
  #ignoreRelease = false;

  constructor(box: PopupBox, options: PopupMenuOptions) {
    this.box = box;
    this.#options = options;
    this.id = options.id ?? 'popupMenu';
  }

  get open(): boolean {
    return this.#mask !== null;
  }

  show(): void {
    if (this.open) return;
    const { regions, owner } = this.#options;
    const priority = this.#options.priority ?? POPUP_MENU_PRIORITY;
    this.#ignoreRelease = this.#options.ignoreFirstRelease ?? false;
    this.box.highlighted = -1;
    this.#mask = regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority,
      cursor: NO_CURSOR,
      owner,
      id: `${this.id}.mask`,
      onButton: (_r, reason) => this.#maskButton(reason),
    });
    const step = this.box.lineStep;
    let y = this.box.y + this.box.style.marginTop;
    this.#lines = this.box.lines.map((_, i) => {
      const region = regions.define({
        x1: this.box.x,
        y1: y,
        x2: this.box.x + this.box.width,
        y2: y + step,
        priority,
        cursor: NO_CURSOR,
        owner,
        id: `${this.id}.line${i}`,
        onMove: (_r, reason) => this.#lineMove(i, reason),
        onButton: (_r, reason) => this.#lineButton(i, reason),
      });
      y += step;
      return region;
    });
  }

  hide(): void {
    this.#mask?.remove();
    for (const region of this.#lines) region.remove();
    this.#mask = null;
    this.#lines = [];
  }

  #maskButton(reason: number): void {
    if (!(reason & ANY_BUTTON_UP)) return;
    if (this.#ignoreRelease) {
      this.#ignoreRelease = false;
      return;
    }
    this.hide();
    this.#options.onClose();
  }

  #lineMove(line: number, reason: number): void {
    if (reason & MouseReason.GAIN_MOUSE) {
      if ((this.box.lines[line]?.shade ?? 'none') === 'none') this.box.highlighted = line;
    } else if (reason & MouseReason.LOST_MOUSE) this.box.highlighted = -1;
  }

  #lineButton(line: number, reason: number): void {
    if (reason & MouseReason.LBUTTON_UP) {
      if ((this.box.lines[line]?.shade ?? 'none') !== 'none') return;
      this.#options.onSelect(line);
    } else if (reason & MouseReason.RBUTTON_UP) {
      this.hide();
      this.#options.onClose();
    }
  }

  render(list: DrawList): void {
    if (this.open) this.box.draw(list);
  }

  describe(): WidgetInfo[] {
    const box = this.box;
    const lines = this.#lines.map((r, i) => ({
      id: `${this.id}.line${i}`,
      kind: 'popupLine',
      rect: widgetRect(r.x1, r.y1, r.width, r.height),
      visible: this.open,
      enabled: (box.lines[i]?.shade ?? 'none') === 'none',
      state: box.highlighted === i ? 'highlighted' : (box.lines[i]?.shade ?? 'none'),
      text: box.lines[i]?.text ?? null,
      frame: null,
    }));
    return [
      {
        id: this.id,
        kind: 'popupMenu',
        rect: widgetRect(box.x, box.y, box.width, box.height),
        visible: this.open,
        enabled: true,
        state: box.highlighted,
        text: null,
        frame: null,
      },
      ...lines,
    ];
  }
}
