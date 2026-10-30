// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc InternalInitItemDescriptionBox (the box region at MSYS_PRIORITY_HIGHEST, the
// @src ammo button from infobox.sti 1/5/9 by ammo type aligned with the bottom of the picture box, its text centred in
// @src ITEMDESC_AMMO_TEXT_*, the pros and cons regions with the full lists, the four attachment regions), ReloadItemDesc,
// @src ItemDescAmmoCallback, ItemDescAttachmentsCallbackPrimary (attach with the cursor item, the "permanent?" box, else
// @src the attachment into the cursor), ItemDescAttachmentsCallbackSecondary (describe the attachment), ItemDescCallback*
// @src (a click closes the box, not the money box), RenderItemDescriptionBox (infobox.sti, the big picture with its
// @src shadow, the status bar, the attachments with their bars, the hatch when the cursor item does not attach, the ROF
// @src bullets, the name, the wrapped description in ITEMDESC_FONTSHADOW2, the calibre and type right-aligned, the pros and
// @src cons, the weapon stats with HighlightIf, the money and other branches, the key's sector and day),
// @src AttemptToAddSubstring, g_desc_item_box, g_itemdesc_* boxes, gWeaponStats, gMoneyStats, g_attachment_info; the money
// @src box: the $1000, $100, $10 and Done buttons from info_bil.sti frames 1/2 and 3/4 in BLOCKFONT2 colour 5 at
// @src gMoneyButtonLoc + gMoneyButtonOffsets, the "Separate" or "Withdraw" label, the amount to split or withdraw,
// @src ItemDescDoneButtonCallback* (Done removes the money, a right click only closes), RemoveMoney;
// @src src/game/Tactical/Interface_Panels.cc SMInvMoneyButtonCallback (the box over the account balance).

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { ItemInfo, Placements } from '../../../protocol/hints.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView, KeyView, SoldierView } from '../../../protocol/view.ts';
import type { ImageCatalog } from '../../assets.ts';
import type { DrawList } from '../../draw-list.ts';
import { MouseReason, NO_CURSOR, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { fontHeight } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign, hRightVCenterAlign, stringPixLength } from '../../text/measure.ts';
import { sprintMoney } from '../../text/money.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { weightUnit } from '../../text/weight.ts';
import { displayWrappedString, TextFlag } from '../../text/wrap.ts';
import type { Button } from '../../widgets/button.ts';
import { drawItemStatusBar } from './bars.ts';
import {
  attachCommand,
  cursorFromAttachment,
  cursorFromMagazine,
  type ItemCursor,
  REFUSAL_PERMANENT_ATTACHMENT,
  refusalOf,
  slotItem,
} from './item-cursor.ts';
import { drawInventoryItem, type TileDrawContext } from './item-tile.ts';
import { MONEY_STEPS, MoneyBox } from './money-box.ts';

export type Box = readonly [number, number, number, number];
export type Point = readonly [number, number];
export type StatPosition = readonly [number, number, number];

export interface DescriptionGeometry {
  readonly origin: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly item: Box;
  readonly status: Box;
  readonly name: Box;
  readonly description: Box;
  readonly prosCons: Box;
  readonly weaponStats: readonly StatPosition[];
  readonly moneyStats: readonly StatPosition[];
  readonly attachmentItem: Box;
  readonly attachmentBar: Box;
  readonly attachmentSlots: readonly Point[];
  readonly bulletSingle: Point;
  readonly bulletBurst: Point;
  readonly bulletWidth: number;
  readonly ammoText: readonly [number, number, number];
  readonly moneyBox: Point;
  readonly moneyButtons: readonly Point[];
}

export interface DescriptionArt {
  readonly box: string;
  readonly ammo?: string;
  readonly bullet: string;
  readonly money: string;
}

export interface DescriptionFonts {
  readonly item: BitmapFont;
  readonly tiny: BitmapFont;
}

export type DescribedObject =
  | { readonly kind: 'slot'; readonly soldier: number; readonly slot: number; readonly index: number }
  | { readonly kind: 'attachment'; readonly soldier: number; readonly slot: number; readonly attachment: number }
  | { readonly kind: 'key'; readonly soldier: number; readonly key: number }
  | { readonly kind: 'balance'; readonly soldier: number; readonly amount: number }
  | { readonly kind: 'object'; readonly soldier: number; readonly view: InventoryItemView };

export interface DescriptionHooks {
  readonly services: UiServices;
  readonly text: UiTextService;
  readonly soldier: (id: number) => SoldierView | null;
  readonly item: (name: string) => CatalogueItem | null;
  readonly itemInfo: (object: DescribedObject) => ItemInfo | null;
  readonly cursor: () => ItemCursor | null;
  readonly setCursor: (cursor: ItemCursor | null) => void;
  readonly placements: () => Placements | null;
  readonly send: (cmd: CommandEnvelope) => Promise<{ ok: boolean; data?: unknown }>;
  readonly confirm: (text: string) => Promise<boolean>;
  readonly metric: () => boolean;
  readonly keyItem: (key: KeyView) => string | null;
  readonly closed: () => void;
  readonly moneyDone?: (object: DescribedObject, amount: number) => void;
  readonly alert?: (text: string) => Promise<void>;
}

const OWNER = 'itemDescription';
const STR_ATTACHMENTS = 40;
const STR_EJECT_AMMO = 39;
const STR_PERMANENT_ATTACHMENT = 48;
const ITEMDESC_FONTSHADOW2 = 32;
const ITEMDESC_AMMO_FORE = 209;
const STATS_TITLE = 6;
const STATS_TEXT = 5;
const AMMO_AP = 2;
const AMMO_SUPER_AP = 3;
const AMMO_HP = 1;
const AMMO_IMAGE_REGULAR = 1;
const AMMO_IMAGE_AP = 5;
const AMMO_IMAGE_HP = 9;
const AMMO_GRAYED_OFFSET = 3;
const AMMO_PRESSED_OFFSET = 2;
const DOTDOTDOT = '...';
const COMMA_AND_SPACE = ', ';
const PROS_CONS_INDENT_GAP = 10;
const FULL_LIST_LIMIT = 1000;
const ITEM_STATS_WIDTH = 26;
const ITEM_STATS_HEIGHT = 8;
const MONEY_VALUE_WIDTH = ITEM_STATS_WIDTH - 3;
const KEY_TEXT_WIDTH = 110;
const MAX_ATTACHMENTS = 4;
const MONEY = 'MONEY';
const SHADOW_DX = -2;
const SHADOW_DY = 2;
const HIDDEN_ADDON = 'HIDDEN_ADDON';
const WEIGHT_LABEL = 0;
const STATUS_LABEL = 1;
const AMOUNT_LABEL = 2;
const RANGE_LABEL = 3;
const DAMAGE_LABEL = 4;
const AP_LABEL = 5;
const EQUALS_LABEL = 6;
const MONEY_BUTTON_FRAMES = { offNormal: 1, onNormal: 2 } as const;
const MONEY_DONE_FRAMES = { offNormal: 3, onNormal: 4 } as const;
const MONEY_DONE = 3;
const MONEY_LABEL = 4;
const MONEY_SEPARATE = 4;
const MONEY_WITHDRAW = 5;
const MONEY_BUTTON_COLOR = 5;
const MONEY_DESC_AMOUNT = 0;
const MONEY_DESC_PLAYERS = 4;
const MONEY_TEXT_WITHDRAW_MORE_THEN_MAXIMUM = 0;

function ammoImage(type: number): number {
  if (type === AMMO_AP || type === AMMO_SUPER_AP) return AMMO_IMAGE_AP;
  if (type === AMMO_HP) return AMMO_IMAGE_HP;
  return AMMO_IMAGE_REGULAR;
}

export function prosConsString(labels: readonly string[], font: BitmapFont, limit: number, none: string): string {
  let out = '';
  let length = 0;
  for (const label of labels) {
    const add = stringPixLength(label, font);
    const required = length + add + (out.length > 0 ? stringPixLength(COMMA_AND_SPACE, font) : 0);
    if (required >= limit) return `${out}${DOTDOTDOT}`;
    out = out.length > 0 ? `${out}${COMMA_AND_SPACE}${label}` : label;
    length = required;
  }
  return out.length > 0 ? out : none;
}

function twoDigits(value: number): string {
  return String(Math.trunc(value)).padStart(2, ' ');
}

export class ItemDescriptionBox {
  readonly #hooks: DescriptionHooks;
  #object: DescribedObject | null = null;
  #geometry: DescriptionGeometry | null = null;
  #art: DescriptionArt | null = null;
  #fonts: DescriptionFonts | null = null;
  #regions: MouseRegion[] = [];
  #ammo: Button | null = null;
  #money: MoneyBox | null = null;
  #moneyButtons: Button[] = [];

  constructor(hooks: DescriptionHooks) {
    this.#hooks = hooks;
  }

  get open(): boolean {
    return this.#object !== null;
  }

  get item(): string | null {
    const object = this.object;
    return object ? this.#describedItem(object) : null;
  }

  get object(): DescribedObject | null {
    return this.#object;
  }

  configure(geometry: DescriptionGeometry, art: DescriptionArt, fonts: DescriptionFonts): void {
    this.#geometry = geometry;
    this.#art = art;
    this.#fonts = fonts;
  }

  get money(): MoneyBox | null {
    return this.#money;
  }

  #view(object: DescribedObject): InventoryItemView | null {
    if (object.kind === 'balance') return { slot: -1, item: MONEY, index: 0, count: 1, status: [100], money: object.amount };
    if (object.kind === 'object') return object.view;
    const soldier = this.#hooks.soldier(object.soldier);
    if (object.kind === 'key') return null;
    const item = slotItem(soldier, object.slot);
    if (!item) return null;
    if (object.kind === 'slot') return item;
    const attachment = item.attachments?.[object.attachment];
    return attachment ? { slot: object.slot, item: attachment.item, index: 0, count: 1, status: [attachment.status] } : null;
  }

  #key(object: DescribedObject): KeyView | null {
    if (object.kind !== 'key') return null;
    return this.#hooks.soldier(object.soldier)?.keys?.[object.key] ?? null;
  }

  #describedItem(object: DescribedObject): string | null {
    if (object.kind === 'key') {
      const key = this.#key(object);
      return key ? this.#hooks.keyItem(key) : null;
    }
    return this.#view(object)?.item ?? null;
  }

  show(object: DescribedObject): void {
    this.close(false);
    const geometry = this.#geometry;
    const fonts = this.#fonts;
    const art = this.#art;
    if (!geometry || !fonts || !art) return;
    const itemName = this.#describedItem(object);
    const item = itemName ? this.#hooks.item(itemName) : null;
    if (!item) return;
    this.#object = object;
    const services = this.#hooks.services;
    const { x: dx, y: dy } = geometry.origin;
    const box = services.regions.define({
      x1: dx,
      y1: dy,
      x2: dx + geometry.width,
      y2: dy + geometry.height,
      priority: Priority.HIGHEST,
      cursor: NO_CURSOR,
      owner: OWNER,
      id: 'itemDescriptionBox',
      onButton: (_r, reason) => {
        if (reason & MouseReason.LBUTTON_UP && item.name !== MONEY) this.close(true);
        else if (reason & MouseReason.RBUTTON_UP) this.close(true);
      },
    });
    this.#regions.push(box);
    if (object.kind === 'slot') this.#ammoButton(object, item, geometry, art, fonts);
    if (item.weapon && item.class === 'GUN') this.#prosConsRegions(object, geometry, fonts);
    if (item.name !== MONEY) this.#attachmentRegions(object, geometry);
    else this.#moneyBox(object, geometry, art, fonts);
  }

  #moneyBox(object: DescribedObject, g: DescriptionGeometry, art: DescriptionArt, fonts: DescriptionFonts): void {
    const total = this.#view(object)?.money ?? 0;
    const box = new MoneyBox(total, object.kind === 'balance');
    this.#money = box;
    const services = this.#hooks.services;
    const labels = [...MONEY_STEPS.map((_, i) => i), MONEY_DONE];
    for (const index of labels) {
      const done = index === MONEY_DONE;
      const frames = done ? MONEY_DONE_FRAMES : MONEY_BUTTON_FRAMES;
      const [ox, oy] = g.moneyButtons[index] ?? [0, 0];
      const button = services.buttons.create({
        x: g.moneyBox[0] + ox,
        y: g.moneyBox[1] + oy,
        kind: 'quick',
        image: { asset: art.money, grayed: -1, offNormal: frames.offNormal, offHilite: -1, onNormal: frames.onNormal, onHilite: -1 },
        priority: Priority.HIGHEST,
        owner: OWNER,
        id: done ? 'itemDescriptionMoneyDone' : `itemDescriptionMoney${index}`,
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) void this.#moneyPrimary(object, index);
          if (reason & MouseReason.RBUTTON_UP) this.#moneySecondary(index);
        },
      });
      button.text = {
        text: this.#hooks.text.string('gzMoneyAmounts', index) ?? '',
        font: fonts.item,
        color: MONEY_BUTTON_COLOR,
        shadow: DEFAULT_SHADOW,
        downColor: MONEY_BUTTON_COLOR,
        downShadow: DEFAULT_SHADOW,
        justify: 'center',
      };
      if (!done && !box.stepEnabled(index)) button.setEnabled(false);
      this.#moneyButtons.push(button);
    }
  }

  async #moneyPrimary(object: DescribedObject, index: number): Promise<void> {
    const box = this.#money;
    if (!box) return;
    if (index === MONEY_DONE) {
      if (box.removing !== 0) this.#hooks.moneyDone?.(object, box.removing);
      this.close(true);
      return;
    }
    if (box.add(index) === 'overMaximum')
      await this.#hooks.alert?.(this.#hooks.text.string('gzMoneyWithdrawMessageText', MONEY_TEXT_WITHDRAW_MORE_THEN_MAXIMUM) ?? '');
  }

  #moneySecondary(index: number): void {
    if (index === MONEY_DONE) {
      this.close(true);
      return;
    }
    this.#money?.subtract(index);
  }

  #ammoButton(
    object: DescribedObject & { kind: 'slot' },
    item: CatalogueItem,
    g: DescriptionGeometry,
    art: DescriptionArt,
    fonts: DescriptionFonts,
  ): void {
    if (item.class !== 'GUN' || item.name === 'ROCKET_LAUNCHER') return;
    const view = this.#view(object);
    const shots = view?.ammo?.shots ?? 0;
    const magazine = view?.ammo ? this.#hooks.item(view.ammo.item)?.magazine : null;
    const text = `${shots}/${item.weapon?.magSize ?? 0}`;
    const img = ammoImage(magazine?.ammoType ?? 0);
    const services = this.#hooks.services;
    const image = {
      asset: art.ammo ?? art.box,
      grayed: img + AMMO_GRAYED_OFFSET,
      offNormal: img,
      offHilite: -1,
      onNormal: img + AMMO_PRESSED_OFFSET,
      onHilite: -1,
    };
    const height = services.buttons.imageSize(image).height;
    const [itemX, itemY, , itemH] = g.item;
    const [textX, textY, textW] = g.ammoText;
    const at = hCenterVCenterAlign(textX, textY, textW, fontHeight(fonts.tiny), text, fonts.tiny);
    const button = services.buttons.create({
      x: g.origin.x + itemX,
      y: g.origin.y + itemY + itemH - height,
      kind: 'quick',
      image,
      priority: Priority.HIGHEST,
      owner: OWNER,
      id: 'itemDescriptionAmmo',
      onClick: (_b, reason) => {
        if (reason & MouseReason.LBUTTON_UP) this.#eject(object);
      },
    });
    button.text = {
      text,
      font: fonts.tiny,
      color: ITEMDESC_AMMO_FORE,
      shadow: FontColor.MCOLOR_BLACK,
      downColor: ITEMDESC_AMMO_FORE,
      downShadow: FontColor.MCOLOR_BLACK,
      justify: 'left',
      offsetX: at.x,
      offsetY: at.y,
    };
    button.setTooltip(this.#hooks.text.string('Message', STR_EJECT_AMMO) ?? '');
    this.#ammo = button;
  }

  #eject(object: DescribedObject & { kind: 'slot' }): void {
    if (this.#hooks.cursor()) return;
    const soldier = this.#hooks.soldier(object.soldier);
    const cursor = soldier ? cursorFromMagazine(soldier, object.slot) : null;
    if (!cursor) return;
    this.#hooks.setCursor(cursor);
    this.close(true);
  }

  #prosConsRegions(object: DescribedObject, g: DescriptionGeometry, fonts: DescriptionFonts): void {
    const text = this.#hooks.text;
    const pros = text.string('gzProsLabel', 0) ?? '';
    const cons = text.string('gzConsLabel', 0) ?? '';
    const indent = Math.max(stringPixLength(pros, fonts.item), stringPixLength(cons, fonts.item)) + PROS_CONS_INDENT_GAP;
    const [bx, by, bw, bh] = g.prosCons;
    const x = g.origin.x + bx + indent;
    const w = bw - indent;
    const h = fontHeight(fonts.item);
    [pros, cons].forEach((label, i) => {
      const y = g.origin.y + by + i * bh;
      const region = this.#hooks.services.regions.define({
        x1: x,
        y1: y,
        x2: x + w - 1,
        y2: y + h - 1,
        priority: Priority.HIGHEST,
        cursor: NO_CURSOR,
        owner: OWNER,
        id: `itemDescription${i === 0 ? 'Pros' : 'Cons'}`,
        onButton: (_r, reason) => {
          if (reason & (MouseReason.LBUTTON_UP | MouseReason.RBUTTON_UP)) this.close(true);
        },
      });
      region.setTooltip(`${label} ${this.#prosCons(object, i === 0, fonts.item, FULL_LIST_LIMIT)}`);
      this.#regions.push(region);
    });
  }

  #prosCons(object: DescribedObject, pros: boolean, font: BitmapFont, limit: number): string {
    const info = this.#hooks.itemInfo(object);
    const ids = (pros ? info?.pros : info?.cons) ?? [];
    const none = this.#hooks.text.string('Message', 38) ?? '';
    const labels = ids.filter((id) => id !== 38).map((id) => this.#hooks.text.string('Message', id) ?? '');
    return prosConsString(labels, font, limit, none);
  }

  #attachmentRegions(object: DescribedObject, g: DescriptionGeometry): void {
    const [ix, iy, iw, ih] = g.attachmentItem;
    g.attachmentSlots.forEach(([sx, sy], i) => {
      const x = ix + sx + g.origin.x;
      const y = iy + sy + g.origin.y;
      let down = false;
      let right = false;
      const region = this.#hooks.services.regions.define({
        x1: x,
        y1: y,
        x2: x + iw,
        y2: y + ih,
        priority: Priority.HIGHEST,
        cursor: NO_CURSOR,
        owner: OWNER,
        id: `itemDescriptionAttachment${i}`,
        onButton: (_r, reason) => {
          if (reason & MouseReason.LBUTTON_DWN) down = true;
          if (reason & MouseReason.RBUTTON_DWN) right = true;
          if (reason & MouseReason.LBUTTON_UP && down) {
            down = false;
            void this.#attachmentPrimary(object, i);
          }
          if (reason & MouseReason.RBUTTON_UP && right) {
            right = false;
            this.#attachmentSecondary(object, i);
          }
        },
      });
      this.#regions.push(region);
    });
    this.#attachmentTooltips(object);
  }

  #attachmentTooltips(object: DescribedObject): void {
    const view = this.#view(object);
    const fallback = this.#hooks.text.string('Message', STR_ATTACHMENTS) ?? '';
    for (let i = 0; i < MAX_ATTACHMENTS; i++) {
      const region = this.#regions.find((r) => r.id === `itemDescriptionAttachment${i}`);
      const attachment = object.kind === 'slot' ? view?.attachments?.[i] : undefined;
      region?.setTooltip(attachment ? (this.#hooks.item(attachment.item)?.longName ?? attachment.item) : fallback);
    }
  }

  async #attachmentPrimary(object: DescribedObject, position: number): Promise<void> {
    if (object.kind !== 'slot') return;
    const cursor = this.#hooks.cursor();
    if (cursor) {
      await this.#attach(object, cursor, false);
      return;
    }
    const soldier = this.#hooks.soldier(object.soldier);
    const next = soldier ? cursorFromAttachment(soldier, object.slot, position) : null;
    if (next) this.#hooks.setCursor(next);
  }

  async #attach(object: DescribedObject & { kind: 'slot' }, cursor: ItemCursor, permanent: boolean): Promise<void> {
    const cmd = attachCommand(cursor, object.soldier, object.slot, object.index, permanent);
    if (!cmd) return;
    const reply = await this.#hooks.send(cmd);
    if (reply.ok) {
      this.#hooks.setCursor(null);
      if (!this.#view(object)) this.close(true);
      else this.#attachmentTooltips(object);
      return;
    }
    if (refusalOf(reply.data) === REFUSAL_PERMANENT_ATTACHMENT && !permanent) {
      const yes = await this.#hooks.confirm(this.#hooks.text.string('Message', STR_PERMANENT_ATTACHMENT) ?? '');
      if (yes) await this.#attach(object, cursor, true);
    }
  }

  #attachmentSecondary(object: DescribedObject, position: number): void {
    if (object.kind !== 'slot') return;
    const view = this.#view(object);
    if (!view?.attachments?.[position]) return;
    this.show({ kind: 'attachment', soldier: object.soldier, slot: object.slot, attachment: position });
  }

  close(notify: boolean): void {
    if (!this.#object) return;
    this.#object = null;
    for (const region of this.#regions) region.remove();
    this.#regions = [];
    this.#ammo?.remove();
    this.#ammo = null;
    for (const button of this.#moneyButtons) button.remove();
    this.#moneyButtons = [];
    this.#money = null;
    if (notify) this.#hooks.closed();
  }

  #hatchesAttachments(object: DescribedObject, item: CatalogueItem): boolean {
    if (object.kind === 'object') return false;
    if (object.kind !== 'slot') return true;
    const cursor = this.#hooks.cursor();
    if (!cursor) return false;
    const cursorItem = this.#hooks.item(cursor.item);
    if (cursorItem?.flags.includes(HIDDEN_ADDON)) return true;
    if (cursor.source.soldier !== object.soldier) return false;
    const placement = this.#hooks.placements()?.slots[object.slot];
    if (!placement) return false;
    return !placement.attach && !placement.merge && item.name !== '';
  }

  render(list: DrawList, ctx: TileDrawContext, images: ImageCatalog): void {
    const object = this.#object;
    const g = this.#geometry;
    const art = this.#art;
    const fonts = this.#fonts;
    if (!object || !g || !art || !fonts) return;
    const itemName = this.#describedItem(object);
    const item = itemName ? this.#hooks.item(itemName) : null;
    if (!item) return;
    const { x: dx, y: dy } = g.origin;
    const text = this.#hooks.text;
    list.image(art.box, 0, dx, dy);
    if (item.name === MONEY) list.image(art.money, 0, g.moneyBox[0] - 1, g.moneyBox[1]);
    this.#bigPicture(list, ctx, images, item, g);
    const view = this.#view(object);
    const statusIndex = object.kind === 'slot' ? object.index : 0;
    if (view) {
      const status =
        item.class === 'AMMO' ? idiv(100 * (view.status[statusIndex] ?? 0), item.magazine?.capacity || 1) : (view.status[statusIndex] ?? 0);
      drawItemStatusBar(list, Math.min(100, status), dx + g.status[0], dy + g.status[1], g.status[3]);
    } else if (object.kind === 'key') drawItemStatusBar(list, 100, dx + g.status[0], dy + g.status[1], g.status[3]);
    this.#attachments(list, ctx, object, item, g);
    if (item.weapon && item.class === 'GUN') this.#bullets(list, art, item, g);
    const font = fonts.item;
    mprint(list, font, dx + g.name[0], dy + g.name[1], item.longName, fontColors(FontColor.WHITE, DEFAULT_SHADOW));
    displayWrappedString(
      list,
      dx + g.description[0],
      dy + g.description[1],
      g.description[2],
      2,
      font,
      { foreground: FontColor.BLACK, shadow: ITEMDESC_FONTSHADOW2, background: FontColor.MCOLOR_BLACK },
      item.description,
      TextFlag.LEFT_JUSTIFIED,
    );
    const info = this.#hooks.itemInfo(object);
    if (item.weapon && item.class === 'GUN') this.#gunTitleAndProsCons(list, object, item, info, g, font);
    const unit = weightUnit(text, this.#hooks.metric());
    if (this.#ammo?.visible) this.#hooks.services.buttons.draw(list, this.#ammo);
    for (const button of this.#moneyButtons) this.#hooks.services.buttons.draw(list, button);
    if (item.weapon) this.#weaponStats(list, item, info, g, font, unit);
    else if (item.name === MONEY) this.#moneyStats(list, info, g, font);
    else if (item.class === 'MONEY') this.#rightAligned(list, font, g.name, sprintMoney(info?.money ?? view?.money ?? 0), FontColor.WHITE);
    else this.#otherStats(list, object, item, view, info, g, font, unit);
  }

  #bigPicture(list: DrawList, ctx: TileDrawContext, images: ImageCatalog, item: CatalogueItem, g: DescriptionGeometry): void {
    const graphic = item.inventoryGraphics.big;
    const path = graphic.path.toLowerCase();
    if (!ctx.ensure(path)) return;
    const frame = images.info(path)?.frames[graphic.subImageIndex];
    if (!frame) return;
    const [bx, by, bw, bh] = g.item;
    const x = g.origin.x + bx + idiv(bw - frame.width, 2) - frame.offsetX;
    const y = g.origin.y + by + idiv(bh - frame.height, 2) - frame.offsetY;
    list.image(path, graphic.subImageIndex, x + SHADOW_DX, y + SHADOW_DY, { effect: { kind: 'outlineShadow' } });
    list.image(path, graphic.subImageIndex, x, y);
  }

  #attachments(list: DrawList, ctx: TileDrawContext, object: DescribedObject, item: CatalogueItem, g: DescriptionGeometry): void {
    const view = object.kind === 'slot' || object.kind === 'object' ? this.#view(object) : null;
    const hatch = this.#hatchesAttachments(object, item);
    const cursor = this.#hooks.cursor()?.source;
    const [ix, iy, iw, ih] = g.attachmentItem;
    const [barX, barY, , barH] = g.attachmentBar;
    g.attachmentSlots.forEach(([sx, sy], i) => {
      const x = g.origin.x + sx;
      const y = g.origin.y + sy;
      const attachment = view?.attachments?.[i];
      const inCursor =
        cursor?.kind === 'attachment' &&
        object.kind === 'slot' &&
        cursor.soldier === object.soldier &&
        cursor.slot === object.slot &&
        cursor.attachment === i;
      if (attachment && view && !inCursor) {
        drawInventoryItem(ctx, view, { x: x + ix, y: y + iy, width: iw, height: ih }, { outline: null, attachmentOf: attachment.item });
        drawItemStatusBar(list, attachment.status, x + barX, y + barY + barH - 1, barH);
      }
      if (hatch) list.hatch(x, y, x + ix + iw - 1, y + iy + ih - 1);
    });
  }

  #bullets(list: DrawList, art: DescriptionArt, item: CatalogueItem, g: DescriptionGeometry): void {
    list.image(art.bullet, 0, g.origin.x + g.bulletSingle[0], g.origin.y + g.bulletSingle[1]);
    let x = g.origin.x + g.bulletBurst[0];
    for (let i = item.weapon?.shotsPerBurst ?? 0; i > 0; i--) {
      list.image(art.bullet, 0, x, g.origin.y + g.bulletBurst[1]);
      x += g.bulletWidth + 1;
    }
  }

  #rightAligned(list: DrawList, font: BitmapFont, box: Box, value: string, colour: number, shadow = DEFAULT_SHADOW): void {
    const origin = this.#geometry?.origin ?? { x: 0, y: 0 };
    const point = hRightVCenterAlign(origin.x + box[0], origin.y + box[1], box[2], box[3], value, font);
    mprint(list, font, point.x, point.y, value, fontColors(colour, shadow));
  }

  #gunTitleAndProsCons(
    list: DrawList,
    object: DescribedObject,
    item: CatalogueItem,
    info: ItemInfo | null,
    g: DescriptionGeometry,
    font: BitmapFont,
  ): void {
    const text = this.#hooks.text;
    const calibre = item.weapon?.calibre?.name;
    const type = text.string('WeaponType', info?.title?.weaponType ?? 0) ?? '';
    let title = calibre ? `${calibre} ${type}` : type;
    const imprint = info?.title?.imprint;
    if (imprint !== null && imprint !== undefined) title += ` (${String(imprint)})`;
    this.#rightAligned(list, font, g.name, title, FontColor.BLACK, ITEMDESC_FONTSHADOW2);
    const [bx, by, bw, bh] = g.prosCons;
    const x = g.origin.x + bx;
    const y = g.origin.y + by;
    const pros = text.string('gzProsLabel', 0) ?? '';
    const cons = text.string('gzConsLabel', 0) ?? '';
    mprint(list, font, x, y, pros, fontColors(FontColor.MCOLOR_DKWHITE, DEFAULT_SHADOW));
    mprint(list, font, x, y + bh, cons, fontColors(FontColor.MCOLOR_DKWHITE, DEFAULT_SHADOW));
    const indent = Math.max(stringPixLength(pros, font), stringPixLength(cons, font)) + PROS_CONS_INDENT_GAP;
    const limit = bw - indent - stringPixLength(DOTDOTDOT, font);
    mprint(list, font, x + indent, y, this.#prosCons(object, true, font, limit), fontColors(FontColor.BLACK, ITEMDESC_FONTSHADOW2));
    mprint(list, font, x + indent, y + bh, this.#prosCons(object, false, font, limit), fontColors(FontColor.BLACK, ITEMDESC_FONTSHADOW2));
  }

  #label(list: DrawList, font: BitmapFont, at: StatPosition | undefined, value: string): void {
    if (!at) return;
    const origin = this.#geometry?.origin ?? { x: 0, y: 0 };
    mprint(list, font, origin.x + at[0], origin.y + at[1], value, fontColors(STATS_TITLE, DEFAULT_SHADOW));
  }

  #value(list: DrawList, font: BitmapFont, at: StatPosition | undefined, value: string, colour: number, width = ITEM_STATS_WIDTH): void {
    if (!at) return;
    const origin = this.#geometry?.origin ?? { x: 0, y: 0 };
    const point = hRightVCenterAlign(origin.x + at[0] + at[2], origin.y + at[1], width, ITEM_STATS_HEIGHT, value, font);
    mprint(list, font, point.x, point.y, value, fontColors(colour, DEFAULT_SHADOW));
  }

  #weaponStats(list: DrawList, item: CatalogueItem, info: ItemInfo | null, g: DescriptionGeometry, font: BitmapFont, unit: string): void {
    const text = this.#hooks.text;
    const desc = (i: number) => text.string('gWeaponStatsDesc', i) ?? '';
    const ids = g.weaponStats;
    const gunOrLauncher = item.class === 'GUN' || item.class === 'LAUNCHER';
    const damaging = item.class !== 'LAUNCHER' && item.name !== 'ROCKET_LAUNCHER';
    this.#label(list, font, ids[0], printf(desc(WEIGHT_LABEL), [unit]));
    if (gunOrLauncher) this.#label(list, font, ids[2], desc(RANGE_LABEL));
    if (damaging) this.#label(list, font, ids[3], desc(DAMAGE_LABEL));
    this.#label(list, font, ids[4], desc(AP_LABEL));
    if (item.class === 'GUN') this.#label(list, font, ids[6], desc(EQUALS_LABEL));
    this.#label(list, font, ids[1], desc(STATUS_LABEL));
    if ((item.weapon?.shotsPerBurst ?? 0) > 0) this.#label(list, font, ids[7], desc(EQUALS_LABEL));
    const stats = info?.weapon;
    if (!stats) return;
    const highlight = (on: boolean) => (on ? FontColor.MCOLOR_WHITE : STATS_TEXT);
    this.#value(list, font, ids[1], `${twoDigits(stats.status)}%`, STATS_TEXT);
    this.#value(list, font, ids[0], stats.weight.value.toFixed(1), highlight(stats.weight.exceptional));
    if (gunOrLauncher && stats.range)
      this.#value(list, font, ids[2], twoDigits(idiv(stats.range.value, 10)), highlight(stats.range.exceptional));
    if (damaging && stats.damage) this.#value(list, font, ids[3], twoDigits(stats.damage.value), highlight(stats.damage.exceptional));
    this.#value(list, font, ids[4], twoDigits(stats.ap.value), highlight(stats.ap.exceptional));
    if (stats.burstAp) this.#value(list, font, ids[5], twoDigits(stats.burstAp.value), highlight(stats.burstAp.exceptional));
  }

  #moneyStats(list: DrawList, _info: ItemInfo | null, g: DescriptionGeometry, font: BitmapFont): void {
    const box = this.#money;
    if (!box) return;
    const text = this.#hooks.text;
    this.#rightAligned(list, font, g.name, sprintMoney(box.total), FontColor.WHITE);
    const origin = g.origin;
    const [labelX, labelY] = g.moneyButtons[MONEY_LABEL] ?? [0, 0];
    mprint(
      list,
      font,
      g.moneyBox[0] + labelX,
      g.moneyBox[1] + labelY,
      text.string('gzMoneyAmounts', box.withdraw ? MONEY_WITHDRAW : MONEY_SEPARATE) ?? '',
      fontColors(STATS_TITLE, DEFAULT_SHADOW),
    );
    const first = box.withdraw ? MONEY_DESC_PLAYERS : MONEY_DESC_AMOUNT;
    g.moneyStats.forEach((at, i) => {
      mprint(
        list,
        font,
        origin.x + at[0],
        origin.y + at[1],
        text.string('gMoneyStatsDesc', first + i) ?? '',
        fontColors(STATS_TITLE, DEFAULT_SHADOW),
      );
    });
    this.#value(list, font, g.moneyStats[1], sprintMoney(box.remaining), STATS_TEXT, MONEY_VALUE_WIDTH);
    this.#value(list, font, g.moneyStats[3], sprintMoney(box.removing), STATS_TEXT, MONEY_VALUE_WIDTH);
  }

  #otherStats(
    list: DrawList,
    object: DescribedObject,
    item: CatalogueItem,
    view: InventoryItemView | null,
    info: ItemInfo | null,
    g: DescriptionGeometry,
    font: BitmapFont,
    unit: string,
  ): void {
    const text = this.#hooks.text;
    const desc = (i: number) => text.string('gWeaponStatsDesc', i) ?? '';
    const ids = g.weaponStats;
    const ammo = item.class === 'AMMO';
    this.#label(list, font, ids[1], desc(ammo ? AMOUNT_LABEL : STATUS_LABEL));
    this.#label(list, font, ids[0], printf(desc(WEIGHT_LABEL), [unit]));
    const index = object.kind === 'slot' ? object.index : 0;
    if (ammo) {
      const shots = info?.amount?.shots ?? view?.status[index] ?? 0;
      const capacity = info?.amount?.capacity ?? item.magazine?.capacity ?? 0;
      this.#value(list, font, ids[1], `${shots}/${capacity}`, STATS_TEXT);
    } else {
      const status = object.kind === 'key' ? 100 : (view?.status[index] ?? info?.status ?? 0);
      this.#value(list, font, ids[1], `${twoDigits(status)}%`, STATS_TEXT);
    }
    if (info) this.#value(list, font, ids[0], info.weight.toFixed(1), STATS_TEXT);
    if (object.kind === 'key' || item.class === 'KEY') this.#keyStats(list, object, g, font);
  }

  #keyStats(list: DrawList, object: DescribedObject, g: DescriptionGeometry, font: BitmapFont): void {
    const at = g.weaponStats[3];
    if (!at) return;
    const text = this.#hooks.text;
    const x = g.origin.x + at[0];
    const y0 = g.origin.y + at[1];
    const y1 = y0 + fontHeight(font) + 2;
    mprint(list, font, x, y0, text.string('sKeyDescriptionStrings', 0) ?? '', fontColors(STATS_TITLE, DEFAULT_SHADOW));
    mprint(list, font, x, y1, text.string('sKeyDescriptionStrings', 1) ?? '', fontColors(STATS_TITLE, DEFAULT_SHADOW));
    const key = this.#key(object);
    if (!key) return;
    const sector = sectorShortString(key.sectorFound ?? 0);
    const day = String(key.dayFound ?? 0);
    const p0 = hRightVCenterAlign(x, y0, KEY_TEXT_WIDTH, ITEM_STATS_HEIGHT, sector, font);
    mprint(list, font, p0.x, p0.y, sector, fontColors(STATS_TEXT, DEFAULT_SHADOW));
    const p1 = hRightVCenterAlign(x, y1, KEY_TEXT_WIDTH, ITEM_STATS_HEIGHT, day, font);
    mprint(list, font, p1.x, p1.y, day, fontColors(STATS_TEXT, DEFAULT_SHADOW));
  }
}

const SECTORS_PER_ROW = 16;
const ROW_LETTERS = 'ABCDEFGHIJKLMNOP';

export function sectorShortString(sectorId: number): string {
  const row = idiv(sectorId, SECTORS_PER_ROW);
  const column = (sectorId % SECTORS_PER_ROW) + 1;
  return `${ROW_LETTERS[row] ?? '?'}${column}`;
}
