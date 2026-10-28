// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc INVRenderItem (the small graphic centred in the box with its offsets, the
// @src outline shadow at (-2,+2), the index-254 outline colour, the rounds left by ammo type, JAMMED, the stack count, the
// @src attachment star, the weapon mode marker), GetAttachmentHintColor, ITEMDESC_FONT*FORE; src/game/Tactical/Weapons.h
// @src AMMO_*; src/game/Tactical/Interface_Utils.cc DrawItemUIBarEx (the status of keys, ammo and other items).

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { InventoryItemView, WeaponModeView } from '../../../protocol/view.ts';
import type { ImageCatalog } from '../../assets.ts';
import type { DrawList, RgbColor } from '../../draw-list.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign, stringPixLength } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';

export const RENDER_ITEM_NOSTATUS = 20;
export const BIG_INV_SLOT_WIDTH = 61;
const ITEMDESC_FONTAPFORE = 218;
const ITEMDESC_FONTHPFORE = 24;
const ITEMDESC_FONTBSFORE = 125;
const ITEMDESC_FONTHEFORE = 75;
const ITEMDESC_FONTHEAPFORE = 76;
const JAMMED_ITEM_STR = 43;
const SHORT_JAMMED_GUN = 117;
const TEXT_ROW_FROM_BOTTOM = 10;
const COUNT_MARGIN = 4;
const MODE_MARKER_Y = 13;
const FULL = 100;
const SHADOW_DX = -2;
const SHADOW_DY = 2;
const ROCKET_LAUNCHER = 'ROCKET_LAUNCHER';
const GUN_CLASS = 'GUN';
const AMMO_CLASS = 'AMMO';
const KEY_CLASS = 'KEY';
const LAUNCHER_CLASS = 'LAUNCHER';

const AmmoType = { AP: 2, SUPER_AP: 3, HP: 1, BUCKSHOT: 4, HE: 9, HEAT: 10 } as const;

export interface ItemLookup {
  item(name: string): CatalogueItem | null;
}

export interface TileDrawContext {
  readonly list: DrawList;
  readonly images: ImageCatalog;
  readonly items: ItemLookup;
  readonly font: BitmapFont;
  readonly text: UiTextService;
  readonly ensure: (path: string) => boolean;
}

export interface TileBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TileOptions {
  readonly outline: RgbColor | null;
  readonly statusIndex?: number;
  readonly weaponMode?: WeaponModeView | null;
  readonly attachmentOf?: string;
}

function ammoColour(type: number | null): number {
  switch (type) {
    case AmmoType.AP:
    case AmmoType.SUPER_AP:
      return ITEMDESC_FONTAPFORE;
    case AmmoType.HP:
      return ITEMDESC_FONTHPFORE;
    case AmmoType.BUCKSHOT:
      return ITEMDESC_FONTBSFORE;
    case AmmoType.HE:
      return ITEMDESC_FONTHEFORE;
    case AmmoType.HEAT:
      return ITEMDESC_FONTHEAPFORE;
    default:
      return FontColor.MCOLOR_DKGRAY;
  }
}

export function drawItemGraphic(ctx: TileDrawContext, item: CatalogueItem, box: TileBox, outline: RgbColor | null): void {
  const graphic = item.inventoryGraphics.small;
  const path = graphic.path.toLowerCase();
  if (!ctx.ensure(path)) return;
  const frame = ctx.images.info(path)?.frames[graphic.subImageIndex];
  if (!frame) return;
  const x = box.x + idiv(box.width - frame.width, 2) - frame.offsetX;
  const y = box.y + idiv(box.height - frame.height, 2) - frame.offsetY;
  ctx.list.image(path, graphic.subImageIndex, x + SHADOW_DX, y + SHADOW_DY, { effect: { kind: 'outlineShadow' } });
  ctx.list.image(path, graphic.subImageIndex, x, y, { effect: { kind: 'outline', color: outline } });
}

function attachmentHintColour(view: InventoryItemView, items: ItemLookup): number {
  const launcher = (view.attachments ?? []).some((a) => items.item(a.item)?.class === LAUNCHER_CLASS);
  return launcher ? FontColor.YELLOW : FontColor.GREEN;
}

export function drawInventoryItem(ctx: TileDrawContext, view: InventoryItemView, box: TileBox, options: TileOptions): void {
  const name = options.attachmentOf ?? view.item;
  const item = ctx.items.item(name);
  if (!item) return;
  drawItemGraphic(ctx, item, box, options.outline);
  if (options.attachmentOf !== undefined) return;
  const { list, font } = ctx;
  if (item.class === GUN_CLASS && view.item !== ROCKET_LAUNCHER) {
    const magazine = view.ammo ? ctx.items.item(view.ammo.item)?.magazine : null;
    const shots = view.ammo?.shots ?? 0;
    mprint(
      list,
      font,
      box.x + 1,
      box.y + box.height - TEXT_ROW_FROM_BOTTOM,
      String(shots),
      fontColors(ammoColour(magazine?.ammoType ?? null), DEFAULT_SHADOW),
    );
    if (view.jammed) {
      const jammed = ctx.text.string('TacticalStr', box.width >= BIG_INV_SLOT_WIDTH - 10 ? JAMMED_ITEM_STR : SHORT_JAMMED_GUN) ?? '';
      const at = hCenterVCenterAlign(box.x, box.y, box.width, box.height, jammed, font);
      mprint(list, font, at.x, at.y, jammed, fontColors(FontColor.MCOLOR_RED, DEFAULT_SHADOW));
    }
  } else if (options.statusIndex !== RENDER_ITEM_NOSTATUS && view.count > 1) {
    const text = String(view.count);
    mprint(
      list,
      font,
      box.x + box.width - stringPixLength(text, font) - COUNT_MARGIN,
      box.y + box.height - TEXT_ROW_FROM_BOTTOM,
      text,
      fontColors(FontColor.GRAY4, DEFAULT_SHADOW),
    );
  }
  if ((view.attachments ?? []).length > 0) {
    const star = '*';
    mprint(
      list,
      font,
      box.x + box.width - stringPixLength(star, font) - COUNT_MARGIN,
      box.y,
      star,
      fontColors(attachmentHintColour(view, ctx.items), DEFAULT_SHADOW),
    );
  }
  const mode = options.weaponMode;
  if (mode && mode !== 'single' && item.class === GUN_CLASS) {
    const marker = mode === 'burst' ? '*' : '+';
    mprint(
      list,
      font,
      box.x + box.width - stringPixLength(marker, font) - COUNT_MARGIN,
      box.y + MODE_MARKER_Y,
      marker,
      fontColors(FontColor.DKRED, DEFAULT_SHADOW),
    );
  }
}

export function itemStatusValue(view: InventoryItemView, items: ItemLookup, index: number): number {
  const item = items.item(view.item);
  if (item?.class === KEY_CLASS) return FULL;
  const status = view.status[index] ?? 0;
  if (item?.class === AMMO_CLASS) {
    const capacity = item.magazine?.capacity || 1;
    return Math.min(FULL, idiv(FULL * status, capacity));
  }
  return status;
}
