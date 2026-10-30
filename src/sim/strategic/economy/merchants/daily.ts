// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.cc InitAllArmsDealers, InitializeOneArmsDealer,
// @src DailyUpdateOfArmsDealersInventory, SimulateArmsDealerCustomer, DailyCheckOnItemQuantities,
// @src ConvertCreatureBloodToElixir, AdjustCertainDealersInventory, LimitArmsDealersInventory,
// @src GuaranteeAtLeastOneItemOfType, GuaranteeMinimumAlcohol, CanDealerTransactItem (selling side).

import {
  type DealerDef,
  DealerFlag,
  DealerType,
  doesItemAppearInDealerInventoryList,
  hasDealerFlag,
  maxItemAmount,
} from '../../../../content/strategic/merchant-content.ts';
import { idiv, u8 } from '../../../../core/int.ts';
import { Fact } from '../../narrative/fact-ids.ts';
import { fact } from '../../narrative/facts.ts';
import { dealerDef, type MerchantContext, role } from './context.ts';
import {
  armsDealerGetsFreshStock,
  guaranteeAtLeastXItemsOfIndex,
  removeItemFromArmsDealerInventory,
  removeRandomItemFromArmsDealerInventory,
  removeSpecialItemAtElement,
} from './inventory.ts';
import { canDealerRepairItem } from './repair.ts';
import { dealerState, defaultItemInfo, emptyDealerState, header } from './state.ts';
import {
  chanceOfItemTransaction,
  DEALER_BUYING,
  dealerItemType,
  determineInitialInvItems,
  howManyItemsAreSold,
  howManyItemsToReorder,
  itemTransactionOccurs,
  type SupplyContext,
} from './supply.ts';

const ELIXIR_CUSTOMER_LIMIT = 3;
const TONY_BIG_GUN_TYPES = 2;
const TONY_HANDGUN_TYPES = 3;
const TONY_AMMO_TYPES = 8;
const ALCOHOL_MINIMUM_DIVISOR = 3;
const SAM_JARS = 1;
const FUEL_MINIMUM = 4;
const FUEL_RANGE = 3;
const FRANZ_VIDEO_CAMERAS = 1;
const IMPORTED_REORDER_DAYS = { base: 2, range: 2 } as const;
const LOCAL_REORDER_DAYS = { base: 1, range: 2 } as const;
export const FRANZ_HAS_SOLD_VIDEO_CAMERA = 0x01;
export const FREDO_HAS_SAID_ROCKET_RIFLE_QUOTE = 0x01;

export function supplyContext(ctx: MerchantContext): SupplyContext {
  return {
    items: ctx.items,
    content: ctx.content,
    random: ctx.random,
    gunNut: ctx.world.gunNut(),
    highestProgress: ctx.world.highestProgress(),
  };
}

function markDealerEligible(ctx: MerchantContext, dealer: number, item: number): () => boolean {
  return () => {
    header(ctx.state, dealer, item).previouslyEligible = true;
    return true;
  };
}

export function canDealerTransactItem(
  ctx: MerchantContext,
  d: DealerDef,
  item: number,
  purchaseFromPlayer: boolean,
  valueToDealer: () => number,
): boolean {
  switch (d.type) {
    case DealerType.SELLS_ONLY:
      if (purchaseFromPlayer) return false;
      break;
    case DealerType.BUYS_ONLY:
      if (!purchaseFromPlayer) return false;
      break;
    case DealerType.BUYS_SELLS:
      if (hasDealerFlag(d, DealerFlag.BUYS_EVERYTHING) && purchaseFromPlayer) return valueToDealer() > 0;
      break;
    case DealerType.REPAIRS:
      return canDealerRepairItem(ctx, d, item);
    default:
      return false;
  }
  return doesItemAppearInDealerInventoryList(d, item, purchaseFromPlayer);
}

function sellsItem(ctx: MerchantContext, d: DealerDef, item: number): boolean {
  return canDealerTransactItem(ctx, d, item, false, () => 0);
}

function initializeOneArmsDealer(ctx: MerchantContext, d: DealerDef): void {
  const state = emptyDealerState();
  ctx.state.dealers[d.id] = state;
  state.status.cash = d.initialCash;
  if (hasDealerFlag(d, DealerFlag.HAS_NO_INVENTORY)) return;
  const supply = supplyContext(ctx);
  for (const def of ctx.items.ordered) {
    const item = def.index;
    if (!sellsItem(ctx, d, item)) continue;
    const n = determineInitialInvItems(supply, d.id, item, u8(maxItemAmount(d, item)), false, markDealerEligible(ctx, d.id, item));
    if (n > 0) armsDealerGetsFreshStock(ctx, d.id, item, n);
  }
}

export function initAllArmsDealers(ctx: MerchantContext): void {
  for (let k = 0; k < ctx.state.dealers.length; k++) ctx.state.dealers[k] = emptyDealerState();
  for (const d of ctx.content.dealers) initializeOneArmsDealer(ctx, d);
  adjustCertainDealersInventory(ctx);
}

export function convertCreatureBloodToElixir(ctx: MerchantContext): void {
  const gabby = role(ctx, 'GABBY');
  const { JAR_CREATURE_BLOOD: blood, JAR_ELIXIR: elixir } = ctx.content.itemIds;
  const available = header(ctx.state, gabby, blood).total;
  if (!available) return;
  removeItemFromArmsDealerInventory(ctx, gabby, blood, defaultItemInfo(), available);
  armsDealerGetsFreshStock(ctx, gabby, elixir, available);
}

export function simulateArmsDealerCustomer(ctx: MerchantContext): void {
  const supply = supplyContext(ctx);
  const elixir = ctx.content.itemIds.JAR_ELIXIR;
  for (const d of ctx.content.dealers) {
    if (dealerState(ctx.state, d.id).status.outOfBusiness || hasDealerFlag(d, DealerFlag.HAS_NO_INVENTORY)) continue;
    for (const def of ctx.items.ordered) {
      const item = def.index;
      const h = header(ctx.state, d.id, item);
      if (h.total === 0) continue;
      const offered = item === elixir ? Math.min(ELIXIR_CUSTOMER_LIMIT, h.perfect) : h.perfect;
      const sold = howManyItemsAreSold(supply, d.id, item, offered, false);
      if (sold > 0) removeItemFromArmsDealerInventory(ctx, d.id, item, defaultItemInfo(), sold);
      for (let e = 0; e < u8(h.specials.length); e++) {
        if (!h.specials[e]?.active) continue;
        if (howManyItemsAreSold(supply, d.id, item, 1, true) > 0) removeSpecialItemAtElement(ctx, d.id, item, e);
      }
    }
  }
}

function reorderDays(ctx: MerchantContext, dealer: number): number {
  const imported = dealer === role(ctx, 'TONY') || dealer === role(ctx, 'DEVIN');
  const days = imported ? IMPORTED_REORDER_DAYS : LOCAL_REORDER_DAYS;
  return days.base + ctx.random.int(days.range);
}

export function dailyCheckOnItemQuantities(ctx: MerchantContext): void {
  const supply = supplyContext(ctx);
  for (const d of ctx.content.dealers) {
    const status = dealerState(ctx.state, d.id).status;
    if (status.outOfBusiness) continue;
    status.cash = d.initialCash;
    if (hasDealerFlag(d, DealerFlag.HAS_NO_INVENTORY)) continue;
    for (const def of ctx.items.ordered) {
      const item = def.index;
      if (!sellsItem(ctx, d, item)) continue;
      const h = header(ctx.state, d.id, item);
      if (h.qtyOnOrder === 0) {
        const maxSupply = u8(maxItemAmount(d, item));
        if (h.total > idiv(maxSupply, 2)) continue;
        const wasEligible = h.previouslyEligible;
        if (!itemTransactionOccurs(supply, d.id, item, DEALER_BUYING, false, markDealerEligible(ctx, d.id, item))) continue;
        const n = howManyItemsToReorder(ctx.random, maxSupply, h.total);
        if (!wasEligible) armsDealerGetsFreshStock(ctx, d.id, item, n);
        else {
          const days = reorderDays(ctx, d.id);
          h.qtyOnOrder = n;
          h.orderArrivalDay = ctx.world.worldDay() + days;
        }
      } else if (h.orderArrivalDay >= ctx.world.worldDay()) {
        armsDealerGetsFreshStock(ctx, d.id, item, h.qtyOnOrder);
        h.qtyOnOrder = 0;
        h.orderArrivalDay = 0;
      }
    }
  }
}

export function limitArmsDealersInventory(ctx: MerchantContext, dealer: number, mask: number, limit: number): void {
  if (dealerState(ctx.state, dealer).status.outOfBusiness) return;
  const ammo = ctx.content.tables.categories.AMMO;
  const candidates: number[] = [];
  const weights: number[] = [];
  let total = 0;
  for (const def of ctx.items.ordered) {
    const h = header(ctx.state, dealer, def.index);
    if (h.total === 0 || !(mask & dealerItemType(ctx.items, ctx.content, def.index))) continue;
    candidates.push(def.index);
    const weight = mask === ammo ? 1 : h.total;
    weights.push(weight);
    total += weight;
  }
  if (candidates.length <= limit) return;
  let toRemove = candidates.length - limit;
  while (toRemove > 0) {
    let choice = ctx.random.int(total);
    for (let i = 0; i < candidates.length; i++) {
      const weight = weights[i] ?? 0;
      if (choice > weight) {
        choice -= weight;
        continue;
      }
      const item = candidates[i] ?? 0;
      if (mask === ammo) removeItemFromArmsDealerInventory(ctx, dealer, item, defaultItemInfo(), header(ctx.state, dealer, item).total);
      else removeRandomItemFromArmsDealerInventory(ctx, dealer, item, 1);
      candidates[i] = candidates[candidates.length - 1] ?? 0;
      weights[i] = weights[weights.length - 1] ?? 0;
      candidates.pop();
      weights.pop();
      toRemove--;
      break;
    }
  }
}

export function guaranteeAtLeastOneItemOfType(ctx: MerchantContext, dealer: number, mask: number): void {
  if (dealerState(ctx.state, dealer).status.outOfBusiness) return;
  const d = dealerDef(ctx, dealer);
  const supply = supplyContext(ctx);
  const candidates: number[] = [];
  const chances: number[] = [];
  let total = 0;
  for (const def of ctx.items.ordered) {
    const item = def.index;
    if (!(mask & dealerItemType(ctx.items, ctx.content, item))) continue;
    if (header(ctx.state, dealer, item).total > 0) return;
    if (maxItemAmount(d, item) <= 0) continue;
    const chance = chanceOfItemTransaction(supply, dealer, item, DEALER_BUYING, false);
    if (chance <= 0) continue;
    candidates.push(item);
    chances.push(chance);
    total += chance;
  }
  if (candidates.length === 0) return;
  let choice = ctx.random.int(total);
  for (let i = 0; i < candidates.length; i++) {
    const chance = chances[i] ?? 0;
    if (choice <= chance) {
      armsDealerGetsFreshStock(ctx, dealer, candidates[i] ?? 0, 1);
      return;
    }
    choice -= chance;
  }
}

function guaranteeMinimumAlcohol(ctx: MerchantContext, d: DealerDef): void {
  const { BEER, WINE, ALCOHOL } = ctx.content.itemIds;
  for (const item of [BEER, WINE, ALCOHOL])
    guaranteeAtLeastXItemsOfIndex(ctx, d.id, item, u8(idiv(maxItemAmount(d, item), ALCOHOL_MINIMUM_DIVISOR)));
}

export function guaranteeFuel(ctx: MerchantContext): void {
  for (const d of ctx.content.dealers) {
    if (!hasDealerFlag(d, DealerFlag.SELLS_FUEL)) continue;
    guaranteeAtLeastXItemsOfIndex(ctx, d.id, ctx.content.itemIds.GAS_CAN, FUEL_MINIMUM + ctx.random.int(FUEL_RANGE));
  }
}

export function estoniRefuellingBecamePossible(ctx: MerchantContext): void {
  guaranteeAtLeastXItemsOfIndex(ctx, role(ctx, 'JAKE'), ctx.content.itemIds.GAS_CAN, FUEL_MINIMUM + ctx.random.int(FUEL_RANGE));
}

export function adjustCertainDealersInventory(ctx: MerchantContext): void {
  const c = ctx.content.tables.categories;
  const tony = role(ctx, 'TONY');
  guaranteeAtLeastOneItemOfType(ctx, tony, c.BIG_GUNS);
  limitArmsDealersInventory(ctx, tony, c.BIG_GUNS, TONY_BIG_GUN_TYPES);
  limitArmsDealersInventory(ctx, tony, c.HANDGUNCLASS, TONY_HANDGUN_TYPES);
  limitArmsDealersInventory(ctx, tony, c.AMMO, TONY_AMMO_TYPES);
  for (const d of ctx.content.dealers) if (hasDealerFlag(d, DealerFlag.SELLS_ALCOHOL)) guaranteeMinimumAlcohol(ctx, d);
  guaranteeAtLeastXItemsOfIndex(ctx, role(ctx, 'SAM'), ctx.content.itemIds.JAR, SAM_JARS);
  if (fact(ctx.narrative, Fact.ESTONI_REFUELLING_POSSIBLE)) guaranteeFuel(ctx);
  const franz = role(ctx, 'FRANZ');
  if (!(dealerState(ctx.state, franz).status.flags & FRANZ_HAS_SOLD_VIDEO_CAMERA))
    guaranteeAtLeastXItemsOfIndex(ctx, franz, ctx.content.itemIds.VIDEO_CAMERA, FRANZ_VIDEO_CAMERAS);
}

export function dailyUpdateOfArmsDealersInventory(ctx: MerchantContext): void {
  convertCreatureBloodToElixir(ctx);
  simulateArmsDealerCustomer(ctx);
  dailyCheckOnItemQuantities(ctx);
  adjustCertainDealersInventory(ctx);
}
