// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc InitItemStackPopup (ItemSlotLimit cells of extra_inventory.sti, up to
// @src MAX_STACK_POPUP_WIDTH per row, centred on the slot and kept inside the panel area, the cell regions at
// @src MSYS_PRIORITY_HIGHEST firing on the button down, the panel region at MSYS_PRIORITY_HIGH), RenderItemStackPopup (the
// @src area shaded, the item at + 11, + 3 in 29 × 23 without a count, the bar at + 7, + INV_BAR_DY + 3),
// @src ItemPopupRegionCallback* (take one object, put the cursor item in, right click describes), ItemPopupFullRegionCallback*,
// @src InitKeyRingPopup (NUMBER_KEYS_ON_KEYRING cells, KEY_RING_ROW_WIDTH per row at + TACTICAL_INVENTORY_KEYRING_GRAPHIC_OFFSET_X,
// @src 8 down), RenderKeyRingPopup (the shade from x 0, the key item's graphic and count, a full bar);
// @src src/game/Tactical/Interface_Panels.cc KeyRingItemPanelButtonCallback, KeyRingSlotInvClickCallback. See docs/28 §5.4.

import { slotLimitOf } from '../../../content/items/slot-limit.ts';
import { idiv } from '../../../core/int.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { KeyView, SoldierView } from '../../../protocol/view.ts';
import type { ImageCatalog } from '../../assets.ts';
import type { DrawList } from '../../draw-list.ts';
import { MouseReason, NO_CURSOR, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import { drawItemStatusBar } from './bars.ts';
import type { SlotRect } from './inventory.ts';
import { cursorFromSlot, type ItemCursor, placeCommand, slotItem } from './item-cursor.ts';
import { drawInventoryItem, itemStatusValue, RENDER_ITEM_NOSTATUS, type TileDrawContext } from './item-tile.ts';

const OWNER = 'itemPopups';
const MAX_STACK_POPUP_WIDTH = 6;
const STACK_ITEM_X = 11;
const STACK_ITEM_Y = 3;
const STACK_ITEM_WIDTH = 29;
const STACK_ITEM_HEIGHT = 23;
const STACK_BAR_X = 7;
const INV_BAR_DY = 21;
const ITEM_BAR_HEIGHT = 20;
export const NUMBER_KEYS_ON_KEYRING = 28;
const KEY_RING_ROW_WIDTH = 7;
const KEY_RING_GRAPHIC_OFFSET_X = 215;
const KEY_RING_OFFSET_Y = 8;
const KEY_ITEM_X = 8;
const KEY_ITEM_BOTTOM_MARGIN = 2;
const KEY_BAR_X = 7;
const KEY_BAR_Y = 24;
const FULL = 100;

export interface PopupArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PopupHooks {
  readonly services: UiServices;
  readonly images: ImageCatalog;
  readonly soldier: (id: number) => SoldierView | null;
  readonly item: (name: string) => CatalogueItem | null;
  readonly cursor: () => ItemCursor | null;
  readonly setCursor: (cursor: ItemCursor | null) => void;
  readonly send: (cmd: CommandEnvelope) => Promise<{ ok: boolean }>;
  readonly describe: (soldier: number, slot: number, index: number) => void;
  readonly describeKey: (soldier: number, key: number) => void;
  readonly cellArt: string;
  readonly keyItem: (key: KeyView) => string | null;
}

function cellSize(images: ImageCatalog, art: string): { width: number; height: number } {
  const frame = images.info(art)?.frames[0];
  return { width: frame?.width ?? 0, height: frame?.height ?? 0 };
}

export class StackPopup {
  readonly #hooks: PopupHooks;
  #soldier: number | null = null;
  #slot = 0;
  #area: PopupArea = { x: 0, y: 0, width: 0, height: 0 };
  #origin = { x: 0, y: 0 };
  #cells = 0;
  #regions: MouseRegion[] = [];

  constructor(hooks: PopupHooks) {
    this.#hooks = hooks;
  }

  get open(): boolean {
    return this.#soldier !== null;
  }

  show(soldier: SoldierView, slot: number, slotRect: SlotRect, area: PopupArea): void {
    this.close();
    const item = slotItem(soldier, slot);
    const def = item ? this.#hooks.item(item.item) : null;
    if (!item || !def) return;
    const limit = slotLimitOf(def.perPocket, slot);
    if (limit < 1) return;
    const cols = limit > MAX_STACK_POPUP_WIDTH ? MAX_STACK_POPUP_WIDTH : limit;
    const rows = limit > MAX_STACK_POPUP_WIDTH ? idiv(limit, MAX_STACK_POPUP_WIDTH) : 0;
    const cell = cellSize(this.#hooks.images, this.#hooks.cellArt);
    const width = cols * cell.width;
    const height = rows * cell.height;
    let x = slotRect.x - (idiv(width, 2) + idiv(slotRect.width, 2));
    let y = slotRect.y - (idiv(height, 2) + idiv(slotRect.height, 2));
    if (x < area.x) x = area.x;
    if (x + width > area.x + area.width) x = area.x + area.width - width;
    if (y < area.y) y = area.y;
    if (y + height > area.y + area.height) y = area.y + area.height - height;
    this.#origin = { x: Math.max(0, x), y: Math.max(0, y) };
    this.#soldier = soldier.id;
    this.#slot = slot;
    this.#area = area;
    this.#cells = limit;
    const services = this.#hooks.services;
    for (let i = 0; i < limit; i++) {
      const row = idiv(i, MAX_STACK_POPUP_WIDTH);
      const col = i % MAX_STACK_POPUP_WIDTH;
      const cx = this.#origin.x + col * cell.width;
      const cy = this.#origin.y + row * cell.height;
      let right = false;
      const region = services.regions.define({
        x1: cx,
        y1: cy,
        x2: cx + cell.width,
        y2: cy + cell.height,
        priority: Priority.HIGHEST,
        cursor: NO_CURSOR,
        owner: OWNER,
        id: `stackCell${i}`,
        onButton: (_r, reason) => {
          if (reason & MouseReason.LBUTTON_DWN) void this.#cellPrimary(i);
          if (reason & MouseReason.RBUTTON_DWN) right = true;
          if (reason & MouseReason.RBUTTON_UP && right) {
            right = false;
            this.#cellSecondary(i);
          }
        },
      });
      region.setTooltip(def.longName);
      this.#regions.push(region);
    }
    let fullRight = false;
    let fullDown = false;
    this.#regions.push(
      services.regions.define({
        x1: area.x,
        y1: area.y,
        x2: area.x + area.width,
        y2: area.y + area.height,
        priority: Priority.HIGH,
        cursor: NO_CURSOR,
        owner: OWNER,
        id: 'stackPopupArea',
        onButton: (_r, reason) => {
          if (reason & MouseReason.LBUTTON_DWN) fullDown = true;
          if (reason & MouseReason.RBUTTON_DWN) fullRight = true;
          if (reason & MouseReason.LBUTTON_UP && fullDown) {
            fullDown = false;
            if (this.#hooks.cursor()) this.close();
          }
          if (reason & MouseReason.RBUTTON_UP && fullRight) {
            fullRight = false;
            this.close();
          }
        },
      }),
    );
  }

  async #cellPrimary(index: number): Promise<void> {
    const soldier = this.#soldier === null ? null : this.#hooks.soldier(this.#soldier);
    if (!soldier) return;
    const cursor = this.#hooks.cursor();
    if (cursor) {
      const reply = await this.#hooks.send(placeCommand(cursor, soldier.id, this.#slot));
      if (reply.ok) this.#hooks.setCursor(null);
      return;
    }
    const item = slotItem(soldier, this.#slot);
    if (!item || index >= item.count) return;
    this.#hooks.setCursor(cursorFromSlot(soldier, this.#slot, false, index));
  }

  #cellSecondary(index: number): void {
    const soldier = this.#soldier;
    const slot = this.#slot;
    this.close();
    if (soldier !== null) this.#hooks.describe(soldier, slot, index);
  }

  close(): void {
    for (const region of this.#regions) region.remove();
    this.#regions = [];
    this.#soldier = null;
  }

  render(list: DrawList, ctx: TileDrawContext): void {
    const soldier = this.#soldier === null ? null : this.#hooks.soldier(this.#soldier);
    if (!soldier) return;
    const area = this.#area;
    list.shadow(area.x, area.y, area.x + area.width, area.y + area.height);
    const cell = cellSize(this.#hooks.images, this.#hooks.cellArt);
    const item = slotItem(soldier, this.#slot);
    const cursor = this.#hooks.cursor()?.source;
    for (let i = 0; i < this.#cells; i++) {
      const row = idiv(i, MAX_STACK_POPUP_WIDTH);
      const col = i % MAX_STACK_POPUP_WIDTH;
      const x = this.#origin.x + col * cell.width;
      const y = this.#origin.y + row * cell.height;
      list.image(this.#hooks.cellArt, 0, x, y);
      if (!item || i >= item.count) continue;
      if (cursor?.kind === 'slot' && cursor.soldier === soldier.id && cursor.slot === this.#slot && cursor.index === i) continue;
      drawInventoryItem(
        ctx,
        item,
        { x: x + STACK_ITEM_X, y: y + STACK_ITEM_Y, width: STACK_ITEM_WIDTH, height: STACK_ITEM_HEIGHT },
        { outline: null, statusIndex: RENDER_ITEM_NOSTATUS },
      );
      drawItemStatusBar(list, itemStatusValue(item, ctx.items, i), x + STACK_BAR_X, y + INV_BAR_DY + STACK_ITEM_Y, ITEM_BAR_HEIGHT);
    }
  }
}

export class KeyRingPopup {
  readonly #hooks: PopupHooks;
  #soldier: number | null = null;
  #area: PopupArea = { x: 0, y: 0, width: 0, height: 0 };
  #regions: MouseRegion[] = [];

  constructor(hooks: PopupHooks) {
    this.#hooks = hooks;
  }

  get open(): boolean {
    return this.#soldier !== null;
  }

  show(soldier: SoldierView, area: PopupArea): void {
    this.close();
    this.#soldier = soldier.id;
    this.#area = area;
    const cell = cellSize(this.#hooks.images, this.#hooks.cellArt);
    const x0 = area.x + KEY_RING_GRAPHIC_OFFSET_X;
    const services = this.#hooks.services;
    for (let i = 0; i < NUMBER_KEYS_ON_KEYRING; i++) {
      const x = x0 + (i % KEY_RING_ROW_WIDTH) * cell.width;
      const y = area.y + idiv(i, KEY_RING_ROW_WIDTH) * cell.height + KEY_RING_OFFSET_Y;
      let right = false;
      this.#regions.push(
        services.regions.define({
          x1: x,
          y1: y,
          x2: x + cell.width,
          y2: y + cell.height,
          priority: Priority.HIGHEST,
          cursor: NO_CURSOR,
          owner: OWNER,
          id: `keyRingCell${i}`,
          onButton: (_r, reason) => {
            if (reason & MouseReason.RBUTTON_DWN) right = true;
            if (reason & MouseReason.RBUTTON_UP && right) {
              right = false;
              this.#describe(i);
            }
          },
        }),
      );
    }
    let right = false;
    let down = false;
    this.#regions.push(
      services.regions.define({
        x1: area.x,
        y1: area.y,
        x2: area.x + area.width,
        y2: area.y + area.height,
        priority: Priority.HIGH,
        cursor: NO_CURSOR,
        owner: OWNER,
        id: 'keyRingArea',
        onButton: (_r, reason) => {
          if (reason & MouseReason.LBUTTON_DWN) down = true;
          if (reason & MouseReason.RBUTTON_DWN) right = true;
          if ((reason & MouseReason.LBUTTON_UP && down) || (reason & MouseReason.RBUTTON_UP && right)) {
            down = false;
            right = false;
            this.close();
          }
        },
      }),
    );
  }

  #describe(index: number): void {
    const soldier = this.#soldier === null ? null : this.#hooks.soldier(this.#soldier);
    if (!soldier?.keys?.[index]) return;
    this.close();
    this.#hooks.describeKey(soldier.id, index);
  }

  close(): void {
    for (const region of this.#regions) region.remove();
    this.#regions = [];
    this.#soldier = null;
  }

  render(list: DrawList, ctx: TileDrawContext): void {
    const soldier = this.#soldier === null ? null : this.#hooks.soldier(this.#soldier);
    if (!soldier) return;
    const area = this.#area;
    const x0 = area.x + KEY_RING_GRAPHIC_OFFSET_X;
    list.shadow(0, area.y, x0 + area.width, area.y + area.height);
    const cell = cellSize(this.#hooks.images, this.#hooks.cellArt);
    const keys = soldier.keys ?? [];
    for (let i = 0; i < NUMBER_KEYS_ON_KEYRING; i++) {
      const x = x0 + (i % KEY_RING_ROW_WIDTH) * cell.width;
      const y = area.y + KEY_RING_OFFSET_Y + idiv(i, KEY_RING_ROW_WIDTH) * cell.height;
      list.image(this.#hooks.cellArt, 0, x, y);
      const key = keys[i];
      if (!key || key.count <= 0) continue;
      const itemName = this.#hooks.keyItem(key);
      if (!itemName) continue;
      drawItemStatusBar(list, FULL, x + KEY_BAR_X, y + KEY_BAR_Y, ITEM_BAR_HEIGHT);
      drawInventoryItem(
        ctx,
        { slot: -1, item: itemName, index: 0, count: key.count, status: [FULL] },
        { x: x + KEY_ITEM_X, y, width: cell.width - KEY_ITEM_X, height: cell.height - KEY_ITEM_BOTTOM_MARGIN },
        { outline: null },
      );
    }
  }
}
