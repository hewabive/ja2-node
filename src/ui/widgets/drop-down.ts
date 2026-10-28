// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/BobbyRMailOrder.cc CreateDestroyBobbyRDropDown (the list regions, the arrows, the scroll area split
// @src in one region per entry, the close region under the list, the border of tactpopup.sti pieces, the black boxes),
// @src SelectDropDownRegionCallBack, SelectDropDownMovementCallBack (hovering a row selects it), DrawSelectedCity (the top
// @src clamp, the highlighted row, the row of the first entry when nothing is selected), SelectScrollAreaDropDownRegionCallBack,
// @src SelectScrollAreaDropDownMovementCallBack, SelectUpDownArrowOnScrollAreaRegionCallBack, DrawGoldRectangle,
// @src SelectActivateCityDroDownRegionCallBack, SelectCloseDroDownRegionCallBack.

import type { AssetKey, DrawList, RgbColor } from '../draw-list.ts';
import { MouseButtonMask, MouseReason, Priority } from '../input/mouse.ts';
import type { MouseRegion, RegionDispatcher } from '../input/regions.ts';
import { type BitmapFont, fontHeight } from '../text/bitmap-font.ts';
import { fontColors, mprint } from '../text/print.ts';
import { type WidgetInfo, widgetRect } from './widget-info.ts';

export const NO_SELECTION = -1;

export const BorderPiece = {
  TOP_LEFT: 0,
  TOP: 1,
  TOP_RIGHT: 2,
  LEFT: 3,
  RIGHT: 4,
  BOTTOM_LEFT: 5,
  BOTTOM: 6,
  BOTTOM_RIGHT: 7,
} as const;

export const DROP_DOWN_BORDER_PIECES: readonly number[] = Object.values(BorderPiece);
export const DROP_DOWN_ARROW_FRAMES: readonly number[] = [0, 1];

const BORDER_STEP = 10;
const RIGHT_EDGE = 4;
const BOTTOM_EDGE_LIFT = 6;
const ARROW_UP = 0;
const ARROW_DOWN = 1;
const ARROW_UP_FRAME = 1;
const ARROW_DOWN_FRAME = 0;
const THUMB_INSET = 5;
const THUMB_EDGE = 5;
const THUMB_FLOOR = 1;
const SCROLL_PAD = 8;
const PRESS = MouseReason.LBUTTON_UP | MouseReason.LBUTTON_REPEAT;

export interface DropDownModelOptions {
  readonly entries: number;
  readonly visible: number;
  readonly selectOnHover: boolean;
}

export class DropDown {
  readonly entries: number;
  readonly visible: number;
  readonly selectOnHover: boolean;
  open = false;
  selected = NO_SELECTION;
  top = 0;
  #changes = 0;

  constructor(options: DropDownModelOptions) {
    this.entries = options.entries;
    this.visible = Math.min(options.visible, options.entries);
    this.selectOnHover = options.selectOnHover;
  }

  get changes(): number {
    return this.#changes;
  }

  #select(index: number): void {
    if (index === this.selected) return;
    this.selected = index;
    this.#changes++;
  }

  reset(): void {
    this.open = false;
    this.top = 0;
    this.#select(NO_SELECTION);
  }

  toggle(): void {
    this.open = !this.open;
  }

  close(): void {
    this.open = false;
  }

  clampTop(): void {
    if (this.top + this.visible > this.entries) this.top = this.entries - this.visible - 1;
  }

  hover(row: number): void {
    if (this.selectOnHover) this.#select(row + this.top);
  }

  choose(row: number): void {
    this.#select(row + this.top);
    this.open = false;
  }

  stepDown(): void {
    if (this.selected < this.entries - 1) this.#select(this.selected + 1);
    if (this.selected - this.top >= this.visible) this.top++;
  }

  stepUp(): void {
    if (this.selected === NO_SELECTION) return;
    if (this.selected > 0) this.#select(this.selected - 1);
    if (this.selected < this.top) this.top--;
  }

  stepToward(index: number): void {
    if (index < this.selected) {
      this.#select(this.selected - 1);
      if (this.selected < this.top) this.top--;
    }
    if (index > this.selected) {
      this.#select(this.selected + 1);
      if (this.selected - this.top >= this.visible) this.top++;
    }
  }

  dragTo(index: number): void {
    if (index < this.selected) {
      this.#select(index);
      if (this.selected < this.top) this.top = this.selected;
    }
    if (index > this.selected) {
      this.#select(index);
      if (this.selected - this.top >= this.visible) this.top = this.selected - this.visible + 1;
    }
  }
}

export interface DropDownScroll {
  readonly width: number;
  readonly arrows: AssetKey;
  readonly arrowWidth: number;
  readonly arrowHeight: number;
  readonly upY: number;
  readonly downY: number;
  readonly thumb: RgbColor;
  readonly thumbLight: RgbColor;
  readonly thumbDark: RgbColor;
}

export interface DropDownGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rowGap: number;
  readonly textX: number;
  readonly textY: number;
  readonly rowTop: number;
  readonly rowBottom: number;
  readonly rowRightInset: number;
  readonly highlightInset: number;
  readonly highlightBottom: number;
}

export interface DropDownLook {
  readonly font: BitmapFont;
  readonly border: AssetKey;
  readonly background: RgbColor;
  readonly color: number;
  readonly selectedColor: number;
  readonly selectedFill: RgbColor;
}

export interface DropDownViewOptions {
  readonly model: DropDown;
  readonly geometry: DropDownGeometry;
  readonly look: DropDownLook;
  readonly scroll: DropDownScroll | null;
  readonly regions: RegionDispatcher;
  readonly priority?: number;
  readonly rowCursor?: number;
  readonly scrollCursor?: number;
  readonly closeArea?: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number } | null;
  readonly owner?: unknown;
  readonly id?: string;
  readonly onChange?: (selected: number) => void;
}

export class DropDownView {
  readonly model: DropDown;
  readonly id: string;
  readonly #options: DropDownViewOptions;
  #regions: MouseRegion[] = [];
  #rows: MouseRegion[] = [];
  #shown = false;
  #changes: number;

  constructor(options: DropDownViewOptions) {
    this.model = options.model;
    this.#options = options;
    this.id = options.id ?? 'dropDown';
    this.#changes = options.model.changes;
  }

  get rowStep(): number {
    return fontHeight(this.#options.look.font) + this.#options.geometry.rowGap;
  }

  sync(): void {
    if (this.model.open && !this.#shown) this.#show();
    else if (!this.model.open && this.#shown) this.#hide();
    if (this.model.open) this.model.clampTop();
    if (this.model.changes !== this.#changes) {
      this.#changes = this.model.changes;
      this.#options.onChange?.(this.model.selected);
    }
  }

  #define(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    priority: number,
    cursor: number | undefined,
    id: string,
    handlers: Pick<Parameters<RegionDispatcher['define']>[0], 'onMove' | 'onButton'>,
  ): MouseRegion {
    const region = this.#options.regions.define({
      x1,
      y1,
      x2,
      y2,
      priority,
      ...(cursor === undefined ? {} : { cursor }),
      owner: this.#options.owner,
      id: `${this.id}.${id}`,
      ...handlers,
    });
    this.#regions.push(region);
    return region;
  }

  #show(): void {
    this.#shown = true;
    const g = this.#options.geometry;
    const priority = this.#options.priority ?? Priority.HIGH;
    const step = this.rowStep;
    const height = fontHeight(this.#options.look.font);
    this.#rows = Array.from({ length: this.model.visible }, (_, row) => {
      const y = g.y + row * step;
      return this.#define(
        g.x,
        y + g.rowTop,
        g.x + g.width - g.rowRightInset,
        y + height + g.rowBottom,
        priority,
        this.#options.rowCursor,
        `row${row}`,
        {
          onMove: (_r, reason) => {
            if (reason & MouseReason.GAIN_MOUSE) this.model.hover(row);
          },
          onButton: (_r, reason) => {
            if (reason & MouseReason.LBUTTON_UP) this.model.choose(row);
          },
        },
      );
    });
    const scroll = this.#options.scroll;
    if (scroll) this.#showScroll(scroll, priority);
    const close = this.#options.closeArea;
    if (close)
      this.#define(close.x1, close.y1, close.x2, close.y2, priority - 1, this.#options.scrollCursor, 'close', {
        onButton: (_r, reason) => {
          if (reason & MouseReason.LBUTTON_UP) this.model.close();
        },
      });
  }

  #showScroll(scroll: DropDownScroll, priority: number): void {
    const g = this.#options.geometry;
    const x = g.x + g.width;
    [scroll.upY, scroll.downY].forEach((y, arrow) => {
      this.#define(
        x,
        y,
        x + scroll.arrowWidth,
        y + scroll.arrowHeight,
        priority,
        this.#options.rowCursor,
        arrow === ARROW_UP ? 'up' : 'down',
        {
          onButton: (_r, reason) => {
            if (!(reason & PRESS)) return;
            if (arrow === ARROW_DOWN) this.model.stepDown();
            else this.model.stepUp();
          },
        },
      );
    });
    const top = scroll.upY + scroll.arrowHeight;
    const each = Math.trunc((g.height - 2 * scroll.arrowHeight - SCROLL_PAD) / this.model.entries);
    for (let index = 0; index < this.model.entries; index++) {
      const y1 = top + index * each;
      const y2 = index === this.model.entries - 1 ? scroll.downY : y1 + each;
      this.#define(x, y1, x + scroll.arrowWidth, y2, priority + 1, this.#options.scrollCursor, `scroll${index}`, {
        onMove: (_r, reason) => {
          if (reason & MouseReason.GAIN_MOUSE && this.#options.regions.isButtonDown(MouseButtonMask.LEFT)) this.model.dragTo(index);
        },
        onButton: (_r, reason) => {
          if (reason & PRESS) this.model.stepToward(index);
        },
      });
    }
  }

  #hide(): void {
    this.#shown = false;
    for (const region of this.#regions) region.remove();
    this.#regions = [];
    this.#rows = [];
  }

  dispose(): void {
    this.#hide();
  }

  #drawBorder(list: DrawList, x: number, y: number, width: number, height: number): void {
    const border = this.#options.look.border;
    for (let i = BORDER_STEP; i < width - BORDER_STEP; i += BORDER_STEP) {
      list.image(border, BorderPiece.TOP, x + i, y);
      list.image(border, BorderPiece.BOTTOM, x + i, y + height - BORDER_STEP + BOTTOM_EDGE_LIFT);
    }
    for (let i = BORDER_STEP; i < height - BORDER_STEP; i += BORDER_STEP) {
      list.image(border, BorderPiece.LEFT, x, y + i);
      list.image(border, BorderPiece.RIGHT, x + width - RIGHT_EDGE, y + i);
    }
    list.image(border, BorderPiece.TOP_LEFT, x, y);
    list.image(border, BorderPiece.TOP_RIGHT, x + width - BORDER_STEP, y);
    list.image(border, BorderPiece.BOTTOM_LEFT, x, y + height - BORDER_STEP);
    list.image(border, BorderPiece.BOTTOM_RIGHT, x + width - BORDER_STEP, y + height - BORDER_STEP);
  }

  #drawRows(list: DrawList, labels: readonly string[]): void {
    const g = this.#options.geometry;
    const look = this.#options.look;
    const step = this.rowStep;
    const height = fontHeight(look.font);
    for (let row = 0; row < this.model.visible; row++)
      mprint(list, look.font, g.x + g.textX, g.y + g.textY + row * step, labels[this.model.top + row] ?? '', fontColors(look.color));
    const selected = this.model.selected;
    const rowY = selected === NO_SELECTION ? step * this.model.top + g.y : step * (selected - this.model.top) + g.y;
    list.fill(
      g.x + g.highlightInset,
      rowY + g.highlightInset,
      g.x + g.width - g.highlightInset,
      rowY + height + g.highlightBottom,
      look.selectedFill,
    );
    const label = labels[selected === NO_SELECTION ? 0 : selected] ?? '';
    mprint(list, look.font, g.x + g.textX, rowY + g.textY, label, fontColors(look.selectedColor, 0));
  }

  #drawScroll(list: DrawList, scroll: DropDownScroll): void {
    const g = this.#options.geometry;
    const look = this.#options.look;
    const x = g.x + g.width;
    list.fill(x, g.y, x + scroll.width, g.y + g.height, look.background);
    for (let i = BORDER_STEP; i < g.height - BORDER_STEP; i += BORDER_STEP)
      list.image(look.border, BorderPiece.LEFT, x + scroll.width - RIGHT_EDGE, g.y + i);
    for (let i = 0; i < scroll.width; i += BORDER_STEP) {
      list.image(look.border, BorderPiece.TOP, i + x - BORDER_STEP, g.y);
      list.image(look.border, BorderPiece.BOTTOM, i + x - BORDER_STEP, g.y - BORDER_STEP + BOTTOM_EDGE_LIFT + g.height);
    }
    list.image(look.border, BorderPiece.TOP_RIGHT, x + scroll.width - BORDER_STEP, g.y);
    list.image(look.border, BorderPiece.BOTTOM_RIGHT, x + scroll.width - BORDER_STEP, g.y + g.height - BORDER_STEP);
    list.image(look.border, BorderPiece.RIGHT, g.x + g.width - RIGHT_EDGE, g.y + 2);
    list.image(scroll.arrows, ARROW_UP_FRAME, x, scroll.upY);
    list.image(scroll.arrows, ARROW_DOWN_FRAME, x, scroll.downY);
    this.#drawThumb(list, scroll, x);
  }

  #drawThumb(list: DrawList, scroll: DropDownScroll, x: number): void {
    const g = this.#options.geometry;
    const index = this.model.selected === NO_SELECTION ? 0 : this.model.selected;
    const width = scroll.width - THUMB_INSET;
    const span = g.height - 2 * scroll.arrowHeight;
    const height = Math.trunc((span - SCROLL_PAD) / (this.model.entries + 1));
    let y = scroll.upY + scroll.arrowHeight + Math.trunc(Math.fround(Math.fround(span / (this.model.entries + 1)) * index));
    const floor = g.y + g.height - scroll.arrowHeight - height - THUMB_FLOOR;
    if (y >= floor) y = g.y + g.height - scroll.arrowHeight - height - THUMB_EDGE;
    list.fill(x, y, x + width, y + height, scroll.thumb);
    list.line(x, y, x + width, y, scroll.thumbLight);
    list.line(x, y, x, y + height, scroll.thumbLight);
    list.line(x, y + height, x + width, y + height, scroll.thumbDark);
    list.line(x + width, y, x + width, y + height, scroll.thumbDark);
  }

  render(list: DrawList, labels: readonly string[]): void {
    if (!this.model.open) return;
    const g = this.#options.geometry;
    list.fill(g.x, g.y, g.x + g.width, g.y + g.height, this.#options.look.background);
    this.#drawBorder(list, g.x, g.y, g.width, g.height);
    this.#drawRows(list, labels);
    if (this.#options.scroll) this.#drawScroll(list, this.#options.scroll);
  }

  describe(labels: readonly string[]): WidgetInfo[] {
    return this.#rows.map((region, row) => ({
      id: region.id ?? `${this.id}.row${row}`,
      kind: 'dropDownRow',
      rect: widgetRect(region.x1, region.y1, region.width, region.height),
      visible: true,
      enabled: region.enabled,
      state: this.model.selected === this.model.top + row ? 'selected' : 'normal',
      text: labels[this.model.top + row] ?? null,
      frame: null,
    }));
  }
}
