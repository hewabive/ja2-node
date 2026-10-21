// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ShopKeeper_Interface.cc DisplayInvSlot (the small graphic at x + 7 + |SKI_INV_WIDTH - 3 - w| / 2,
// @src y + |SKI_INV_HEIGHT - h| / 2 with its offsets, the outline shadow at (-2, +2) and the white outline of a matching
// @src gun, ammo or attachment, the status bar at x + 2, y + 21 in RGB 140, 136, 119, the price or the repair ETA in
// @src SKI_ITEM_DESC_FONT centred in SKI_INV_SLOT_WIDTH at SKI_INV_PRICE_OFFSET_X/Y, the "x n" count right-aligned in
// @src SKIT_NUMBER_FONT, the owner's 33face at SKI_SMALL_FACE_OFFSET_X, the attachment star, JAMMED or REPAIRED in
// @src TINYFONT1 FONT_RED centred in SKI_INV_SLOT_WIDTH × SKI_INV_HEIGHT, the hatch), HatchOutInvSlot,
// @src IsGunOrAmmoOfSameTypeSelected; src/game/Tactical/Interface_Utils.cc DrawItemUIBarEx; src/game/Utils/MercPortrait.cc
// @src Load33Portrait (faces/33face/NN.sti); src/game/Tactical/Interface_Items.cc GetAttachmentHintColor.

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import { type DrawList, type RgbColor, rgb } from '../../draw-list.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { drawTextToScreen, TextFlag } from '../../text/wrap.ts';
import type { TileDrawContext } from '../tactical/item-tile.ts';

export const SKI_INV_SLOT_WIDTH = 67;
export const SKI_INV_SLOT_HEIGHT = 31;
const SKI_INV_WIDTH = 60;
const SKI_INV_HEIGHT = 24;
const GRAPHIC_X = 7;
const GRAPHIC_SLACK = 3;
const SHADOW_DX = -2;
const SHADOW_DY = 2;
const BAR_X = 2;
const BAR_Y = 21;
const BAR_HEIGHT = 20;
const BAR_COLOUR = rgb(140, 136, 119);
const PRICE_X = 1;
const PRICE_Y = 24;
const COUNT_X = 50;
const COUNT_Y = 15;
const COUNT_WIDTH = 15;
const FACE_X = 52;
const STAR_X = 56;
const STAR_Y = 14;
const FULL = 100;
const FACES_33 = 'faces/33face';
const LAUNCHER_CLASS = 'LAUNCHER';
const KEY_CLASS = 'KEY';
const AMMO_CLASS = 'AMMO';
export const MATCH_OUTLINE: RgbColor = rgb(255, 255, 255);

export interface ShopTileFonts {
  readonly price: BitmapFont;
  readonly count: BitmapFont;
  readonly tiny: BitmapFont;
}

export interface ShopTile {
  readonly item: string;
  readonly count: number;
  readonly status: number;
  readonly attachments: readonly string[];
  readonly jammed: boolean;
  readonly priceText: string | null;
  readonly showCount: boolean;
  readonly ownerFace: number | null;
  readonly repaired: boolean;
  readonly hatched: boolean;
  readonly outline: RgbColor | null;
}

export function smallFace33Path(faceIndex: number): string {
  return `${FACES_33}/${String(faceIndex).padStart(2, '0')}.sti`;
}

export function statusBarValue(item: CatalogueItem | null, status: number): number {
  if (item?.class === KEY_CLASS) return FULL;
  if (item?.class === AMMO_CLASS) return Math.min(FULL, idiv(FULL * status, item.magazine?.capacity || 1));
  return status;
}

export function hatchSlot(list: DrawList, x: number, y: number): void {
  list.hatch(x, y, x + SKI_INV_SLOT_WIDTH - 1, y + SKI_INV_SLOT_HEIGHT - 1);
}

export function drawShopTile(
  ctx: TileDrawContext,
  fonts: ShopTileFonts,
  tile: ShopTile,
  x: number,
  y: number,
  jammedText: string,
  repairedText: string,
): void {
  const { list } = ctx;
  const item = ctx.items.item(tile.item);
  if (item) {
    const graphic = item.inventoryGraphics.small;
    const path = graphic.path.toLowerCase();
    const frame = ctx.ensure(path) ? ctx.images.info(path)?.frames[graphic.subImageIndex] : undefined;
    if (frame) {
      const cx = x + GRAPHIC_X + idiv(Math.abs(SKI_INV_WIDTH - GRAPHIC_SLACK - frame.width), 2) - frame.offsetX;
      const cy = y + idiv(Math.abs(SKI_INV_HEIGHT - frame.height), 2) - frame.offsetY;
      list.image(path, graphic.subImageIndex, cx + SHADOW_DX, cy + SHADOW_DY, { effect: { kind: 'outlineShadow' } });
      list.image(path, graphic.subImageIndex, cx, cy, { effect: { kind: 'outline', color: tile.outline } });
    }
  }
  const height = idiv((BAR_HEIGHT - 1) * statusBarValue(item, tile.status), FULL);
  list.line(x + BAR_X, y + BAR_Y, x + BAR_X, y + BAR_Y - height, BAR_COLOUR);
  list.line(x + BAR_X + 1, y + BAR_Y, x + BAR_X + 1, y + BAR_Y - height, BAR_COLOUR);
  const white = fontColors(FontColor.MCOLOR_WHITE, DEFAULT_SHADOW);
  if (tile.priceText)
    drawTextToScreen(list, tile.priceText, x + PRICE_X, y + PRICE_Y, SKI_INV_SLOT_WIDTH, fonts.price, white, TextFlag.CENTER_JUSTIFIED);
  if (tile.showCount)
    drawTextToScreen(list, `x${tile.count}`, x + COUNT_X, y + COUNT_Y, COUNT_WIDTH, fonts.count, white, TextFlag.RIGHT_JUSTIFIED);
  if (tile.ownerFace !== null) {
    const face = smallFace33Path(tile.ownerFace);
    if (ctx.ensure(face)) list.image(face, 0, x + FACE_X, y);
  }
  if (tile.attachments.length > 0) {
    const launcher = tile.attachments.some((a) => ctx.items.item(a)?.class === LAUNCHER_CLASS);
    mprint(list, fonts.tiny, x + STAR_X, y + STAR_Y, '*', fontColors(launcher ? FontColor.YELLOW : FontColor.GREEN, DEFAULT_SHADOW));
  }
  const overlay = tile.jammed ? jammedText : tile.repaired ? repairedText : '';
  if (overlay) {
    const at = hCenterVCenterAlign(x, y, SKI_INV_SLOT_WIDTH, SKI_INV_HEIGHT, overlay, fonts.tiny);
    mprint(list, fonts.tiny, at.x, at.y, overlay, fontColors(FontColor.RED, DEFAULT_SHADOW));
  }
  if (tile.hatched) hatchSlot(list, x, y);
}
