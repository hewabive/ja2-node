// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc InitializeItemPickupMenu (the game paused, the SM panel of the picker, the
// @src menu right of the pointer at ITEMPICK_START_X_OFFSET, centred in y and kept inside the viewport, itembox.sti
// @src frames 0 and 1 per row and 2 or 3 below, the OK 4/9, Up 5/10, All 6/11, Down 7/12 and Cancel 8/13 buttons at
// @src MSYS_PRIORITY_HIGHEST with ItemPickupHelpPopup, OK disabled until something is chosen, the row regions, the back
// @src regions at 532, 367 and over the menu), SetupPickupPage (NUM_PICKUP_SLOTS rows a page, the status as fast help but
// @src not for ammo and keys), CalculateItemPickupMenuDimensions, RenderItemPickupMenu (the world tile graphic at shade 4
// @src outlined yellow when chosen, the count, the attachment star, the short name or the money in BLOCKFONT2 centred in
// @src ITEMPICK_TEXT_WIDTH, white for the row under the pointer, black with ITEMDESC_FONTSHADOW2 otherwise),
// @src ItemPickupAll, ItemPickupOK, ItemPickupCancel, ItemPickMenuMouseMoveCallback, ItemPickMenuMouseClickCallback (a
// @src click toggles a row, the wheel turns the pages), RemoveItemPickupMenu. See docs/28 §5.4 and the deviation
// @src "Item pickup menu".

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { ItemView } from '../../../protocol/view.ts';
import type { ImageCatalog } from '../../assets.ts';
import { type DrawList, rgb } from '../../draw-list.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign, hRightVCenterAlign, stringPixLength } from '../../text/measure.ts';
import { sprintMoney } from '../../text/money.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { Button } from '../../widgets/button.ts';
import { drawItemGraphic, type TileDrawContext } from './item-tile.ts';

export const NUM_PICKUP_SLOTS = 6;
const OWNER = 'itemPickupMenu';
const ITEMPICK_UP_X = 55;
const ITEMPICK_UP_Y = 5;
const ITEMPICK_DOWN_X = 111;
const ITEMPICK_DOWN_Y = 5;
const ITEMPICK_ALL_X = 79;
const ITEMPICK_ALL_Y = 6;
const ITEMPICK_OK_X = 16;
const ITEMPICK_OK_Y = 6;
const ITEMPICK_CANCEL_X = 141;
const ITEMPICK_CANCEL_Y = 6;
const ITEMPICK_START_X_OFFSET = 10;
const ITEMPICK_GRAPHIC_X = 10;
const ITEMPICK_GRAPHIC_Y = 12;
const ITEMPICK_GRAPHIC_YSPACE = 26;
const ITEMPICK_TEXT_X = 56;
const ITEMPICK_TEXT_Y = 22;
const ITEMPICK_TEXT_YSPACE = 26;
const ITEMPICK_TEXT_WIDTH = 109;
const ITEMDESC_FONTSHADOW2 = 32;
const BACK_REGION_X = 532;
const BACK_REGION_Y = 367;
const SELECTED_OUTLINE = rgb(255, 255, 0);
const COUNT_X = -4;
const COUNT_Y = 14;
const COUNT_WIDTH = 42;
const STAR_X = 43;
const STAR_MARGIN = 4;
const STAR_Y = 2;
const ROW_FIRST = 0;
const ROW_OTHER = 1;
const FOOTER_ARROWS = 2;
const FOOTER_PLAIN = 3;
const HELP_TABLE = 'ItemPickupHelpPopup';

export interface WorldTileImage {
  readonly path: string;
  readonly frame: number;
}

export interface PickupHooks {
  readonly services: UiServices;
  readonly images: ImageCatalog;
  readonly text: UiTextService;
  readonly art: string;
  readonly item: (name: string) => CatalogueItem | null;
  readonly tileImage: (item: CatalogueItem) => WorldTileImage | null;
  readonly pickUp: (soldier: number, gridNo: number, level: number, items: readonly number[]) => void;
  readonly closed: () => void;
  readonly hover: (item: ItemView | null) => void;
}

export interface PickupFonts {
  readonly item: BitmapFont;
  readonly tiny: BitmapFont;
}

export class ItemPickupMenu {
  readonly #hooks: PickupHooks;
  #items: readonly ItemView[] = [];
  #selected: boolean[] = [];
  #page = 0;
  #current = -1;
  #allSelected = false;
  #x = 0;
  #y = 0;
  #width = 0;
  #height = 0;
  #bottom = 0;
  #slots = 0;
  #soldier = -1;
  #gridNo = -1;
  #level = 0;
  #regions: MouseRegion[] = [];
  #buttons: Button[] = [];
  #ok: Button | null = null;
  #up: Button | null = null;
  #down: Button | null = null;
  #fonts: PickupFonts | null = null;

  constructor(hooks: PickupHooks) {
    this.#hooks = hooks;
  }

  get open(): boolean {
    return this.#items.length > 0;
  }

  get soldier(): number {
    return this.#soldier;
  }

  get selection(): readonly boolean[] {
    return this.#selected;
  }

  #frame(index: number): { width: number; height: number } {
    const f = this.#hooks.images.info(this.#hooks.art)?.frames[index];
    return { width: f?.width ?? 0, height: f?.height ?? 0 };
  }

  show(
    soldier: number,
    gridNo: number,
    level: number,
    items: readonly ItemView[],
    pointer: { x: number; y: number },
    viewport: { top: number; bottom: number },
    screenWidth: number,
    fonts: PickupFonts,
  ): void {
    this.close(false);
    if (items.length === 0) return;
    this.#fonts = fonts;
    this.#items = items;
    this.#selected = items.map(() => false);
    this.#soldier = soldier;
    this.#gridNo = gridNo;
    this.#level = level;
    this.#slots = Math.min(items.length, NUM_PICKUP_SLOTS);
    this.#allSelected = false;
    this.#current = -1;
    let height = 0;
    for (let i = 0; i < this.#slots; i++) height += this.#frame(i === 0 ? ROW_FIRST : ROW_OTHER).height;
    this.#bottom = height;
    const footer = this.#frame(FOOTER_ARROWS);
    this.#height = height + footer.height;
    this.#width = footer.width;
    let x = pointer.x;
    x = x + this.#width > screenWidth ? screenWidth - this.#width - ITEMPICK_START_X_OFFSET : x + ITEMPICK_START_X_OFFSET;
    let y = pointer.y - idiv(this.#height, 2);
    if (y < viewport.top) y = viewport.top;
    if (y + this.#height > viewport.bottom) y = viewport.bottom - this.#height;
    this.#x = x;
    this.#y = y;
    this.#createRegions(screenWidth, viewport);
    this.#createButtons();
    this.#setPage(0);
    this.#hooks.services.pauseGame?.(true);
  }

  #createRegions(screenWidth: number, viewport: { bottom: number }): void {
    const regions = this.#hooks.services.regions;
    const screenHeight = viewport.bottom + 120;
    this.#regions.push(
      regions.define({
        x1: BACK_REGION_X,
        y1: BACK_REGION_Y,
        x2: screenWidth,
        y2: screenHeight,
        priority: Priority.HIGHEST,
        cursor: 0,
        owner: OWNER,
        id: 'pickupBack',
      }),
      regions.define({
        x1: this.#x,
        y1: this.#y,
        x2: this.#x + this.#width,
        y2: this.#y + this.#height,
        priority: Priority.HIGHEST,
        cursor: 0,
        owner: OWNER,
        id: 'pickupArea',
      }),
    );
    let y = this.#y + ITEMPICK_GRAPHIC_Y;
    for (let row = 0; row < this.#slots; row++) {
      this.#regions.push(
        regions.define({
          x1: this.#x,
          y1: y + 1,
          x2: this.#x + this.#width,
          y2: y + ITEMPICK_GRAPHIC_YSPACE,
          priority: Priority.HIGHEST,
          cursor: 0,
          owner: OWNER,
          id: `pickupRow${row}`,
          onMove: (_r, reason) => this.#rowMove(row, reason),
          onButton: (_r, reason) => this.#rowButton(row, reason),
        }),
      );
      y += ITEMPICK_GRAPHIC_YSPACE;
    }
  }

  #createButtons(): void {
    const buttons = this.#hooks.services.buttons;
    const by = this.#y + this.#bottom;
    const help = (i: number) => this.#hooks.text.string(HELP_TABLE, i) ?? '';
    const make = (id: string, x: number, y: number, off: number, on: number, tip: string, click: () => void) => {
      const button = buttons.create({
        x: this.#x + x,
        y: by + y,
        kind: 'quick',
        image: { asset: this.#hooks.art, grayed: -1, offNormal: off, offHilite: -1, onNormal: on, onHilite: -1 },
        priority: Priority.HIGHEST,
        owner: OWNER,
        id,
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) click();
        },
      });
      button.setTooltip(tip);
      this.#buttons.push(button);
      return button;
    };
    if (this.#slots === NUM_PICKUP_SLOTS && this.#items.length > NUM_PICKUP_SLOTS) {
      this.#up = make('pickupUp', ITEMPICK_UP_X, ITEMPICK_UP_Y, 5, 10, help(1), () => this.#setPage(this.#page - 1));
      this.#down = make('pickupDown', ITEMPICK_DOWN_X, ITEMPICK_DOWN_Y, 7, 12, help(3), () => this.#setPage(this.#page + 1));
    }
    this.#ok = make('pickupOk', ITEMPICK_OK_X, ITEMPICK_OK_Y, 4, 9, help(0), () => this.#confirm());
    make('pickupAll', ITEMPICK_ALL_X, ITEMPICK_ALL_Y, 6, 11, help(2), () => this.#toggleAll());
    make('pickupCancel', ITEMPICK_CANCEL_X, ITEMPICK_CANCEL_Y, 8, 13, help(4), () => this.close(true));
    this.#ok.setEnabled(false);
  }

  #setPage(page: number): void {
    const start = page * NUM_PICKUP_SLOTS;
    if (start > this.#items.length) return;
    this.#page = page;
    const end = Math.min(start + NUM_PICKUP_SLOTS, this.#items.length);
    this.#regions.forEach((region) => {
      const row = Number(/^pickupRow(\d+)$/.exec(region.id ?? '')?.[1] ?? -1);
      if (row < 0) return;
      const item = this.#items[start + row];
      const def = item ? this.#hooks.item(item.item) : null;
      const silent = !item || def?.class === 'AMMO' || def?.class === 'KEY';
      region.setTooltip(silent ? '' : `${item.status}%`);
    });
    this.#up?.setEnabled(page > 0);
    this.#down?.setEnabled(end < this.#items.length);
  }

  #rowMove(row: number, reason: number): void {
    const at = row + this.#page * NUM_PICKUP_SLOTS;
    if (reason & MouseReason.LOST_MOUSE) {
      this.#current = -1;
      this.#hooks.hover(null);
      return;
    }
    if (reason & (MouseReason.MOVE | MouseReason.GAIN_MOUSE)) {
      if (at >= this.#items.length) return;
      if (this.#current !== at) this.#hooks.hover(this.#items[at] ?? null);
      this.#current = at;
    }
  }

  #rowButton(row: number, reason: number): void {
    const at = row + this.#page * NUM_PICKUP_SLOTS;
    if (reason & MouseReason.LBUTTON_UP) {
      if (at >= this.#items.length) return;
      this.#selected[at] = !this.#selected[at];
      this.#ok?.setEnabled(this.#selected.some(Boolean));
    } else if (reason & MouseReason.WHEEL_UP) {
      if (this.#page > 0) this.#setPage(this.#page - 1);
    } else if (reason & MouseReason.WHEEL_DOWN) {
      if ((this.#page + 1) * NUM_PICKUP_SLOTS < this.#items.length) this.#setPage(this.#page + 1);
    }
  }

  #toggleAll(): void {
    this.#allSelected = !this.#allSelected;
    this.#selected = this.#selected.map(() => this.#allSelected);
    this.#ok?.setEnabled(this.#allSelected);
  }

  #confirm(): void {
    const chosen = this.#selected.flatMap((on, i) => (on ? [i] : []));
    const { soldier, gridNo, level } = { soldier: this.#soldier, gridNo: this.#gridNo, level: this.#level };
    this.close(true);
    if (chosen.length > 0) this.#hooks.pickUp(soldier, gridNo, level, chosen);
  }

  close(notify: boolean): void {
    if (!this.open) return;
    for (const region of this.#regions) region.remove();
    for (const button of this.#buttons) button.remove();
    this.#regions = [];
    this.#buttons = [];
    this.#ok = null;
    this.#up = null;
    this.#down = null;
    this.#items = [];
    this.#selected = [];
    this.#hooks.hover(null);
    this.#hooks.services.pauseGame?.(false);
    if (notify) this.#hooks.closed();
  }

  render(list: DrawList, ctx: TileDrawContext): void {
    const fonts = this.#fonts;
    if (!this.open || !fonts) return;
    const art = this.#hooks.art;
    let y = this.#y;
    for (let row = 0; row < this.#slots; row++) {
      const frame = row === 0 ? ROW_FIRST : ROW_OTHER;
      list.image(art, frame, this.#x, y);
      y += this.#frame(frame).height;
    }
    const arrows = this.#slots === NUM_PICKUP_SLOTS && this.#items.length > NUM_PICKUP_SLOTS;
    list.image(art, arrows ? FOOTER_ARROWS : FOOTER_PLAIN, this.#x, y);
    const start = this.#page * NUM_PICKUP_SLOTS;
    const gx = this.#x + ITEMPICK_GRAPHIC_X;
    let gy = this.#y + ITEMPICK_GRAPHIC_Y;
    for (let row = 0; row < this.#slots; row++) {
      const at = start + row;
      const view = this.#items[at];
      const def = view ? this.#hooks.item(view.item) : null;
      if (!view || !def) {
        gy += ITEMPICK_GRAPHIC_YSPACE;
        continue;
      }
      const outline = this.#selected[at] ? SELECTED_OUTLINE : null;
      const tile = this.#hooks.tileImage(def);
      if (tile && ctx.ensure(tile.path)) list.image(tile.path, tile.frame, gx, gy, { effect: { kind: 'outline', color: outline } });
      else drawItemGraphic(ctx, def, { x: gx, y: gy, width: COUNT_WIDTH, height: ITEMPICK_GRAPHIC_YSPACE }, outline);
      if (view.count > 1) {
        const text = String(view.count);
        const point = hRightVCenterAlign(gx + COUNT_X, gy + COUNT_Y, COUNT_WIDTH, 1, text, fonts.tiny);
        mprint(list, fonts.tiny, point.x, point.y, text, fontColors(FontColor.GRAY4, DEFAULT_SHADOW));
      }
      if ((view.attachments ?? []).length > 0) {
        const launcher = (view.attachments ?? []).some((a) => this.#hooks.item(a.item)?.class === 'LAUNCHER');
        const star = '*';
        mprint(
          list,
          fonts.tiny,
          gx + STAR_X - stringPixLength(star, fonts.tiny) - STAR_MARGIN,
          gy + STAR_Y,
          star,
          fontColors(launcher ? FontColor.YELLOW : FontColor.GREEN, DEFAULT_SHADOW),
        );
      }
      const hovered = this.#current === at;
      const name = def.class === 'MONEY' ? `${def.longName} (${sprintMoney(view.money ?? 0)})` : def.shortName;
      const point = hCenterVCenterAlign(
        this.#x + ITEMPICK_TEXT_X,
        this.#y + ITEMPICK_TEXT_Y + ITEMPICK_TEXT_YSPACE * row,
        ITEMPICK_TEXT_WIDTH,
        1,
        name,
        fonts.item,
      );
      mprint(
        list,
        fonts.item,
        point.x,
        point.y,
        name,
        hovered ? fontColors(FontColor.WHITE, DEFAULT_SHADOW) : fontColors(FontColor.BLACK, ITEMDESC_FONTSHADOW2),
      );
      gy += ITEMPICK_GRAPHIC_YSPACE;
    }
    for (const button of this.#buttons) if (button.visible) this.#hooks.services.buttons.draw(list, button);
  }
}
