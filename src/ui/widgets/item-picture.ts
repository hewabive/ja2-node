// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMMembers.cc DisplayMercsInventory (the small inventory graphic centred in its box with
// @src abs((box - width) / 2) minus the frame offset, BltVideoObjectOutlineShadow two pixels left and down when
// @src gamepolicy(f_draw_item_shadow), then BltVideoObjectOutline with SGP_TRANSPARENT); src/game/Tactical/Interface_Items.cc
// @src GetSmallInventoryGraphicForItem. See docs/28 §3.11, §9.

import { idiv } from '../../core/int.ts';
import { type FrameMetrics, frameOf, type ImageCatalog } from '../assets.ts';
import type { AssetKey, DrawList } from '../draw-list.ts';

export interface ItemGraphic {
  readonly path: AssetKey;
  readonly frame: number;
}

export interface ItemBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const SHADOW_DX = -2;
const SHADOW_DY = 2;

export function isItemGraphic(value: unknown): value is ItemGraphic {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Record<string, unknown>;
  return typeof g.path === 'string' && typeof g.frame === 'number';
}

export function centredItemPosition(box: ItemBox, frame: FrameMetrics): { x: number; y: number } {
  return {
    x: box.x + idiv(Math.abs(box.width - frame.width), 2) - frame.offsetX,
    y: box.y + idiv(Math.abs(box.height - frame.height), 2) - frame.offsetY,
  };
}

export function drawItemPicture(list: DrawList, images: ImageCatalog, graphic: ItemGraphic, box: ItemBox, shadow: boolean): void {
  const at = centredItemPosition(box, frameOf(images, graphic.path, graphic.frame));
  if (shadow) list.image(graphic.path, graphic.frame, at.x + SHADOW_DX, at.y + SHADOW_DY, { effect: { kind: 'outlineShadow' } });
  list.image(graphic.path, graphic.frame, at.x, at.y, { effect: { kind: 'outline', color: null } });
}
