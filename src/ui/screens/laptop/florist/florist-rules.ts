// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Florist_Gallery.cc FLOR_GALLERY_NUMBER_FLORAL_IMAGES, InitFlowerButtons (three flowers a page, the
// @src next button disabled at index FLOR_GALLERY_NUMBER_FLORAL_IMAGES - 1), BtnFloralGalleryNextButtonCallback,
// @src BtnFloralGalleryBackButtonCallback, ChangingFloristGallerySubPage (four pages, the visited flags);
// @src src/game/Laptop/Florist_Order_Form.cc gubFlowerOrder_AdditioanalServicePrices, SelectFlorsitCheckBoxRegionCallBack
// @src (the next-day pair toggles together, the extras alone), DisplayFloristCheckBox, DisplayFlowerDynamicItems (the
// @src extras, the bouquet price and the delivery cost in "$N.00 USD"); src/game/Laptop/Florist_Cards.cc RenderFloristCards
// @src (the saying centred with UINT16 arithmetic). See docs/28 §9.8.

import { idiv, u16 } from '../../../../core/int.ts';
import type { FloristOrderMemory } from '../pages-memory.ts';

export const FLOWERS = 10;
export const FLOWERS_PER_PAGE = 3;
export const GALLERY_PAGES = 4;
export const ORDER_CHECK_BOXES = 6;
export const EXTRA_PRICES: readonly number[] = [10, 20, 10, 10];
const EXTRA_NAMES = ['crushed', 'blackRoses', 'wilted', 'fruitCake'] as const;
const NEXT_DAY_BOX = 0;
const GETS_THERE_BOX = 1;
const FIRST_EXTRA_BOX = 2;
const CHECK_UP = 0;
const CHECK_DOWN = 1;

export interface FlowerDelivery {
  readonly nextDay: number;
  readonly whenItGetsThere: number;
}

export function flowersOnPage(index: number): number {
  return Math.min(FLOWERS_PER_PAGE, FLOWERS - index);
}

export function nextGalleryIndex(index: number): number {
  return index + FLOWERS_PER_PAGE <= FLOWERS ? index + FLOWERS_PER_PAGE : index;
}

export function previousGalleryIndex(index: number): number {
  return index >= FLOWERS_PER_PAGE ? index - FLOWERS_PER_PAGE : 0;
}

export function galleryNextEnabled(index: number): boolean {
  return index !== FLOWERS - 1;
}

export function gallerySubPage(index: number): number {
  return Math.min(Math.trunc(index / FLOWERS_PER_PAGE), GALLERY_PAGES - 1);
}

export class SubPageVisits {
  readonly #visited = new Set<number>();

  visit(page: number): boolean {
    const fast = this.#visited.has(page);
    this.#visited.add(page);
    return fast;
  }
}

function extras(order: FloristOrderMemory): readonly boolean[] {
  return [order.crushed, order.blackRoses, order.wilted, order.fruitCake];
}

export function toggleOrderCheck(order: FloristOrderMemory, box: number): void {
  switch (box) {
    case NEXT_DAY_BOX:
    case GETS_THERE_BOX:
      order.nextDay = !order.nextDay;
      return;
    case FIRST_EXTRA_BOX:
      order.crushed = !order.crushed;
      return;
    case FIRST_EXTRA_BOX + 1:
      order.blackRoses = !order.blackRoses;
      return;
    case FIRST_EXTRA_BOX + 2:
      order.wilted = !order.wilted;
      return;
    case FIRST_EXTRA_BOX + 3:
      order.fruitCake = !order.fruitCake;
      return;
  }
}

export function orderCheckFrames(order: FloristOrderMemory): number[] {
  return [order.nextDay, !order.nextDay, ...extras(order)].map((down) => (down ? CHECK_DOWN : CHECK_UP));
}

export function orderExtras(order: FloristOrderMemory): string[] {
  return EXTRA_NAMES.filter((_, i) => extras(order)[i]);
}

export function flowerOrderPrice(order: FloristOrderMemory, bouquetPrice: number, delivery: FlowerDelivery): number {
  const added = extras(order).reduce((sum, on, i) => (on ? sum + (EXTRA_PRICES[i] ?? 0) : sum), 0);
  return added + bouquetPrice + (order.nextDay ? delivery.nextDay : delivery.whenItGetsThere);
}

export function dollarsText(amount: number, usDollar: string): string {
  return `$${amount}.00 ${usDollar}`;
}

export function cardTextY(cardY: number, textHeight: number, boxHeight: number): number {
  return u16(cardY + 10 + u16(idiv(boxHeight - textHeight, 2)));
}
