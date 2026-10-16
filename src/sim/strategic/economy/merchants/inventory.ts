// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.cc AddItemToArmsDealerInventory, AddSpecialItemToArmsDealerInventoryAtElement,
// @src RemoveItemFromArmsDealerInventory, RemoveRandomItemFromArmsDealerInventory,
// @src RemoveSpecialItemFromArmsDealerInventoryAtElement, FreeSpecialItemArray, ArmsDealerGetsFreshStock,
// @src DetermineDealerItemCondition, SetSpecialItemInfoFromObject, AddObjectToArmsDealerInventory,
// @src AddAmmoToArmsDealerInventory, MakeObjectOutOfDealerItems, CountDistinctItemsInArmsDealersInventory,
// @src CountActiveSpecialItemsInArmsDealersInventory, DealerItemIsSafeToStack. See docs/23 §2, §3.2.

import { ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../../../content/items/items.ts';
import { DealerFlag, hasDealerFlag } from '../../../../content/strategic/merchant-content.ts';
import { i8, u8 } from '../../../../core/int.ts';
import { createItems, type ItemObject, MAX_ATTACHMENTS, NO_PROFILE } from '../../../items/object.ts';
import { dealerDef, type MerchantContext } from './context.ts';
import {
  activeSpecials,
  cloneItemInfo,
  type DealerItemHeader,
  defaultItemInfo,
  emptySpecialItem,
  header,
  isItemInfoSpecial,
  PERFECT_CONDITION,
  type SpecialItemInfo,
  sameItemInfo,
  zeroItemInfo,
} from './state.ts';
import { itemContainsLiquid } from './supply.ts';

const MAX_UNITS_PER_ITEM = 255;
const SPECIAL_ITEMS_ALLOCED_AT_ONCE = 3;
const USED_CONDITION_BASE = 20;
const USED_CONDITION_RANGE = 60;
const SOME_USED_PERCENT = 50;
export const NO_ELEMENT = -1;

export function addItemToArmsDealerInventory(
  ctx: MerchantContext,
  dealer: number,
  item: number,
  info: SpecialItemInfo,
  howMany: number,
): number {
  const h = header(ctx.state, dealer, item);
  let n = Math.min(u8(howMany), MAX_UNITS_PER_ITEM - h.total);
  if (n === 0) return NO_ELEMENT;
  if (!isItemInfoSpecial(info)) {
    h.perfect += n;
    h.total += n;
    return NO_ELEMENT;
  }
  let element = NO_ELEMENT;
  while (n > 0) {
    element = h.specials.findIndex((s) => !s.active);
    if (element < 0) {
      element = h.specials.length;
      const grow = Math.max(SPECIAL_ITEMS_ALLOCED_AT_ONCE, n);
      for (let k = 0; k < grow; k++) h.specials.push(emptySpecialItem());
    }
    const slot = h.specials[element];
    if (slot) {
      slot.active = true;
      slot.info = cloneItemInfo(info);
    }
    h.total++;
    n--;
  }
  return element;
}

export function removeSpecialItemAtElement(ctx: MerchantContext, dealer: number, item: number, element: number): void {
  const h = header(ctx.state, dealer, item);
  h.specials[element] = emptySpecialItem();
  h.total = u8(h.total - 1);
}

export function removeItemFromArmsDealerInventory(
  ctx: MerchantContext,
  dealer: number,
  item: number,
  info: SpecialItemInfo,
  howMany: number,
): void {
  let n = u8(howMany);
  if (n === 0) return;
  const h = header(ctx.state, dealer, item);
  if (!isItemInfoSpecial(info)) {
    h.perfect = u8(h.perfect - n);
    h.total = u8(h.total - n);
    return;
  }
  for (let e = 0; e < h.specials.length && n > 0; e++) {
    const s = h.specials[e];
    if (!s?.active || !sameItemInfo(s.info, info)) continue;
    removeSpecialItemAtElement(ctx, dealer, item, e);
    n--;
  }
}

export function removeRandomItemFromArmsDealerInventory(ctx: MerchantContext, dealer: number, item: number, howMany: number): void {
  const h = header(ctx.state, dealer, item);
  for (let n = u8(howMany); n > 0; n--) {
    const which = ctx.random.int(h.total);
    if (which < h.perfect) {
      removeItemFromArmsDealerInventory(ctx, dealer, item, defaultItemInfo(), 1);
      continue;
    }
    let skip = which - h.perfect;
    for (let e = 0; e < h.specials.length; e++) {
      if (!h.specials[e]?.active) continue;
      if (skip === 0) {
        removeSpecialItemAtElement(ctx, dealer, item, e);
        break;
      }
      skip--;
    }
  }
}

export function freeSpecialItemArray(h: DealerItemHeader): void {
  h.specials.length = 0;
  h.total = h.perfect;
}

export function determineDealerItemCondition(ctx: MerchantContext, dealer: number, item: number): number {
  const def = ctx.items.byIndex.get(item);
  if (!def || !(def.flags & ItemFlags.DAMAGEABLE) || itemContainsLiquid(ctx.content, item)) return PERFECT_CONDITION;
  const d = dealerDef(ctx, dealer);
  const used =
    hasDealerFlag(d, DealerFlag.ONLY_USED_ITEMS) ||
    (hasDealerFlag(d, DealerFlag.SOME_USED_ITEMS) && ctx.random.int(100) < SOME_USED_PERCENT);
  return used ? USED_CONDITION_BASE + ctx.random.int(USED_CONDITION_RANGE) : PERFECT_CONDITION;
}

export function armsDealerGetsFreshStock(ctx: MerchantContext, dealer: number, item: number, howMany: number): void {
  let perfect = 0;
  const info = defaultItemInfo();
  for (let k = 0; k < u8(howMany); k++) {
    const condition = determineDealerItemCondition(ctx, dealer, item);
    if (condition === PERFECT_CONDITION) perfect++;
    else {
      info.condition = i8(condition);
      addItemToArmsDealerInventory(ctx, dealer, item, info, 1);
    }
  }
  if (perfect > 0) {
    info.condition = PERFECT_CONDITION;
    addItemToArmsDealerInventory(ctx, dealer, item, info, perfect);
  }
}

export function guaranteeAtLeastXItemsOfIndex(ctx: MerchantContext, dealer: number, item: number, howMany: number): void {
  const status = ctx.state.dealers[dealer]?.status;
  if (!status || status.outOfBusiness) return;
  const h = header(ctx.state, dealer, item);
  const wanted = u8(howMany);
  if (h.total >= wanted) return;
  armsDealerGetsFreshStock(ctx, dealer, item, u8(wanted - h.total));
}

export function specialItemInfoFromObject(items: ItemTable, o: ItemObject): SpecialItemInfo {
  const info = zeroItemInfo();
  const itemClass = items.byIndex.get(o.item)?.itemClass ?? 0;
  info.condition = itemClass === ItemClass.AMMO ? PERFECT_CONDITION : i8(o.status[0] ?? 0);
  info.imprint = itemClass === ItemClass.GUN ? o.imprintId : NO_PROFILE;
  for (let k = 0; k < MAX_ATTACHMENTS; k++) {
    const a = o.attachments[k];
    if (a && a.item !== NOTHING) {
      info.attachments[k] = a.item;
      info.attachmentStatus[k] = i8(a.status);
    }
  }
  return info;
}

export function addAmmoToArmsDealerInventory(ctx: MerchantContext, dealer: number, item: number, shotsLeft: number): void {
  const def = ctx.items.byIndex.get(item);
  if (def?.itemClass !== ItemClass.AMMO) return;
  let shots = u8(shotsLeft);
  if (shots === 0) return;
  const capacity = def.magazine?.capacity ?? 0;
  if (capacity === 0) return;
  if (shots >= capacity) {
    addItemToArmsDealerInventory(ctx, dealer, item, defaultItemInfo(), Math.trunc(shots / capacity));
    shots %= capacity;
  }
  if (shots === 0) return;
  const h = header(ctx.state, dealer, item);
  h.strayAmmo = u8(h.strayAmmo + shots);
  if (h.strayAmmo >= capacity) {
    addItemToArmsDealerInventory(ctx, dealer, item, defaultItemInfo(), Math.trunc(h.strayAmmo / capacity));
    h.strayAmmo %= capacity;
  }
}

export function addObjectToArmsDealerInventory(ctx: MerchantContext, dealer: number, o: ItemObject): void {
  const items = ctx.items;
  const info = specialItemInfoFromObject(items, o);
  const itemClass = items.byIndex.get(o.item)?.itemClass ?? 0;
  if (itemClass === ItemClass.GUN) {
    addItemToArmsDealerInventory(ctx, dealer, o.item, info, 1);
    if (o.gunAmmoItem !== NOTHING) {
      if (items.byIndex.get(o.gunAmmoItem)?.itemClass === ItemClass.AMMO) {
        if (o.gunShotsLeft > 0) addAmmoToArmsDealerInventory(ctx, dealer, o.gunAmmoItem, o.gunShotsLeft);
      } else {
        const payload = defaultItemInfo();
        payload.condition = Math.abs(i8(o.gunAmmoStatus));
        addItemToArmsDealerInventory(ctx, dealer, o.gunAmmoItem, payload, 1);
      }
    }
  } else if (itemClass === ItemClass.AMMO) {
    for (let k = 0; k < o.count; k++) addAmmoToArmsDealerInventory(ctx, dealer, o.item, o.status[k] ?? 0);
  } else {
    for (let k = 0; k < o.count; k++) {
      info.condition = i8(o.status[k] ?? 0);
      addItemToArmsDealerInventory(ctx, dealer, o.item, info, 1);
    }
  }
  for (const a of o.attachments) {
    if (a.item === NOTHING) continue;
    if ((items.byIndex.get(a.item)?.flags ?? 0) & ItemFlags.INSEPARABLE) continue;
    const attachment = defaultItemInfo();
    attachment.condition = i8(a.status);
    addItemToArmsDealerInventory(ctx, dealer, a.item, attachment, 1);
  }
}

export function makeObjectOutOfDealerItems(items: ItemTable, item: number, info: SpecialItemInfo, howMany: number): ItemObject {
  const condition = Math.abs(info.condition);
  const o = createItems(items, item, condition, howMany);
  o.imprintId = info.imprint;
  for (let k = 0; k < MAX_ATTACHMENTS; k++) {
    const attached = info.attachments[k] ?? NOTHING;
    const slot = o.attachments[k];
    if (attached === NOTHING || !slot) continue;
    slot.item = attached;
    slot.status = info.attachmentStatus[k] ?? 0;
  }
  if (items.byIndex.get(item)?.itemClass === ItemClass.GUN) o.gunShotsLeft = 0;
  return o;
}

export function dealerItemIsSafeToStack(items: ItemTable, item: number): boolean {
  return items.byIndex.get(item)?.itemClass !== ItemClass.GUN;
}

export function countDistinctItemsInArmsDealersInventory(ctx: MerchantContext, dealer: number): number {
  let n = 0;
  for (const def of ctx.items.ordered) {
    const h = header(ctx.state, dealer, def.index);
    if (h.total === 0) continue;
    if (h.perfect > 0) n += dealerItemIsSafeToStack(ctx.items, def.index) ? 1 : h.perfect;
    n += activeSpecials(h);
  }
  return n;
}
