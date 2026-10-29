// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ShopKeeper_Interface.cc PerformTransaction, CalculateTotalArmsDealerCost,
// @src CalculateTotalPlayersValue, CalculateHowMuchMoneyIsInPlayersOfferArea, IsMoneyTheOnlyItemInThePlayersOfferArea,
// @src MovePlayerOfferedItemsOfValueToArmsDealersInventory, MoveAllArmsDealersItemsInOfferAreaToPlayersOfferArea,
// @src RemoveItemFromDealersInventory, MovePlayersItemsToBeRepairedToArmsDealersInventory, GivePlayerSomeChange,
// @src DealerGetsBribed, OfferObjectToDealer, SplitComplexObjectIntoSubObjects, CountSubObjectsInObject,
// @src EvaluateItemAddedToPlayersOfferArea, EvaluateInvSlot, WillShopKeeperRejectObjectsFromPlayer,
// @src ConfirmToDeductMoneyFromPlayersAccountMessageBoxCallBack.

import { ItemClass, NOTHING } from '../../../../content/items/items.ts';
import { DealerFlag, DealerType, hasDealerFlag } from '../../../../content/strategic/merchant-content.ts';
import { u8, u32 } from '../../../../core/int.ts';
import { cloneObject, createItem, createMoney, type ItemObject, NO_PROFILE } from '../../../items/object.ts';
import { Fact } from '../../narrative/fact-ids.ts';
import { setFactTrue } from '../../narrative/facts.ts';
import type { DealerBox } from './boxes.ts';
import { dealerDef, isMercADealer, type MerchantContext, role } from './context.ts';
import { canDealerTransactItem, FRANZ_HAS_SOLD_VIDEO_CAMERA, FREDO_HAS_SAID_ROCKET_RIFLE_QUOTE } from './daily.ts';
import { addObjectToArmsDealerInventory, removeItemFromArmsDealerInventory, specialItemInfoFromObject } from './inventory.ts';
import { calcShopKeeperItemPrice, calcValueOfItemToDealer } from './pricing.ts';
import {
  calculateObjectItemRepairCost,
  calculateObjectItemRepairTime,
  calculateOvernightRepairDelay,
  canDealerRepairItem,
  countTotalItemsRepairDealerHasInForRepairs,
  giveObjectToArmsDealerForRepair,
  MAX_ITEMS_IN_REPAIR,
  whenWillRepairmanBeAllDoneRepairing,
} from './repair.ts';
import { dealerState, PERFECT_CONDITION } from './state.ts';
import { itemIsARocketRifle } from './supply.ts';

export const OFFER_AREA_SLOTS = 12;
export const REALLY_BADLY_DAMAGED_THRESHOLD = 30;
const FRANK_MIN_BRIBE = 10;
const SLOTS_KEPT_FOR_CHANGE = 1;

export const ShopQuote = {
  NOT_INTERESTED: 4,
  GIFT: 10,
  FIRST_ENTERS: 11,
  REQUESTED_EVALUATION: 16,
  STUFF_REJECTED: 17,
  VALUE_OF_ZERO: 18,
  REALLY_DAMAGED: 19,
  EXACTLY_ENOUGH: 22,
  TOO_MUCH_MONEY: 23,
  DONE_WITH_TRANSACTION: 24,
  DONE_WITHOUT_TRANSACTION: 25,
  CANT_AFFORD_OR_TOO_MUCH_TO_REPAIR: 27,
  REPAIR_DELAYED: 29,
  CAN_RESET_IMPRINTING: 31,
} as const;

export interface ObjectSource {
  readonly soldier: number;
  readonly slot: number;
  readonly index: number | null;
  readonly amount: number | null;
}

export interface PlayerObject {
  readonly object: ItemObject;
  readonly owner: number;
  readonly source: ObjectSource;
}

export interface BuyRequest {
  readonly boxes: readonly DealerBox[];
  readonly count: number;
}

export interface TradeInput {
  readonly dealer: number;
  readonly pricingProfile: number;
  readonly weaponSaleModifier: number;
  readonly balance: number;
  readonly useBalance: boolean;
  readonly buy: readonly BuyRequest[];
  readonly sell: readonly PlayerObject[];
  readonly cash: readonly PlayerObject[];
  readonly repair: readonly PlayerObject[];
}

export type PoaKind = 'money' | 'sold' | 'part' | 'purchase' | 'change';

export interface PoaEntry {
  readonly kind: PoaKind;
  readonly object: ItemObject;
  readonly owner: number;
  readonly source: ObjectSource | null;
  readonly value: number;
}

export interface DoaEntry {
  readonly object: ItemObject;
  readonly owner: number;
  readonly source: ObjectSource | null;
  readonly box: DealerBox | null;
  readonly price: number;
  readonly repairMinutes: number;
  readonly doneAt: number;
}

export type Evaluation = 'value' | 'reallyDamaged' | 'worthless' | 'rejected';

export interface SellQuote {
  readonly item: number;
  readonly evaluation: Evaluation;
  readonly value: number;
}

export interface TradeRefusal {
  readonly reason: string;
  readonly entry?: number;
  readonly shortfall?: number;
  readonly amount?: number;
}

export interface TradePlan {
  readonly dealer: number;
  readonly poa: readonly (PoaEntry | null)[];
  readonly doa: readonly DoaEntry[];
  readonly sells: readonly SellQuote[];
  readonly cost: number;
  readonly value: number;
  readonly cash: number;
  readonly gift: boolean;
  readonly fromBalance: number;
  readonly change: number;
  readonly balanceNeeded: number;
  readonly quotes: readonly number[];
  readonly refusal: TradeRefusal | null;
}

interface Planner {
  readonly ctx: MerchantContext;
  readonly input: TradeInput;
  readonly poa: (PoaEntry | null)[];
  readonly doa: DoaEntry[];
  readonly sells: SellQuote[];
  readonly quotes: number[];
  refusal: TradeRefusal | null;
  evaluationQuoted: boolean;
}

function refuse(p: Planner, refusal: TradeRefusal): void {
  if (!p.refusal) p.refusal = refusal;
}

function poaCount(p: Planner): number {
  return p.poa.reduce((n, e) => n + (e ? 1 : 0), 0);
}

function addToPoa(p: Planner, entry: PoaEntry): boolean {
  const k = p.poa.indexOf(null);
  if (k < 0) return false;
  p.poa[k] = entry;
  return true;
}

function isMoney(ctx: MerchantContext, item: number): boolean {
  return ctx.items.byIndex.get(item)?.itemClass === ItemClass.MONEY;
}

function priceInput(p: Planner, dealerSelling: boolean) {
  const d = dealerDef(p.ctx, p.input.dealer);
  return {
    dealer: d.id,
    dealerSelling,
    unitOnly: false,
    modifier: dealerSelling ? d.sellingPrice : d.buyingPrice,
    weaponSaleModifier: p.input.weaponSaleModifier,
  };
}

function quoteEvaluation(p: Planner): void {
  if (p.evaluationQuoted || p.input.dealer === role(p.ctx, 'DEVIN')) return;
  p.evaluationQuoted = true;
  p.quotes.push(ShopQuote.REQUESTED_EVALUATION);
}

function planPurchases(p: Planner): void {
  for (const [entry, b] of p.input.buy.entries()) {
    const first = b.boxes[0];
    if (!first) {
      refuse(p, { reason: 'noSuchBox', entry });
      continue;
    }
    const stackable = b.boxes.length === 1;
    const units = stackable ? first.object.count : b.boxes.length;
    if (b.count < 1 || b.count > units) {
      refuse(p, { reason: 'notEnoughInBox', entry });
      continue;
    }
    const picked = stackable ? [first] : b.boxes.slice(0, b.count);
    for (const box of picked) {
      const object = cloneObject(box.object);
      if (stackable) object.count = b.count;
      p.doa.push({ object, owner: NO_PROFILE, source: null, box, price: 0, repairMinutes: 0, doneAt: 0 });
    }
  }
  if (p.doa.length > OFFER_AREA_SLOTS) refuse(p, { reason: 'dealerOfferAreaFull' });
}

function evaluateSold(p: Planner, o: PlayerObject, entry: number): void {
  const ctx = p.ctx;
  const d = dealerDef(ctx, p.input.dealer);
  quoteEvaluation(p);
  const value = () => calcValueOfItemToDealer(ctx, d.id, o.object.item, false);
  if (!canDealerTransactItem(ctx, d, o.object.item, true, value)) {
    p.sells.push({ item: o.object.item, evaluation: 'rejected', value: 0 });
    p.quotes.push(d.type === DealerType.SELLS_ONLY ? ShopQuote.NOT_INTERESTED : ShopQuote.STUFF_REJECTED);
    refuse(p, { reason: 'wontBuy', entry });
    return;
  }
  const price = calcShopKeeperItemPrice(ctx, priceInput(p, false), o.object);
  if (price === 0) {
    p.sells.push({ item: o.object.item, evaluation: 'worthless', value: 0 });
    p.quotes.push(ShopQuote.VALUE_OF_ZERO);
    refuse(p, { reason: 'worthless', entry });
    return;
  }
  const damaged =
    ctx.items.byIndex.get(o.object.item)?.itemClass !== ItemClass.AMMO && (o.object.status[0] ?? 0) < REALLY_BADLY_DAMAGED_THRESHOLD;
  if (damaged) p.quotes.push(ShopQuote.REALLY_DAMAGED);
  p.sells.push({ item: o.object.item, evaluation: damaged ? 'reallyDamaged' : 'value', value: price });
  addToPoa(p, { kind: 'sold', object: o.object, owner: o.owner, source: o.source, value: price });
}

function splitComplexObject(ctx: MerchantContext, o: ItemObject): ItemObject[] {
  if (o.count > 1) {
    return Array.from({ length: o.count }, (_, k) => createItem(ctx.items, o.item, o.status[k] ?? 0));
  }
  const main = cloneObject(o);
  const parts: ItemObject[] = [main];
  if (ctx.items.byIndex.get(o.item)?.itemClass !== ItemClass.GUN) return parts;
  if (o.item !== ctx.content.itemIds.ROCKET_LAUNCHER) {
    main.gunShotsLeft = 0;
    main.gunAmmoItem = NOTHING;
  }
  if (o.gunAmmoItem === NOTHING) return parts;
  if (ctx.items.byIndex.get(o.gunAmmoItem)?.itemClass === ItemClass.AMMO) {
    if (o.gunShotsLeft > 0) {
      const bullets = createItem(ctx.items, o.gunAmmoItem, PERFECT_CONDITION);
      bullets.status[0] = o.gunShotsLeft;
      parts.push(bullets);
    }
  } else {
    const payload = createItem(ctx.items, o.gunAmmoItem, o.gunAmmoStatus);
    payload.status[0] = Math.abs(payload.status[0] ?? 0);
    parts.push(payload);
  }
  return parts;
}

function needsRepair(p: Planner, part: ItemObject): boolean {
  const d = dealerDef(p.ctx, p.input.dealer);
  return (part.status[0] ?? 0) !== PERFECT_CONDITION && canDealerRepairItem(p.ctx, d, part.item);
}

function planRepair(p: Planner, o: PlayerObject, entry: number, inRepair: number, queueEnd: { at: number }): void {
  const ctx = p.ctx;
  const d = dealerDef(ctx, p.input.dealer);
  const parts = splitComplexObject(ctx, o.object);
  const repairable = parts.filter((part) => needsRepair(p, part)).length;
  const canTake = u8(MAX_ITEMS_IN_REPAIR - inRepair - p.doa.length);
  const taken = Math.min(repairable, canTake);
  const poaNeeded = parts.length - repairable + (repairable - taken) + (taken > 0 ? 1 : 0);
  if (poaNeeded + poaCount(p) > OFFER_AREA_SLOTS) {
    refuse(p, { reason: 'playerOfferAreaFull', entry });
    return;
  }
  const single = parts.length === 1;
  for (const [k, part] of parts.entries()) {
    const source = single ? o.source : null;
    const main = k === 0 || o.object.count > 1;
    const asPart = () => addToPoa(p, { kind: 'part', object: part, owner: o.owner, source, value: 0 });
    quoteEvaluation(p);
    if (!canDealerRepairItem(ctx, d, part.item)) {
      asPart();
      if (main) {
        p.quotes.push(ShopQuote.NOT_INTERESTED);
        refuse(p, { reason: 'wontRepair', entry });
      }
      continue;
    }
    if (p.doa.length + part.count + inRepair > MAX_ITEMS_IN_REPAIR) {
      asPart();
      p.quotes.push(ShopQuote.CANT_AFFORD_OR_TOO_MUCH_TO_REPAIR);
      refuse(p, { reason: 'tooManyToRepair', entry });
      continue;
    }
    const rocketRifle = itemIsARocketRifle(ctx.content, part.item);
    if ((part.status[0] ?? 0) >= PERFECT_CONDITION && !rocketRifle) {
      asPart();
      p.quotes.push(ShopQuote.VALUE_OF_ZERO);
      if (main) refuse(p, { reason: 'notDamaged', entry });
      continue;
    }
    if (ctx.items.byIndex.get(part.item)?.itemClass !== ItemClass.AMMO && (part.status[0] ?? 0) < REALLY_BADLY_DAMAGED_THRESHOLD)
      p.quotes.push(ShopQuote.REALLY_DAMAGED);
    const status = dealerState(ctx.state, d.id).status;
    if (rocketRifle && hasDealerFlag(d, DealerFlag.REPAIRS_ELECTRONICS) && !(status.flags & FREDO_HAS_SAID_ROCKET_RIFLE_QUOTE))
      p.quotes.push(ShopQuote.CAN_RESET_IMPRINTING);
    const minutes = calculateObjectItemRepairTime(ctx, d.id, part);
    const start = queueEnd.at;
    const doneAt = u32(start + minutes + calculateOvernightRepairDelay(ctx, d.id, start, minutes));
    queueEnd.at = doneAt;
    const price = calculateObjectItemRepairCost(ctx, d.id, part);
    p.doa.push({ object: part, owner: o.owner, source, box: null, price, repairMinutes: minutes, doneAt });
  }
}

function moneyInPoa(p: Planner): number {
  return p.poa.reduce((n, e) => n + (e && e.kind === 'money' ? e.object.money : 0), 0);
}

function valueInPoa(p: Planner): number {
  return p.poa.reduce((n, e) => n + (e && (e.kind === 'money' || e.kind === 'sold') ? e.value : 0), 0);
}

function priceDoa(p: Planner): number {
  let cost = 0;
  for (let k = 0; k < p.doa.length; k++) {
    const e = p.doa[k];
    if (!e || e.box === null) {
      cost += e?.price ?? 0;
      continue;
    }
    const price = calcShopKeeperItemPrice(p.ctx, priceInput(p, true), e.object);
    p.doa[k] = { ...e, price };
    cost += price;
  }
  return u32(cost);
}

function onlyMoneyInPoa(p: Planner): boolean {
  let money = false;
  for (const e of p.poa) {
    if (!e) continue;
    if (!isMoney(p.ctx, e.object.item)) return false;
    money = true;
  }
  return money;
}

function placeOffers(p: Planner): void {
  const ctx = p.ctx;
  const d = dealerDef(ctx, p.input.dealer);
  const repairs = d.type === DealerType.REPAIRS;
  const inRepair = repairs ? countTotalItemsRepairDealerHasInForRepairs(ctx, d.id) : 0;
  const queueEnd = { at: repairs ? whenWillRepairmanBeAllDoneRepairing(ctx, d.id) : 0 };
  for (const [entry, o] of p.input.repair.entries()) {
    if (!repairs) {
      p.quotes.push(ShopQuote.NOT_INTERESTED);
      refuse(p, { reason: 'wontRepair', entry });
      continue;
    }
    planRepair(p, o, entry, inRepair, queueEnd);
  }
  if (p.input.sell.length + poaCount(p) > OFFER_AREA_SLOTS) refuse(p, { reason: 'playerOfferAreaFull' });
  for (const [entry, o] of p.input.sell.entries()) {
    if (repairs) {
      refuse(p, { reason: 'wontBuy', entry });
      continue;
    }
    evaluateSold(p, o, entry);
  }
  for (const o of p.input.cash) {
    if (!addToPoa(p, { kind: 'money', object: o.object, owner: o.owner, source: o.source, value: o.object.money }))
      refuse(p, { reason: 'playerOfferAreaFull' });
  }
}

function roomForPurchases(p: Planner): number {
  const valueless = p.poa.filter((e) => e && e.kind === 'part').length;
  return Math.max(0, OFFER_AREA_SLOTS - valueless - SLOTS_KEPT_FOR_CHANGE);
}

function transactionRefusal(p: Planner, cost: number, value: number, cash: number): { fromBalance: number; balanceNeeded: number } {
  const ctx = p.ctx;
  const d = dealerDef(ctx, p.input.dealer);
  const none = { fromBalance: 0, balanceNeeded: 0 };
  if (d.type !== DealerType.REPAIRS) {
    if (p.doa.length > roomForPurchases(p)) {
      refuse(p, { reason: 'noRoomForPurchases' });
      return none;
    }
  }
  let fromBalance = 0;
  let balanceNeeded = 0;
  if (cost > value) {
    if (cost > value + p.input.balance) {
      refuse(p, { reason: 'cannotAfford', shortfall: cost - (p.input.balance + value) });
      return none;
    }
    balanceNeeded = cost - value;
    if (!p.input.useBalance) {
      refuse(p, { reason: 'needBalance', amount: balanceNeeded });
      return { fromBalance: 0, balanceNeeded };
    }
    fromBalance = balanceNeeded;
  }
  if (d.type === DealerType.REPAIRS) {
    if (fromBalance + cash < cost) refuse(p, { reason: 'repairmanShort' });
    return { fromBalance, balanceNeeded };
  }
  const change = value - cost;
  const buys = d.type === DealerType.BUYS_ONLY || d.type === DealerType.BUYS_SELLS;
  if (buys && change > dealerState(ctx.state, d.id).status.cash && d.id !== role(ctx, 'JAKE')) {
    p.quotes.push(ShopQuote.CANT_AFFORD_OR_TOO_MUCH_TO_REPAIR);
    refuse(p, { reason: 'dealerCannotAfford' });
  }
  return { fromBalance, balanceNeeded };
}

function rawChange(p: Planner, cost: number, value: number, cash: number, fromBalance: number): number {
  const d = dealerDef(p.ctx, p.input.dealer);
  return d.type === DealerType.REPAIRS ? fromBalance + cash - cost : value - cost;
}

function changeQuote(p: Planner, change: number, cost: number): void {
  const d = dealerDef(p.ctx, p.input.dealer);
  if (!hasDealerFlag(d, DealerFlag.GIVES_CHANGE)) return;
  if (change > 0) {
    if (d.type !== DealerType.REPAIRS && cost === 0) p.quotes.push(ShopQuote.EXACTLY_ENOUGH);
    else if (cost > 0) p.quotes.push(ShopQuote.TOO_MUCH_MONEY);
  } else if (change === 0 || d.type === DealerType.REPAIRS) p.quotes.push(ShopQuote.EXACTLY_ENOUGH);
}

export function planTrade(ctx: MerchantContext, input: TradeInput): TradePlan {
  const p: Planner = {
    ctx,
    input,
    poa: Array.from({ length: OFFER_AREA_SLOTS }, () => null),
    doa: [],
    sells: [],
    quotes: [],
    refusal: null,
    evaluationQuoted: false,
  };
  planPurchases(p);
  placeOffers(p);
  const cost = priceDoa(p);
  const value = valueInPoa(p);
  const cash = moneyInPoa(p);
  const base = { dealer: input.dealer, poa: p.poa, doa: p.doa, sells: p.sells, cost, value, cash, quotes: p.quotes };
  if (p.refusal) return { ...base, gift: false, fromBalance: 0, change: 0, balanceNeeded: 0, refusal: p.refusal };
  if (onlyMoneyInPoa(p) && p.doa.length === 0) {
    p.quotes.push(ShopQuote.GIFT);
    return { ...base, gift: true, fromBalance: 0, change: 0, balanceNeeded: 0, refusal: null };
  }
  if (p.doa.length === 0 && poaCount(p) === 0) refuse(p, { reason: 'nothingToTrade' });
  const { fromBalance, balanceNeeded } = transactionRefusal(p, cost, value, cash);
  if (p.refusal) return { ...base, gift: false, fromBalance: 0, change: 0, balanceNeeded, refusal: p.refusal };
  const raw = rawChange(p, cost, value, cash, fromBalance);
  changeQuote(p, raw, cost);
  const givesChange = hasDealerFlag(dealerDef(ctx, input.dealer), DealerFlag.GIVES_CHANGE);
  return { ...base, gift: false, fromBalance, change: givesChange && raw > 0 ? raw : 0, balanceNeeded, refusal: null };
}

export interface TradeOutcome {
  readonly giftAccepted: boolean;
  readonly delivered: readonly PoaEntry[];
  readonly taken: readonly PoaEntry[];
  readonly purchased: readonly DoaEntry[];
  readonly repairs: readonly { readonly entry: DoaEntry; readonly element: number; readonly doneAt: number }[];
  readonly fromBalance: number;
  readonly change: number;
}

function giveChange(ctx: MerchantContext, dealer: number, amount: number): void {
  const status = dealerState(ctx.state, dealer).status;
  if (dealer === role(ctx, 'JAKE') && status.cash < amount) status.cash = amount;
  status.cash = u32(status.cash - amount);
}

function executeGift(ctx: MerchantContext, plan: TradePlan): TradeOutcome {
  const d = dealerDef(ctx, plan.dealer);
  const accepted = hasDealerFlag(d, DealerFlag.ACCEPTS_GIFTS);
  const taken: PoaEntry[] = [];
  if (accepted) {
    const status = dealerState(ctx.state, d.id).status;
    for (const e of plan.poa) {
      if (!e) continue;
      status.cash = u32(status.cash + e.object.money);
      taken.push(e);
    }
    const frank = ctx.content.dealers[role(ctx, 'FRANK')];
    if (isMercADealer(ctx, d.profile) && frank && d.profile === frank.profile && plan.cash >= FRANK_MIN_BRIBE)
      setFactTrue(ctx.narrative, Fact.FRANK_HAS_BEEN_BRIBED);
  }
  return { giftAccepted: accepted, delivered: [], taken, purchased: [], repairs: [], fromBalance: 0, change: 0 };
}

export function executeTrade(ctx: MerchantContext, plan: TradePlan): TradeOutcome {
  if (plan.refusal) throw new Error(`cannot execute a refused trade: ${plan.refusal.reason}`);
  if (plan.gift) return executeGift(ctx, plan);
  const d = dealerDef(ctx, plan.dealer);
  const status = dealerState(ctx.state, d.id).status;
  const poa = [...plan.poa];
  const taken: PoaEntry[] = [];
  for (let k = 0; k < poa.length; k++) {
    const e = poa[k];
    if (!e || (e.kind !== 'money' && e.kind !== 'sold')) continue;
    if (e.kind === 'money') status.cash = u32(status.cash + e.object.money);
    else if (d.type !== DealerType.BUYS_ONLY) addObjectToArmsDealerInventory(ctx, d.id, cloneObject(e.object));
    taken.push(e);
    poa[k] = null;
  }
  const repairs: { entry: DoaEntry; element: number; doneAt: number }[] = [];
  const purchased: DoaEntry[] = [];
  if (d.type === DealerType.REPAIRS) {
    if (plan.change > 0) {
      giveChange(ctx, d.id, plan.change);
      placeInFreeSlot(poa, changeEntry(ctx, plan.change));
    }
    for (const e of plan.doa) {
      const element = giveObjectToArmsDealerForRepair(ctx, d.id, e.object, e.owner);
      if (itemIsARocketRifle(ctx.content, e.object.item) && hasDealerFlag(d, DealerFlag.REPAIRS_ELECTRONICS))
        status.flags |= FREDO_HAS_SAID_ROCKET_RIFLE_QUOTE;
      const doneAt = ctxDoneTime(ctx, d.id, e.object.item, element);
      repairs.push({ entry: e, element, doneAt });
    }
  } else {
    for (const e of plan.doa) {
      placeInFreeSlot(poa, { kind: 'purchase', object: cloneObject(e.object), owner: NO_PROFILE, source: null, value: 0 });
      if (d.id === role(ctx, 'FRANZ') && e.object.item === ctx.content.itemIds.VIDEO_CAMERA) status.flags |= FRANZ_HAS_SOLD_VIDEO_CAMERA;
      removeItemFromArmsDealerInventory(ctx, d.id, e.object.item, specialItemInfoFromObject(ctx.items, e.object), e.object.count);
      purchased.push(e);
    }
    if (plan.change > 0) {
      placeInFreeSlot(poa, changeEntry(ctx, plan.change));
      giveChange(ctx, d.id, plan.change);
    }
    if (d.id === role(ctx, 'HOWARD')) setFactTrue(ctx.narrative, Fact.FACT_222);
  }
  status.cash = u32(status.cash + plan.fromBalance);
  status.lastSkiMinute = ctx.world.worldMinutes();
  const delivered = poa.filter((e): e is PoaEntry => e !== null);
  return { giftAccepted: false, delivered, taken, purchased, repairs, fromBalance: plan.fromBalance, change: plan.change };
}

function ctxDoneTime(ctx: MerchantContext, dealer: number, item: number, element: number): number {
  return dealerState(ctx.state, dealer).headers[item]?.specials[element]?.repairDoneTime ?? 0;
}

function changeEntry(ctx: MerchantContext, amount: number): PoaEntry {
  return { kind: 'change', object: createMoney(ctx.items, amount), owner: NO_PROFILE, source: null, value: 0 };
}

function placeInFreeSlot(poa: (PoaEntry | null)[], entry: PoaEntry): void {
  const k = poa.indexOf(null);
  if (k >= 0) poa[k] = entry;
}
