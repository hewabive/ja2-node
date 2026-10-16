// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.cc CalcValueOfItemToDealer; ShopKeeper_Interface.cc CalcShopKeeperItemPrice,
// @src ItemConditionModifier. See docs/23 §7.

import { ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../../../content/items/items.ts';
import { DEFAULT_WEAPON_SALE_MODIFIER, doesItemAppearInDealerInventoryList } from '../../../../content/strategic/merchant-content.ts';
import { i8, idiv, u16, u32 } from '../../../../core/int.ts';
import { type ItemObject, MAX_OBJECTS_PER_SLOT } from '../../../items/object.ts';
import { dealerDef, type MerchantContext, MerchantFact, role } from './context.ts';

const PriceClass = { JUNK: 0, CHEAP: 1, EXPENSIVE: 2 } as const;
const JUNK_PRICE_LIMIT = 100;
const CHEAP_PRICE_LIMIT = 1000;
const OUT_OF_CLASS_DIVISOR = 3;
const TONY_SPECIALITY_DIVISOR = 2;
const MIN_DEALER_VALUE = 1;
const MIN_SELLING_PRICE = 1;
const REPAIRABLE_FLOOR = 0.5;
const REPAIRABLE_STATUS_DIVISOR = 200;
const STATUS_DIVISOR = 100;
const PERCENT = 100;
const WEAPON_SALE_CLASSES = ItemClass.GUN | ItemClass.BLADE | ItemClass.THROWING_KNIFE | ItemClass.LAUNCHER | ItemClass.AMMO;

function itemPriceClass(price: number): number {
  if (price < JUNK_PRICE_LIMIT) return PriceClass.JUNK;
  return price < CHEAP_PRICE_LIMIT ? PriceClass.CHEAP : PriceClass.EXPENSIVE;
}

function dealerPriceClass(ctx: MerchantContext, dealer: number): number | null {
  if (dealer === role(ctx, 'JAKE')) return PriceClass.JUNK;
  if (dealer === role(ctx, 'KEITH')) return PriceClass.CHEAP;
  if (dealer === role(ctx, 'FRANZ')) return PriceClass.EXPENSIVE;
  return null;
}

function listedBy(ctx: MerchantContext, roleName: 'MICKY' | 'GABBY' | 'TONY', item: number): boolean {
  const d = ctx.content.dealers[role(ctx, roleName)];
  return d !== undefined && doesItemAppearInDealerInventoryList(d, item, true);
}

export function calcValueOfItemToDealer(ctx: MerchantContext, dealer: number, item: number, dealerSelling: boolean): number {
  const def = ctx.items.byIndex.get(item);
  const base = def?.price ?? 0;
  if (base === 0) return 0;
  const dealerClass = dealerPriceClass(ctx, dealer);
  if (dealerClass === null) return doesItemAppearInDealerInventoryList(dealerDef(ctx, dealer), item, true) ? base : 0;
  if (item !== ctx.content.itemIds.JAR && (listedBy(ctx, 'MICKY', item) || listedBy(ctx, 'GABBY', item))) return 0;
  const itemClass = def?.itemClass ?? 0;
  if (dealer === role(ctx, 'KEITH') && itemClass & (ItemClass.GUN | ItemClass.LAUNCHER) && !ctx.hooks.fact(MerchantFact.HILLBILLIES_KILLED))
    return 0;
  const priceClass = itemPriceClass(base);
  if (!dealerSelling && Math.abs(dealerClass - priceClass) === 2) return 0;
  let value = base;
  if (dealerClass !== priceClass && item !== ctx.content.itemIds.GAS_CAN) value = Math.trunc(value / OUT_OF_CLASS_DIVISOR);
  if (listedBy(ctx, 'TONY', item)) value = Math.trunc(value / TONY_SPECIALITY_DIVISOR);
  return u16(value === 0 ? MIN_DEALER_VALUE : value);
}

export function itemConditionModifier(items: ItemTable, item: number, statusIn: number): number {
  const def = items.byIndex.get(item);
  const status = i8(statusIn);
  if (def?.itemClass === ItemClass.AMMO) {
    const capacity = def.magazine?.capacity ?? 0;
    return Math.fround(status / (capacity ? capacity : 1));
  }
  const s = Math.abs(status);
  if ((def?.flags ?? 0) & ItemFlags.REPAIRABLE) return Math.fround(REPAIRABLE_FLOOR + Math.fround(s / REPAIRABLE_STATUS_DIVISOR));
  return Math.fround(s / STATUS_DIVISOR);
}

function term(ctx: MerchantContext, dealer: number, item: number, status: number, dealerSelling: boolean, modifier: number): number {
  const value = calcValueOfItemToDealer(ctx, dealer, item, dealerSelling);
  return u32(Math.trunc(Math.fround(Math.fround(value * itemConditionModifier(ctx.items, item, status)) * modifier)));
}

export interface PriceInput {
  readonly dealer: number;
  readonly dealerSelling: boolean;
  readonly unitOnly: boolean;
  readonly modifier: number;
  readonly weaponSaleModifier?: number;
}

export function calcShopKeeperItemPrice(ctx: MerchantContext, input: PriceInput, o: ItemObject): number {
  const { dealer, dealerSelling, unitOnly, modifier } = input;
  const items = ctx.items;
  const itemClass = items.byIndex.get(o.item)?.itemClass ?? 0;
  let unit = 0;
  let notCounted: number;
  if (itemClass === ItemClass.GUN) {
    unit += term(ctx, dealer, o.item, o.status[0] ?? 0, dealerSelling, modifier);
    if (o.gunAmmoItem !== NOTHING) {
      const shots = items.byIndex.get(o.gunAmmoItem)?.itemClass === ItemClass.AMMO ? o.gunShotsLeft : o.gunAmmoStatus;
      unit += term(ctx, dealer, o.gunAmmoItem, shots, dealerSelling, modifier);
    }
    notCounted = o.count - 1;
  } else {
    const overloaded = o.count > MAX_OBJECTS_PER_SLOT;
    const toCount = overloaded ? 1 : o.count;
    notCounted = overloaded ? o.count - 1 : 0;
    for (let k = 0; k < toCount; k++) {
      unit += term(ctx, dealer, o.item, o.status[k] ?? 0, dealerSelling, modifier);
      if (unitOnly) break;
    }
  }
  for (const a of o.attachments) if (a.item !== NOTHING) unit += term(ctx, dealer, a.item, a.status, dealerSelling, modifier);
  unit = u32(unit);
  if (itemClass & WEAPON_SALE_CLASSES) {
    const m = input.weaponSaleModifier ?? DEFAULT_WEAPON_SALE_MODIFIER;
    const signed = unit | 0;
    const discount = idiv(signed * (m - PERCENT), PERCENT);
    unit = dealerSelling ? u32(Math.max(MIN_SELLING_PRICE, signed - discount)) : u32(signed + discount);
  }
  if (dealerSelling && unit === 0) unit = MIN_SELLING_PRICE;
  return unitOnly ? unit : u32(unit + notCounted * unit);
}
