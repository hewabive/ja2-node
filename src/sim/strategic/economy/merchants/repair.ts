// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.cc CanDealerRepairItem, GiveObjectToArmsDealerForRepair,
// @src GiveItemToArmsDealerforRepair, WhenWillRepairmanBeAllDoneRepairing, CalculateSpecialItemRepairTime,
// @src CalculateObjectItemRepairTime, CalculateSimpleItemRepairTime, CalculateObjectItemRepairCost,
// @src CalculateSimpleItemRepairCost, CalculateOvernightRepairDelay, CalculateMinutesClosedBetween,
// @src CountTotalItemsRepairDealerHasInForRepairs, RepairmanIsFixingItemsButNoneAreDoneYet, GetArmsDealerShopHours;
// @src ShopKeeper_Interface.cc HandlePossibleRepairDelays, RepairmanFixingAnyItemsThatShouldBeDoneNow,
// @src DelayRepairsInProgressBy, BuildRepairTimeString, BuildDoneWhenTimeString. See docs/23 §10.

import { ItemFlags, NOTHING } from '../../../../content/items/items.ts';
import { type DealerDef, DealerFlag, DealerType, hasDealerFlag } from '../../../../content/strategic/merchant-content.ts';
import { i8, u32 } from '../../../../core/int.ts';
import { type ItemObject, MAX_ATTACHMENTS } from '../../../items/object.ts';
import { dealerDef, type MerchantContext, role, type ShopHours } from './context.ts';
import { addItemToArmsDealerInventory, specialItemInfoFromObject } from './inventory.ts';
import { dealerState, header, type SpecialItemInfo } from './state.ts';
import { itemIsARocketRifle } from './supply.ts';

export const MIN_REPAIR_TIME_IN_MINUTES = 15;
export const MIN_REPAIR_COST = 10;
export const ROCKET_RIFLE_RESET_COST = 100;
export const MAX_ITEMS_IN_REPAIR = 4;
export const REPAIR_DELAY_IN_HOURS = 6;
export const MINUTES_IN_DAY = 1440;
export const MINUTES_IN_HOUR = 60;
export const REPAIR_MINUTES_INTERVAL = 15;
const REPAIR_DELAY_VISIT_GAP_MINUTES = 3 * 60;
const REPAIR_DELAY_CHANCE = 50;
const ELECTRONICS_TIME_FACTOR = 2;
const REPAIR_EASE_STEP = 10;
const MIN_REPAIR_COST_ADJUSTMENT = 10;
const REPAIR_COST_DIVISOR = 100 * 100;
const PERCENT = 100;

export function canDealerRepairItem(ctx: MerchantContext, d: DealerDef, item: number): boolean {
  const flags = ctx.items.byIndex.get(item)?.flags ?? 0;
  if (!(flags & ItemFlags.REPAIRABLE) || d.type !== DealerType.REPAIRS) return false;
  const electronic = (flags & ItemFlags.ELECTRONIC) !== 0;
  return hasDealerFlag(d, DealerFlag.REPAIRS_ELECTRONICS) ? electronic : !electronic;
}

export function doesDealerDoRepairs(ctx: MerchantContext, dealer: number): boolean {
  return ctx.content.dealers[dealer]?.type === DealerType.REPAIRS;
}

export function calculateSimpleItemRepairCost(ctx: MerchantContext, dealer: number, item: number, condition: number): number {
  const def = ctx.items.byIndex.get(item);
  const d = dealerDef(ctx, dealer);
  const fullValue = u32(Math.trunc(Math.fround((def?.price ?? 0) * d.repairCost)));
  let adjustment = PERCENT - REPAIR_EASE_STEP * (def?.repairEase ?? 0);
  if (adjustment < MIN_REPAIR_COST_ADJUSTMENT) adjustment = MIN_REPAIR_COST_ADJUSTMENT;
  const share = Math.fround((adjustment * (PERCENT - i8(condition))) / REPAIR_COST_DIVISOR);
  let cost = u32(Math.trunc(Math.fround(fullValue * share)));
  if (itemIsARocketRifle(ctx.content, item)) cost += ROCKET_RIFLE_RESET_COST;
  return cost < MIN_REPAIR_COST ? MIN_REPAIR_COST : cost;
}

export function calculateSimpleItemRepairTime(ctx: MerchantContext, dealer: number, item: number, condition: number): number {
  const cost = calculateSimpleItemRepairCost(ctx, dealer, item, condition);
  let time = u32(Math.trunc(Math.fround(cost * dealerDef(ctx, dealer).repairSpeed)));
  const flags = ctx.items.byIndex.get(item)?.flags ?? 0;
  if (flags & ItemFlags.ELECTRONIC && dealer !== role(ctx, 'FREDO')) time *= ELECTRONICS_TIME_FACTOR;
  return time < MIN_REPAIR_TIME_IN_MINUTES ? MIN_REPAIR_TIME_IN_MINUTES : time;
}

interface RepairParts {
  readonly item: number;
  readonly condition: number;
  readonly attachments: readonly { readonly item: number; readonly status: number }[];
}

function partsOfObject(o: ItemObject): RepairParts {
  return { item: o.item, condition: o.status[0] ?? 0, attachments: o.attachments };
}

function partsOfInfo(item: number, info: SpecialItemInfo): RepairParts {
  return {
    item,
    condition: info.condition,
    attachments: info.attachments.map((a, k) => ({ item: a, status: info.attachmentStatus[k] ?? 0 })),
  };
}

function sumOverParts(ctx: MerchantContext, dealer: number, parts: RepairParts, one: (item: number, condition: number) => number): number {
  const d = dealerDef(ctx, dealer);
  let total = one(parts.item, parts.condition);
  for (let k = 0; k < MAX_ATTACHMENTS; k++) {
    const a = parts.attachments[k];
    if (!a || a.item === NOTHING) continue;
    if (i8(a.status) < PERCENT && canDealerRepairItem(ctx, d, a.item)) total += one(a.item, a.status);
  }
  return u32(total);
}

export function calculateObjectItemRepairCost(ctx: MerchantContext, dealer: number, o: ItemObject): number {
  return sumOverParts(ctx, dealer, partsOfObject(o), (item, c) => calculateSimpleItemRepairCost(ctx, dealer, item, c));
}

export function calculateObjectItemRepairTime(ctx: MerchantContext, dealer: number, o: ItemObject): number {
  return sumOverParts(ctx, dealer, partsOfObject(o), (item, c) => calculateSimpleItemRepairTime(ctx, dealer, item, c));
}

function calculateSpecialItemRepairTime(ctx: MerchantContext, dealer: number, item: number, info: SpecialItemInfo): number {
  return sumOverParts(ctx, dealer, partsOfInfo(item, info), (it, c) => calculateSimpleItemRepairTime(ctx, dealer, it, c));
}

export function shopHours(ctx: MerchantContext, dealer: number): ShopHours | null {
  return ctx.hooks.shopHours(dealerDef(ctx, dealer).profile);
}

export function calculateOvernightRepairDelay(ctx: MerchantContext, dealer: number, start: number, minutesToFix: number): number {
  let t = start % MINUTES_IN_DAY;
  const hours = shopHours(ctx, dealer);
  if (!hours) return 0;
  let fix = minutesToFix;
  let days = 0;
  while (t + fix > hours.close) {
    if (t < hours.close) fix = u32(fix - (hours.close - t));
    t = hours.open;
    days++;
  }
  return u32(days * (MINUTES_IN_DAY - (hours.close - hours.open)));
}

export function calculateMinutesClosedBetween(ctx: MerchantContext, dealer: number, startTime: number, endTime: number): number {
  const hours = shopHours(ctx, dealer);
  if (!hours) return 0;
  const closedPerNight = MINUTES_IN_DAY - (hours.close - hours.open);
  const daysDifference = Math.trunc(endTime / MINUTES_IN_DAY) - Math.trunc(startTime / MINUTES_IN_DAY);
  let closed = daysDifference >= 2 ? (daysDifference - 1) * closedPerNight : 0;
  const s = startTime % MINUTES_IN_DAY;
  let e = endTime % MINUTES_IN_DAY;
  if (e === 0) e = MINUTES_IN_DAY;
  if (s === e) {
    if (daysDifference === 0) return 0;
    closed += closedPerNight;
  }
  if (s < e) {
    if (s < hours.open) closed += Math.min(hours.open, e) - s;
    if (e > hours.close) closed += e - Math.max(hours.close, s);
  } else {
    closed += calculateMinutesClosedBetween(ctx, dealer, s, MINUTES_IN_DAY);
    closed += calculateMinutesClosedBetween(ctx, dealer, 0, e);
  }
  return u32(closed);
}

export interface RepairElement {
  readonly item: number;
  readonly element: number;
}

export function itemsInRepair(ctx: MerchantContext, dealer: number): RepairElement[] {
  const out: RepairElement[] = [];
  if (!doesDealerDoRepairs(ctx, dealer)) return out;
  for (const def of ctx.items.ordered) {
    const h = header(ctx.state, dealer, def.index);
    if (h.total === 0) continue;
    h.specials.forEach((s, element) => {
      if (s.active && s.info.condition < 0) out.push({ item: def.index, element });
    });
  }
  return out;
}

function itemsInRepairByIndex(ctx: MerchantContext, dealer: number): RepairElement[] {
  return itemsInRepair(ctx, dealer).sort((a, b) => a.item - b.item || a.element - b.element);
}

export function countTotalItemsRepairDealerHasInForRepairs(ctx: MerchantContext, dealer: number): number {
  return itemsInRepair(ctx, dealer).length;
}

function special(ctx: MerchantContext, dealer: number, r: RepairElement) {
  const s = header(ctx.state, dealer, r.item).specials[r.element];
  if (!s) throw new RangeError(`no repair element ${r.item}/${r.element}`);
  return s;
}

export function whenWillRepairmanBeAllDoneRepairing(ctx: MerchantContext, dealer: number): number {
  let free = ctx.world.worldMinutes();
  for (const r of itemsInRepair(ctx, dealer)) free = Math.max(free, special(ctx, dealer, r).repairDoneTime);
  return free;
}

export function repairmanIsFixingItemsButNoneAreDoneYet(ctx: MerchantContext, dealer: number): boolean {
  if (!doesDealerDoRepairs(ctx, dealer)) return false;
  const now = ctx.world.worldMinutes();
  let onlyUnrepaired = false;
  for (const r of itemsInRepair(ctx, dealer)) {
    if (special(ctx, dealer, r).repairDoneTime <= now) return false;
    onlyUnrepaired = true;
  }
  return onlyUnrepaired;
}

export function giveObjectToArmsDealerForRepair(ctx: MerchantContext, dealer: number, o: ItemObject, owner: number): number {
  const info = specialItemInfoFromObject(ctx.items, o);
  const start = whenWillRepairmanBeAllDoneRepairing(ctx, dealer);
  const fix = calculateSpecialItemRepairTime(ctx, dealer, o.item, info);
  const done = u32(start + fix + calculateOvernightRepairDelay(ctx, dealer, start, fix));
  info.condition = i8(-info.condition);
  const element = addItemToArmsDealerInventory(ctx, dealer, o.item, info, 1);
  const slot = header(ctx.state, dealer, o.item).specials[element];
  if (slot) {
    slot.repairDoneTime = done;
    slot.owner = owner;
  }
  return element;
}

function hoursSinceOldestItemRepaired(ctx: MerchantContext, dealer: number): number | null {
  const now = ctx.world.worldMinutes();
  let found = false;
  let hours = 0;
  for (const r of itemsInRepairByIndex(ctx, dealer)) {
    const done = special(ctx, dealer, r).repairDoneTime;
    if (done > now) continue;
    found = true;
    const working = Math.trunc(u32(now - done - calculateMinutesClosedBetween(ctx, dealer, done, now)) / MINUTES_IN_HOUR);
    if (working > hours) hours = working;
  }
  return found ? hours : null;
}

function delayRepairsInProgressBy(ctx: MerchantContext, dealer: number, minutes: number): void {
  for (const r of itemsInRepairByIndex(ctx, dealer)) {
    const s = special(ctx, dealer, r);
    s.repairDoneTime = u32(s.repairDoneTime + calculateOvernightRepairDelay(ctx, dealer, s.repairDoneTime, minutes) + minutes);
  }
}

export function handlePossibleRepairDelays(ctx: MerchantContext, dealer: number): boolean {
  const d = dealerDef(ctx, dealer);
  if (!hasDealerFlag(d, DealerFlag.DELAYS_REPAIR)) return false;
  const status = dealerState(ctx.state, dealer).status;
  if (status.repairDelayUsed) return false;
  if (u32(ctx.world.worldMinutes() - status.lastSkiMinute) < REPAIR_DELAY_VISIT_GAP_MINUTES) return false;
  const hours = hoursSinceOldestItemRepaired(ctx, dealer);
  if (hours === null || hours >= REPAIR_DELAY_IN_HOURS) return false;
  if (!ctx.preRandom.chance(REPAIR_DELAY_CHANCE)) return false;
  delayRepairsInProgressBy(ctx, dealer, (REPAIR_DELAY_IN_HOURS + ctx.random.int(REPAIR_DELAY_IN_HOURS)) * MINUTES_IN_HOUR);
  status.repairDelayUsed = true;
  return true;
}

export function roundUpToRepairInterval(minutes: number): number {
  const rest = minutes % REPAIR_MINUTES_INTERVAL;
  const rounded = rest > 0 ? minutes + REPAIR_MINUTES_INTERVAL - rest : minutes;
  return rounded < REPAIR_MINUTES_INTERVAL ? REPAIR_MINUTES_INTERVAL : rounded;
}
