// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ArmsDealerInvInit.cc GetCurrentSuitabilityForItem, ChanceOfItemTransaction, ItemTransactionOccurs,
// @src DetermineInitialInvItems, HowManyItemsAreSold, HowManyItemsToReorder, CompareItemsForSorting,
// @src GetDealerItemCategoryNumber, CanDealerItemBeSoldUsed; Arms_Dealer_Init.cc GetArmsDealerItemTypeFromItemNumber,
// @src ItemIsARocketRifle, ItemContainsLiquid; Tactical/Items.cc ItemIsLegal. Shared with Bobby Ray.

import { ItemClass, ItemFlags, type ItemTable, NOTHING, WeaponClass } from '../../../../content/items/items.ts';
import type { MerchantContent, MerchantTables } from '../../../../content/strategic/merchant-content.ts';
import { u8 } from '../../../../core/int.ts';
import type { RollSource } from '../../forces/ports.ts';

export const BOBBY_RAY = -1;
export const DEALER_BUYING = false;
export const DEALER_SELLING = true;

export const Suitability = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, ALWAYS: 4 } as const;

const DEALER_CHANCE = { LOW: 15, MEDIUM: 30, HIGH: 50 } as const;
const BOBBY_RAY_CHANCE = { LOW: 25, MEDIUM: 50, HIGH: 75 } as const;
const NONE_SELLING_CHANCE = 100;
const ALWAYS_BUYING_CHANCE = 100;
const ALWAYS_SELLING_CHANCE = 75;
const CERTAIN = 100;
const COOLNESS_SELLING_BONUS = 5;
const PROGRESS_PER_COOLNESS = 10;
const TONY_COOLNESS_LEAD = 1;
const DEVIN_MIN_COOLNESS = 3;
const DEVIN_MAX_COOLNESS = 4;
const MIN_COOLNESS = { lo: 1, hi: 9 } as const;
const MAX_COOLNESS = { lo: 2, hi: 10 } as const;
const MEDIUM_COOLNESS_REACH = 2;
const REORDER_CHOICES = 3;
const REORDER_MORE = 0;
const REORDER_LESS = 1;

export interface SupplyContext {
  readonly items: ItemTable;
  readonly content: MerchantContent;
  readonly random: RollSource;
  readonly gunNut: boolean;
  readonly highestProgress: number;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export function itemIsLegal(items: ItemTable, item: number, gunNut: boolean): boolean {
  if (gunNut) return true;
  const def = items.byIndex.get(item);
  if (!def || !(def.flags & ItemFlags.BIGGUNLIST)) return true;
  return def.itemClass !== ItemClass.GUN && def.itemClass !== ItemClass.AMMO;
}

export function itemIsARocketRifle(content: MerchantContent, item: number): boolean {
  return item === content.itemIds.ROCKET_RIFLE || item === content.itemIds.AUTO_ROCKET_RIFLE;
}

export function itemContainsLiquid(content: MerchantContent, item: number): boolean {
  return content.tables.liquids.has(item);
}

function gunCategory(content: MerchantContent, item: number, weaponClass: number): number {
  const c = content.tables.categories;
  switch (weaponClass) {
    case WeaponClass.HANDGUN:
      return c.HANDGUNCLASS;
    case WeaponClass.RIFLE:
      return itemIsARocketRifle(content, item) ? c.ROCKET_RIFLE : c.RIFLECLASS;
    case WeaponClass.SHOTGUN:
      return c.SHOTGUNCLASS;
    case WeaponClass.SMG:
      return c.SMGCLASS;
    case WeaponClass.MG:
      return c.MGCLASS;
    case WeaponClass.KNIFE:
      return c.KNIFECLASS;
    default:
      return 0;
  }
}

export function dealerItemType(items: ItemTable, content: MerchantContent, item: number): number {
  const def = items.byIndex.get(item);
  if (!def) return 0;
  const t = content.tables;
  const c = t.categories;
  switch (def.itemClass) {
    case ItemClass.GUN:
      return gunCategory(content, item, def.weapon?.weaponClass ?? WeaponClass.NOGUN);
    case ItemClass.PUNCH:
      return item === NOTHING ? 0 : c.BLADE;
    case ItemClass.BLADE:
    case ItemClass.THROWING_KNIFE:
      return c.BLADE;
    case ItemClass.LAUNCHER:
      return c.LAUNCHER;
    case ItemClass.ARMOUR:
      return c.ARMOUR;
    case ItemClass.MEDKIT:
      return c.MEDKIT;
    case ItemClass.KIT:
      return c.KIT;
    case ItemClass.MISC:
      return t.misc.byItem.get(item) ?? t.misc.fallback;
    case ItemClass.AMMO:
      return c.AMMO;
    case ItemClass.FACE:
      return t.face.byItem.get(item) ?? t.face.fallback;
    case ItemClass.GRENADE:
      return c.GRENADE;
    case ItemClass.BOMB:
      return c.BOMB;
    default:
      return 0;
  }
}

export function dealerItemCategoryNumber(items: ItemTable, tables: MerchantTables, item: number): number {
  const def = items.byIndex.get(item);
  const itemClass = def?.itemClass ?? ItemClass.NONE;
  const weaponClass = def?.weapon?.weaponClass ?? WeaponClass.NOGUN;
  const k = tables.sortCategories.findIndex(
    (s) => s.itemClass === itemClass && (s.itemClass !== ItemClass.GUN || s.weaponClass === weaponClass),
  );
  return k < 0 ? 0 : k;
}

export function canDealerItemBeSoldUsed(items: ItemTable, tables: MerchantTables, item: number): boolean {
  const def = items.byIndex.get(item);
  if (!def || !(def.flags & ItemFlags.DAMAGEABLE)) return false;
  return tables.sortCategories[dealerItemCategoryNumber(items, tables, item)]?.allowUsed === true;
}

export function compareItemsForSorting(
  items: ItemTable,
  tables: MerchantTables,
  item1: number,
  item2: number,
  quality1: number,
  quality2: number,
): number {
  const c1 = dealerItemCategoryNumber(items, tables, item1);
  const c2 = dealerItemCategoryNumber(items, tables, item2);
  if (c1 !== c2) return c1 < c2 ? -1 : 1;
  const d1 = items.byIndex.get(item1);
  const d2 = items.byIndex.get(item2);
  if (d1?.magazine && d2?.magazine) {
    if (d1.magazine.calibre !== d2.magazine.calibre) return d1.magazine.calibre > d2.magazine.calibre ? -1 : 1;
    if (d1.magazine.capacity !== d2.magazine.capacity) return d1.magazine.capacity > d2.magazine.capacity ? -1 : 1;
  } else {
    const k1 = d1?.coolness ?? 0;
    const k2 = d2?.coolness ?? 0;
    if (k1 !== k2) return k1 > k2 ? -1 : 1;
  }
  const p1 = d1?.price ?? 0;
  const p2 = d2?.price ?? 0;
  if (p1 !== p2) return p1 > p2 ? -1 : 1;
  if (item1 !== item2) return item1 < item2 ? -1 : 1;
  if (quality1 !== quality2) return quality1 > quality2 ? -1 : 1;
  return 0;
}

function coolnessWindow(ctx: SupplyContext, dealer: number): { lo: number; hi: number } {
  const ids = ctx.content.tables.dealerIds;
  let lo = u8(Math.trunc(ctx.highestProgress / PROGRESS_PER_COOLNESS));
  let hi = u8(lo + 1);
  if (dealer === ids.TONY) {
    lo += TONY_COOLNESS_LEAD;
    hi += TONY_COOLNESS_LEAD;
  } else if (dealer === ids.DEVIN && lo < DEVIN_MIN_COOLNESS) {
    lo = DEVIN_MIN_COOLNESS;
    hi = DEVIN_MAX_COOLNESS;
  }
  return { lo: clamp(lo, MIN_COOLNESS.lo, MIN_COOLNESS.hi), hi: clamp(hi, MAX_COOLNESS.lo, MAX_COOLNESS.hi) };
}

export function currentSuitabilityForItem(ctx: SupplyContext, dealer: number, item: number): number {
  const def = ctx.items.byIndex.get(item);
  if (!def || !itemIsLegal(ctx.items, item, ctx.gunNut)) return Suitability.NONE;
  if (def.flags & ItemFlags.NOT_BUYABLE) return Suitability.NONE;
  const coolness = def.coolness;
  if (coolness === 0) return Suitability.NONE;
  if (ctx.content.tables.staples.has(item)) return Suitability.ALWAYS;
  const ids = ctx.content.tables.dealerIds;
  if (dealer !== BOBBY_RAY && dealer !== ids.TONY && dealer !== ids.DEVIN) return Suitability.HIGH;
  const { lo, hi } = coolnessWindow(ctx, dealer);
  if (coolness > hi) return Suitability.NONE;
  if (coolness >= lo && coolness <= hi) return Suitability.HIGH;
  if (coolness + MEDIUM_COOLNESS_REACH >= lo) return Suitability.MEDIUM;
  return Suitability.LOW;
}

function baseChance(suitability: number, selling: boolean, bobbyRay: boolean): number {
  const table = bobbyRay ? BOBBY_RAY_CHANCE : DEALER_CHANCE;
  switch (suitability) {
    case Suitability.NONE:
      return selling ? NONE_SELLING_CHANCE : 0;
    case Suitability.LOW:
      return table.LOW;
    case Suitability.MEDIUM:
      return table.MEDIUM;
    case Suitability.HIGH:
      return table.HIGH;
    default:
      return selling ? ALWAYS_SELLING_CHANCE : ALWAYS_BUYING_CHANCE;
  }
}

export function chanceOfItemTransaction(ctx: SupplyContext, dealer: number, item: number, dealerSelling: boolean, used: boolean): number {
  if (used && !dealerSelling && !canDealerItemBeSoldUsed(ctx.items, ctx.content.tables, item)) return 0;
  const coolness = ctx.items.byIndex.get(item)?.coolness ?? 0;
  let chance = baseChance(currentSuitabilityForItem(ctx, dealer, item), dealerSelling, dealer === BOBBY_RAY);
  if (chance > 0 && chance < CERTAIN) {
    if (dealerSelling) chance = Math.trunc(u8(chance + COOLNESS_SELLING_BONUS * coolness) / 2);
    if (used) chance = Math.trunc(chance / 2);
  }
  return chance;
}

export type EligibilityMark = () => boolean;

export function itemTransactionOccurs(
  ctx: SupplyContext,
  dealer: number,
  item: number,
  dealerSelling: boolean,
  used: boolean,
  markEligible: EligibilityMark,
): boolean {
  const chance = chanceOfItemTransaction(ctx, dealer, item, dealerSelling, used);
  if (!dealerSelling && chance > 0 && !markEligible()) return false;
  return ctx.random.int(100) < chance;
}

export function determineInitialInvItems(
  ctx: SupplyContext,
  dealer: number,
  item: number,
  chances: number,
  used: boolean,
  markEligible: EligibilityMark,
): number {
  let bought = 0;
  for (let k = 0; k < u8(chances); k++) if (itemTransactionOccurs(ctx, dealer, item, DEALER_BUYING, used, markEligible)) bought++;
  return u8(bought);
}

export function howManyItemsAreSold(ctx: SupplyContext, dealer: number, item: number, inStock: number, used: boolean): number {
  let sold = 0;
  for (let k = 0; k < u8(inStock); k++) if (itemTransactionOccurs(ctx, dealer, item, DEALER_SELLING, used, () => true)) sold++;
  return u8(sold);
}

export function howManyItemsToReorder(random: RollSource, wanted: number, stillHave: number): number {
  let n = u8(wanted - stillHave);
  const choice = random.int(REORDER_CHOICES);
  if (choice === REORDER_MORE) n = u8(n + Math.trunc(n / 2));
  else if (choice === REORDER_LESS) n = u8(n - Math.trunc(n / 2));
  return n;
}
