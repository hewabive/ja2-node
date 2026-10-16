// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Florist_Order_Form.cc gubFlowerOrder_AdditioanalServicePrices, DisplayFlowerDynamicItems (price without
// @src the bouquet price, which is original text), BtnFlowerOrderSendButtonCallback; Florist_Gallery.cc
// @src FLOR_GALLERY_NUMBER_FLORAL_IMAGES; Strategic/Meanwhile.cc HandleFlowersMeanwhileScene. See docs/21 §7.3.

import { sectorFromId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import type { LaptopContext } from './context.ts';

export const FLORIST_EXTRAS = ['crushed', 'blackRoses', 'wilted', 'fruitCake'] as const;
export type FloristExtra = (typeof FLORIST_EXTRAS)[number];
const EXTRA_PRICES: Readonly<Record<FloristExtra, number>> = { crushed: 10, blackRoses: 20, wilted: 10, fruitCake: 10 };
const BOUQUETS = 10;
const MEDUNA = 11;
const FLOWERS_NEXT_DAY_CODE = 0;
const FLOWERS_LATER_CODE = 1;

export interface FlowerOrder {
  readonly bouquet: number;
  readonly destination: number;
  readonly nextDay: boolean;
  readonly extras: readonly string[];
}

export type FlowerRefusal = 'noSuchBouquet' | 'noDestination' | 'badExtra';

export interface FlowerHooks {
  flowersMeanwhile(code: number): void;
}

export function flowerPrice(ctx: LaptopContext, order: FlowerOrder): number | FlowerRefusal {
  if (!Number.isInteger(order.bouquet) || order.bouquet < 0 || order.bouquet >= BOUQUETS) return 'noSuchBouquet';
  const destination = ctx.content.destinations[order.destination];
  if (!destination) return 'noDestination';
  if (!order.extras.every((e): e is FloristExtra => (FLORIST_EXTRAS as readonly string[]).includes(e))) return 'badExtra';
  const extras = new Set(order.extras as readonly FloristExtra[]);
  let price = 0;
  for (const e of FLORIST_EXTRAS) if (extras.has(e)) price += EXTRA_PRICES[e];
  return price + (order.nextDay ? destination.flowersNextDayCost : destination.flowersWhenItGetsThereCost);
}

export function orderFlowers(ctx: LaptopContext, order: FlowerOrder, hooks: FlowerHooks): { readonly price: number } | FlowerRefusal {
  const price = flowerPrice(ctx, order);
  if (typeof price === 'string') return price;
  ctx.emitMoney(addTransaction(ctx.state.finances, FinanceCode.PURCHASED_FLOWERS, 0, ctx.now(), -price));
  const destination = ctx.content.destinations[order.destination];
  const sector = destination?.deliverySector;
  const town = sector === null || sector === undefined ? 0 : (ctx.state.map.elements[strategicIndex(sectorFromId(sector))]?.nameId ?? 0);
  if (town === MEDUNA) hooks.flowersMeanwhile(order.nextDay ? FLOWERS_NEXT_DAY_CODE : FLOWERS_LATER_CODE);
  return { price };
}
