// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/BobbyR.cc InitBobbyRayInventory, InitBobbyRayNewInventory, InitBobbyRayUsedInventory,
// @src DailyUpdateOfBobbyRaysNewInventory, DailyUpdateOfBobbyRaysUsedInventory, HowManyBRItemsToOrder, OrderBobbyRItem,
// @src AddFreshBobbyRayInventory, GetInventorySlotForItem, SimulateBobbyRayCustomer, EnterBobbyR (under construction);
// @src Laptop/Store_Inventory.cc SetupStoreInventory; Tactical/ArmsDealerInvInit.cc BobbyRayItemQsortCompare,
// @src ItemTransactionOccurs (the Bobby Ray slot); Laptop/BobbyRGuns.cc CalcBobbyRayCost, PurchaseBobbyRayItem;
// @src Laptop/BobbyRMailOrder.cc CalcCostFromWeightOfPackage, CalcPackageTotalWeight, CalculateOrderDelay,
// @src PurchaseBobbyOrder, AddNewBobbyRShipment, AddJohnsGunShipment, RemovePurchasedItemsFromBobbyRayInventory, BtnBobbyRAcceptOrderCallback;
// @src Strategic/Strategic_Event_Handler.cc BobbyRayPurchaseEventCallback, DropOffItemsInDestination
// @src (the shipment facts), CloseCrate; Strategic/Player_Command.cc SetThisSectorAsPlayerControlled (site access). See docs/21 §5.

import { ItemClass, ItemFlags } from '../../../content/items/items.ts';
import type { ShippingDestination } from '../../../content/strategic/laptop-content.ts';
import type { MerchantContent } from '../../../content/strategic/merchant-content.ts';
import { type Sector, sameSector, sectorFromId, sectorShortString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { u8, u16, u32 } from '../../../core/int.ts';
import { createItem, createItems, type ItemObject } from '../../items/object.ts';
import {
  BOBBY_RAY,
  canDealerItemBeSoldUsed,
  compareItemsForSorting,
  DEALER_BUYING,
  determineInitialInvItems,
  howManyItemsAreSold,
  howManyItemsToReorder,
  itemIsLegal,
  itemTransactionOccurs,
  type SupplyContext,
} from '../../strategic/economy/merchants/supply.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { fact, setFact } from '../../strategic/narrative/facts.ts';
import { EventKind, NUM_MIN_IN_DAY } from '../../strategic/time/constants.ts';
import { addFutureDayStrategicEvent, addSameDayStrategicEvent, addStrategicEvent } from '../../strategic/time/event-queue.ts';
import { CompressionStop, stopTimeCompression, worldMinutesInDay } from '../../strategic/time/world-clock.ts';
import { setOpenableStructureToClosed } from '../../tactical/doors.ts';
import type { TacticalState } from '../../tactical/state.ts';
import { addItemToPool, Visibility } from '../../tactical/world-items.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { changeOpenableInUnloadedSector, sectorKey } from '../sector-diff.ts';
import { addItemsToUnloadedSector } from '../sector-loot.ts';
import type { LaptopContext } from './context.ts';
import { BobbyRaySiteVisit, Bookmark, type Shipment, type ShipmentLine, type StoreSlot, setBookmark } from './laptop-state.ts';
import { mailSpec, sender } from './mail.ts';

export const MAX_PURCHASE_LINES = 10;
const MAX_UNITS_PER_LINE = 201;
const MIN_SHIPPING_WEIGHT = 20;
const SHIPPING_WEIGHT_PER_KG = 10;
const ORDER_DELAYS = [1, 2, 3] as const;
const SAL_DEAD_DELAY_SPREAD = 5;
const DELIVERY_FIRST_HOUR = 8;
const DELIVERY_HOURS = 4;
const MINUTES_PER_HOUR = 60;
const USED_PURCHASE_OFFSET = 1000;
const NEW_PURCHASE_ARRIVAL_TIME = NUM_MIN_IN_DAY;
const USED_QUALITY_BASE = 20;
const USED_QUALITY_SPREAD = 60;
const NEW_QUALITY = 100;
const LOSS_CHANCE = 50;
const DAILY_DIE = 100;
const MIN_LOYALTY_FOR_DELIVERY = 20;
const LOST_SHIPMENT_GRIDNO = 2;
const PABLOS_STOLEN_DEST_GRIDNO = 1;
const THEFT_BASE = 12;
const THEFT_PER_SHIPMENT = 4;
const DAMAGE_BASE = 70;
const DAMAGE_SPREAD = 11;
const PERCENT = 100;
const SMALL_SHIPMENT = 5;
const MEDIUM_SHIPMENT = 15;
const SHIPMENT_OLD_AFTER_MINUTES = 120;
const AUTOMAG_III = 'AUTOMAG_III';
const JOHNS_AMMO = 'CLIP762N_5_AP';
const JOHNS_GUNS = 2;
const FULL_QUALITY = 100;
const JOHNS_AMMO_QUALITY = 5;
const STANDARD_SERVICE = 2;
const JOHNS_EXTRA_DAYS = 2;

export interface OrderLineRequest {
  readonly item: number;
  readonly used?: boolean | undefined;
  readonly quantity: number;
}

export interface OrderRequest {
  readonly lines: readonly OrderLineRequest[];
  readonly destination: number | null;
  readonly speed: number;
}

export type OrderRefusal = 'siteClosed' | 'noLines' | 'tooManyLines' | 'notInStock' | 'noDestination' | 'badSpeed' | 'funds';

export interface OrderQuote {
  readonly lines: readonly (ShipmentLine & { readonly unitPrice: number })[];
  readonly subtotal: number;
  readonly weight: number;
  readonly shipping: number;
  readonly total: number;
}

export interface OrderFormQuote extends OrderQuote {
  readonly affordable: boolean;
  readonly confirmDestination: boolean;
}

export interface BobbyRayTactical {
  readonly state: TacticalState;
}

function supply(ctx: LaptopContext, merchants: MerchantContent): SupplyContext {
  return {
    items: ctx.tactical.items,
    content: merchants,
    random: ctx.rng.main,
    gunNut: ctx.state.options.gunNut,
    highestProgress: ctx.state.status.highestProgress,
  };
}

function maxAmount(ctx: LaptopContext, item: number, used: boolean): number {
  return (used ? ctx.content.bobbyRayUsed : ctx.content.bobbyRayNew).get(item) ?? 0;
}

function storeList(ctx: LaptopContext, used: boolean): StoreSlot[] {
  return used ? ctx.laptop.bobbyRay.used : ctx.laptop.bobbyRay.inventory;
}

export function inventorySlotForItem(ctx: LaptopContext, item: number, used: boolean): number {
  return storeList(ctx, used).findIndex((s) => s.item === item);
}

function markEligible(ctx: LaptopContext, item: number, used: boolean): () => boolean {
  return () => {
    const slot = storeList(ctx, used)[inventorySlotForItem(ctx, item, used)];
    if (!slot) return false;
    slot.previouslyEligible = true;
    return true;
  };
}

function buildList(ctx: LaptopContext, merchants: MerchantContent, used: boolean): StoreSlot[] {
  const items = ctx.tactical.items;
  const indices = [...items.byIndex.keys()].sort((a, b) => a - b);
  const list: StoreSlot[] = [];
  for (const item of indices) {
    const def = items.byIndex.get(item);
    if (!def || maxAmount(ctx, item, used) === 0 || def.flags & ItemFlags.NOT_BUYABLE) continue;
    if (!itemIsLegal(items, item, ctx.state.options.gunNut)) continue;
    if (used && !canDealerItemBeSoldUsed(items, merchants.tables, item)) continue;
    list.push({ item, onHand: 0, onOrder: 0, quality: 0, previouslyEligible: false });
  }
  return list.sort((a, b) => compareItemsForSorting(items, merchants.tables, a.item, b.item, a.quality, b.quality));
}

function setupStoreInventory(ctx: LaptopContext, merchants: MerchantContent, used: boolean): void {
  const s = supply(ctx, merchants);
  for (const slot of storeList(ctx, used)) {
    const bought = determineInitialInvItems(
      s,
      BOBBY_RAY,
      slot.item,
      maxAmount(ctx, slot.item, used),
      used,
      markEligible(ctx, slot.item, used),
    );
    if (bought > 0) {
      slot.onHand = used ? 1 : bought;
      slot.quality = used ? USED_QUALITY_BASE + ctx.rng.main.int(USED_QUALITY_SPREAD) : NEW_QUALITY;
    } else {
      slot.onHand = 0;
      slot.quality = 0;
    }
  }
}

export function initBobbyRayInventory(ctx: LaptopContext, merchants: MerchantContent): void {
  const br = ctx.laptop.bobbyRay;
  br.inventory.splice(0, br.inventory.length, ...buildList(ctx, merchants, false));
  setupStoreInventory(ctx, merchants, false);
  br.used.splice(0, br.used.length, ...buildList(ctx, merchants, true));
  setupStoreInventory(ctx, merchants, true);
}

function simulateBobbyRayCustomer(ctx: LaptopContext, merchants: MerchantContent, used: boolean): void {
  const s = supply(ctx, merchants);
  for (const slot of storeList(ctx, used))
    if (slot.onHand > 0) slot.onHand = u8(slot.onHand - howManyItemsAreSold(s, BOBBY_RAY, slot.item, slot.onHand, used));
}

function howManyToOrder(ctx: LaptopContext, merchants: MerchantContent, slot: StoreSlot, used: boolean): number {
  const s = supply(ctx, merchants);
  if (!itemTransactionOccurs(s, BOBBY_RAY, slot.item, DEALER_BUYING, used, markEligible(ctx, slot.item, used))) return 0;
  return used ? 1 : howManyItemsToReorder(ctx.rng.main, maxAmount(ctx, slot.item, false), slot.onHand);
}

function orderBobbyRItem(ctx: LaptopContext, param: number): void {
  const minute = NEW_PURCHASE_ARRIVAL_TIME + ctx.rng.main.int(NEW_PURCHASE_ARRIVAL_TIME / 2) + ctx.now();
  addStrategicEvent(ctx.state.queue, EventKind.UPDATE_BOBBY_RAY_INVENTORY, minute, param);
}

export function addFreshBobbyRayInventory(ctx: LaptopContext, param: number): void {
  const used = param >= USED_PURCHASE_OFFSET;
  const item = used ? param - USED_PURCHASE_OFFSET : param;
  const quality = used ? USED_QUALITY_BASE + ctx.rng.main.int(USED_QUALITY_SPREAD) : NEW_QUALITY;
  const slot = storeList(ctx, used)[inventorySlotForItem(ctx, item, used)];
  if (!slot) return;
  slot.onHand = u8(slot.onHand + slot.onOrder);
  slot.quality = quality;
  slot.onOrder = 0;
}

function dailyUpdateNew(ctx: LaptopContext, merchants: MerchantContent): void {
  simulateBobbyRayCustomer(ctx, merchants, false);
  for (const slot of ctx.laptop.bobbyRay.inventory) {
    const max = maxAmount(ctx, slot.item, false);
    if (max === 0 || slot.onOrder !== 0 || slot.onHand > Math.trunc(max / 2)) continue;
    const previouslyEligible = slot.previouslyEligible;
    slot.onOrder = howManyToOrder(ctx, merchants, slot, false);
    if (slot.onOrder === 0) continue;
    if (!previouslyEligible) addFreshBobbyRayInventory(ctx, slot.item);
    else orderBobbyRItem(ctx, slot.item);
  }
}

function dailyUpdateUsed(ctx: LaptopContext, merchants: MerchantContent): void {
  simulateBobbyRayCustomer(ctx, merchants, true);
  for (const slot of ctx.laptop.bobbyRay.used) {
    if (slot.onOrder !== 0 || slot.onHand !== 0 || maxAmount(ctx, slot.item, true) === 0) continue;
    const previouslyEligible = slot.previouslyEligible;
    slot.onOrder = howManyToOrder(ctx, merchants, slot, true);
    if (slot.onOrder === 0) continue;
    if (!previouslyEligible) addFreshBobbyRayInventory(ctx, slot.item);
    else orderBobbyRItem(ctx, u16(slot.item + USED_PURCHASE_OFFSET));
  }
}

export function dailyUpdateOfBobbyRaysInventory(ctx: LaptopContext, merchants: MerchantContent): void {
  dailyUpdateNew(ctx, merchants);
  dailyUpdateUsed(ctx, merchants);
}

export function bobbyRayItemPrice(ctx: LaptopContext, item: number, quality: number, used: boolean): number {
  const price = ctx.tactical.items.byIndex.get(item)?.price ?? 0;
  if (!used) return u16(price);
  return u16(Math.trunc(price * (0.5 + (0.5 * quality) / PERCENT) + 0.5));
}

export function bobbyRayUnitPrice(ctx: LaptopContext, slot: StoreSlot, used: boolean): number {
  return bobbyRayItemPrice(ctx, slot.item, slot.quality, used);
}

export function shippingCost(destination: ShippingDestination | undefined, speed: number, weight: number): number {
  if (!destination) return 0;
  const rate = destination.rates[speed] ?? 0;
  const w = Math.max(weight, MIN_SHIPPING_WEIGHT);
  return u32(Math.trunc(Math.fround(Math.fround(w / SHIPPING_WEIGHT_PER_KG) * rate) + 0.5));
}

function orderLines(ctx: LaptopContext, r: OrderRequest): (ShipmentLine & { readonly unitPrice: number })[] | OrderRefusal {
  if (r.lines.length === 0) return 'noLines';
  if (r.lines.length > MAX_PURCHASE_LINES) return 'tooManyLines';
  const out: (ShipmentLine & { readonly unitPrice: number })[] = [];
  for (const line of r.lines) {
    const used = line.used === true;
    const slotIndex = inventorySlotForItem(ctx, line.item, used);
    const slot = storeList(ctx, used)[slotIndex];
    const already = out.filter((l) => l.slot === slotIndex && l.used === used).reduce((n, l) => n + l.count, 0);
    if (!slot || !Number.isInteger(line.quantity) || line.quantity < 1) return 'notInStock';
    if (slot.onHand < already + line.quantity || already + line.quantity > MAX_UNITS_PER_LINE) return 'notInStock';
    out.push({
      item: line.item,
      count: line.quantity,
      quality: used ? slot.quality : NEW_QUALITY,
      slot: slotIndex,
      used,
      unitPrice: bobbyRayUnitPrice(ctx, slot, used),
    });
  }
  return out;
}

export function quoteOrder(ctx: LaptopContext, r: OrderRequest): OrderQuote | OrderRefusal {
  if (!ctx.laptop.bobbyRay.siteCanBeAccessed) return 'siteClosed';
  const lines = orderLines(ctx, r);
  if (typeof lines === 'string') return lines;
  if (!Number.isInteger(r.speed) || r.speed < 0 || r.speed >= ORDER_DELAYS.length) return 'badSpeed';
  const destination = r.destination === null ? null : ctx.content.destinations[r.destination];
  if (destination === undefined) return 'noDestination';
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.count, 0);
  const weight = lines.reduce((sum, l) => sum + (ctx.tactical.items.byIndex.get(l.item)?.weight ?? 0) * l.count, 0);
  const shipping = destination ? shippingCost(destination, r.speed, weight) : 0;
  return { lines, subtotal, weight, shipping, total: subtotal + shipping };
}

export function destinationNeedsConfirmation(ctx: LaptopContext, destination: number | null): boolean {
  if (destination === null) return false;
  const primary = ctx.content.destinations.find((d) => d.isPrimary);
  if (!primary || destination !== primary.locationId || primary.deliverySector === null) return true;
  const sector = sectorFromId(primary.deliverySector, primary.deliverySectorZ);
  return ctx.state.map.elements[strategicIndex(sector)]?.enemyControlled === true;
}

export function quoteOrderForm(ctx: LaptopContext, r: OrderRequest): OrderFormQuote | OrderRefusal {
  const quote = quoteOrder(ctx, r);
  if (typeof quote === 'string') return quote;
  return {
    ...quote,
    affordable: ctx.state.finances.balance >= quote.total,
    confirmDestination: destinationNeedsConfirmation(ctx, r.destination),
  };
}

function salIsDead(ctx: LaptopContext): boolean {
  const sal = ctx.profile(ctx.content.namedProfiles.SAL ?? -1);
  return sal !== null && sal.life === 0;
}

function calculateOrderDelay(ctx: LaptopContext, speed: number): number {
  let days: number = ORDER_DELAYS[speed] ?? 0;
  if (salIsDead(ctx)) days += ctx.rng.main.int(SAL_DEAD_DELAY_SPREAD) + 1;
  return days;
}

function addNewBobbyRShipment(
  ctx: LaptopContext,
  destination: number,
  deliveryMethod: number,
  lines: readonly ShipmentLine[],
  weight: number,
  purchasedFromBobbyRay = true,
): number {
  const shipments = ctx.laptop.bobbyRay.shipments;
  let index = shipments.findIndex(() => shipments[0]?.active === false);
  const shipment: Shipment = {
    active: true,
    destination,
    speed: deliveryMethod,
    lines: lines.map((l) => ({ item: l.item, count: l.count, quality: l.quality, slot: l.slot, used: l.used })),
    weight: Math.max(weight, MIN_SHIPPING_WEIGHT),
    orderDay: ctx.day(),
    displayedOnShipmentsPage: purchasedFromBobbyRay,
  };
  if (index < 0) {
    shipments.push(shipment);
    index = shipments.length - 1;
  } else shipments[index] = shipment;
  const days = purchasedFromBobbyRay ? calculateOrderDelay(ctx, deliveryMethod) : deliveryMethod;
  const minute = (DELIVERY_FIRST_HOUR + ctx.rng.main.int(DELIVERY_HOURS)) * MINUTES_PER_HOUR;
  addFutureDayStrategicEvent(ctx.state.queue, ctx.state.clock, EventKind.BOBBYRAY_PURCHASE, minute, index, days);
  return index;
}

export function addJohnsGunShipment(ctx: LaptopContext): void {
  const items = ctx.tactical.items;
  const line = (name: string, count: number, quality: number): ShipmentLine => ({
    item: items.byName.get(name)?.index ?? 0,
    count,
    quality,
    slot: 0,
    used: false,
  });
  const lines = [line(AUTOMAG_III, JOHNS_GUNS, FULL_QUALITY), line(JOHNS_AMMO, JOHNS_GUNS, JOHNS_AMMO_QUALITY)];
  const days = calculateOrderDelay(ctx, STANDARD_SERVICE) + JOHNS_EXTRA_DAYS;
  const primary = ctx.content.destinations.findIndex((d) => d.isPrimary);
  addNewBobbyRShipment(ctx, primary, days, lines, 0, false);
}

export type OrderResult =
  | { readonly ok: true; readonly quote: OrderQuote; readonly shipment: number | null }
  | { readonly ok: false; readonly reason: OrderRefusal; readonly quote?: OrderQuote };

export function visitBobbyRay(ctx: LaptopContext): void {
  const br = ctx.laptop.bobbyRay;
  if (!br.siteCanBeAccessed) br.underConstructionVisit = BobbyRaySiteVisit.BEEN_TO_SITE_ONCE;
  setBookmark(ctx.laptop, Bookmark.BOBBYR);
}

export function placeOrder(ctx: LaptopContext, r: OrderRequest): OrderResult {
  visitBobbyRay(ctx);
  return purchaseBobbyRayOrder(ctx, r);
}

export function purchaseBobbyRayOrder(ctx: LaptopContext, r: OrderRequest): OrderResult {
  const quote = quoteOrder(ctx, r);
  if (typeof quote === 'string') return { ok: false, reason: quote };
  if (r.destination === null) return { ok: false, reason: 'noDestination' };
  if (ctx.state.finances.balance < quote.total) return { ok: false, reason: 'funds', quote };
  const destinationId = r.destination;
  const destination = ctx.content.destinations[destinationId];
  const weight = quote.weight;
  const shipment = destination?.canDeliver ? addNewBobbyRShipment(ctx, destinationId, r.speed, quote.lines, weight) : null;
  ctx.emitMoney(addTransaction(ctx.state.finances, FinanceCode.BOBBYR_PURCHASE, 0, ctx.now(), -quote.total));
  for (const l of quote.lines) {
    const slot = storeList(ctx, l.used)[l.slot];
    if (slot) slot.onHand = slot.onHand > l.count ? slot.onHand - l.count : 0;
  }
  return { ok: true, quote, shipment };
}

export function bobbyRaySiteAccessible(ctx: LaptopContext, sector: Sector): void {
  const primary = ctx.content.destinations.find((d) => d.isPrimary);
  if (!primary || primary.deliverySector === null || sector.z !== 0) return;
  if (!sameSector(sectorFromId(primary.deliverySector), sector)) return;
  const br = ctx.laptop.bobbyRay;
  const opened = !br.siteCanBeAccessed;
  br.siteCanBeAccessed = true;
  if (opened) ctx.emit({ type: 'bobbyRayOpen' });
  if (br.underConstructionVisit !== BobbyRaySiteVisit.BEEN_TO_SITE_ONCE) return;
  ctx.mail(mailSpec(ctx.content, 'BOBBYR_NOW_OPEN'), sender(ctx.content, 'BOBBY_R'));
  br.underConstructionVisit = BobbyRaySiteVisit.ALREADY_SENT_EMAIL;
}

function loadedTactical(ctx: LaptopContext, sector: Sector, tactical: BobbyRayTactical | null): BobbyRayTactical | null {
  const world = ctx.state.worldSector;
  return tactical && world && sameSector(world, sector) ? tactical : null;
}

function closeCrate(ctx: LaptopContext, sector: Sector, gridNo: number, tactical: BobbyRayTactical | null): BobbyRayTactical | null {
  const loaded = loadedTactical(ctx, sector, tactical);
  if (loaded) setOpenableStructureToClosed(loaded.state, gridNo);
  else changeOpenableInUnloadedSector(ctx.state.sectorDiffs.get(sectorKey(sector)), gridNo, false);
  return loaded;
}

function deliveredObject(ctx: LaptopContext, line: ShipmentLine): ItemObject {
  const o = createItem(ctx.tactical.items, line.item, line.quality);
  if (ctx.tactical.items.byIndex.get(line.item)?.itemClass === ItemClass.GUN) o.gunShotsLeft = 0;
  return o;
}

function stackedObjects(ctx: LaptopContext, line: ShipmentLine, delivered: number): ItemObject[] {
  const perPocket = ctx.tactical.items.byIndex.get(line.item)?.perPocket ?? 0;
  const out: ItemObject[] = [];
  for (let left = delivered; left > 0; ) {
    const n = perPocket > 1 ? Math.min(Math.max(left, 1), perPocket) : 1;
    out.push(createItems(ctx.tactical.items, line.item, line.quality, n));
    left -= n;
  }
  return out;
}

function placeHidden(
  ctx: LaptopContext,
  sector: Sector,
  gridNo: number,
  objects: readonly ItemObject[],
  loaded: BobbyRayTactical | null,
): void {
  if (loaded) for (const o of objects) addItemToPool(loaded.state, gridNo, o, Visibility.INVISIBLE, 0, 0);
  else addItemsToUnloadedSector(ctx.state, sector, gridNo, objects, 0, 0, Visibility.INVISIBLE);
}

function dropOffItemsInDestination(ctx: LaptopContext, index: number, dest: ShippingDestination, tactical: BobbyRayTactical | null): void {
  const shipments = ctx.laptop.bobbyRay.shipments;
  const shipment = shipments[index] as Shipment;
  const sector = sectorFromId(dest.deliverySector ?? 0, dest.deliverySectorZ);
  if (ctx.state.map.elements[strategicIndex(sector)]?.enemyControlled) {
    shipment.active = false;
    ctx.emit({ type: 'shipmentLost', shipment: index, reason: 'enemyHeld' });
    return;
  }
  const loaded = closeCrate(ctx, sector, dest.gridNo, tactical);
  const objects: ItemObject[] = [];
  const bound = shipments[0]?.lines.length ?? 0;
  for (let i = 0; i < bound; i++) {
    const line = shipment.lines[i];
    if (line) objects.push(...stackedObjects(ctx, line, line.count));
  }
  placeHidden(ctx, sector, dest.gridNo, objects, loaded);
  shipment.active = false;
  if (dest.emailOffset)
    ctx.mail({ name: dest.internalName, offset: dest.emailOffset, length: dest.emailLength }, sender(ctx.content, 'BOBBY_R'));
  ctx.emit({ type: 'shipmentDelivered', shipment: index, sector: sectorShortString(sector), items: objects.length, stolen: 0 });
}

function theftChance(ctx: LaptopContext): number {
  const br = ctx.laptop.bobbyRay;
  const facts = ctx.state.narrative;
  if (fact(facts, Fact.PABLO_WONT_STEAL) || ctx.content.pabloWontSteal) return 0;
  if (fact(facts, Fact.PABLOS_BRIBED)) {
    br.shipmentsSinceNoBribes = Math.trunc(br.shipmentsSinceNoBribes / 2);
    return 0;
  }
  br.shipmentsSinceNoBribes = u8(br.shipmentsSinceNoBribes + 1);
  return THEFT_BASE + ctx.rng.main.int(THEFT_PER_SHIPMENT * br.shipmentsSinceNoBribes);
}

function damaged(ctx: LaptopContext, o: ItemObject): void {
  const status = Math.trunc(((DAMAGE_BASE + ctx.rng.main.int(DAMAGE_SPREAD)) * (o.status[0] ?? 0)) / PERCENT);
  o.status[0] = Math.max(1, status);
}

function setShipmentSizeFacts(ctx: LaptopContext, delivered: number): void {
  const facts = ctx.state.narrative;
  setFact(facts, Fact.MEDIUM_SIZED_SHIPMENT_WAITING, delivered > SMALL_SHIPMENT && delivered <= MEDIUM_SHIPMENT);
  setFact(facts, Fact.LARGE_SIZED_SHIPMENT_WAITING, delivered > MEDIUM_SHIPMENT);
  setFact(facts, Fact.REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING, true);
  const s = ctx.state;
  addSameDayStrategicEvent(
    s.queue,
    s.clock,
    EventKind.SET_BY_NPC_SYSTEM,
    worldMinutesInDay(s.clock) + SHIPMENT_OLD_AFTER_MINUTES,
    Fact.REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING,
  );
}

export function bobbyRayPurchaseEvent(ctx: LaptopContext, index: number, tactical: BobbyRayTactical | null): void {
  const shipment = ctx.laptop.bobbyRay.shipments[index];
  if (!shipment) return;
  const dest = ctx.content.destinations[shipment.destination];
  if (!dest) return;
  if (shipment.active && dest.canDeliver && !dest.isPrimary) {
    dropOffItemsInDestination(ctx, index, dest, tactical);
    return;
  }
  const facts = ctx.state.narrative;
  const sector = sectorFromId(dest.deliverySector ?? 0, dest.deliverySectorZ);
  const element = ctx.state.map.elements[strategicIndex(sector)];
  let gridNo = dest.gridNo;
  if (fact(facts, Fact.NEXT_PACKAGE_CAN_BE_LOST)) {
    setFact(facts, Fact.NEXT_PACKAGE_CAN_BE_LOST, false);
    if (ctx.rng.main.int(DAILY_DIE) < LOSS_CHANCE) {
      shipment.active = false;
      setFact(facts, Fact.LAST_SHIPMENT_CRASHED, true);
      ctx.emit({ type: 'shipmentLost', shipment: index, reason: 'crashed' });
      return;
    }
  } else if (fact(facts, Fact.NEXT_PACKAGE_CAN_BE_DELAYED)) {
    setFact(facts, Fact.LAST_SHIPMENT_WENT_TO_WRONG_AIRPORT, true);
    setFact(facts, Fact.NEXT_PACKAGE_CAN_BE_DELAYED, false);
    gridNo = LOST_SHIPMENT_GRIDNO;
  } else if ((ctx.state.economy.towns[element?.nameId ?? 0]?.rating ?? 0) < MIN_LOYALTY_FOR_DELIVERY || element?.enemyControlled) {
    shipment.active = false;
    setFact(facts, Fact.AGENTS_PREVENTED_SHIPMENT, true);
    ctx.emit({ type: 'shipmentLost', shipment: index, reason: 'prevented' });
    return;
  }
  const units = shipment.lines.reduce((n, l) => n + l.count, 0);
  const automag = ctx.tactical.items.byName.get(AUTOMAG_III)?.index;
  const fromKulba = shipment.lines.some((l) => l.item === automag);
  const loaded = closeCrate(ctx, sector, dest.gridNo, tactical);
  const chance = theftChance(ctx);
  const delivered: ItemObject[] = [];
  const stolen: ItemObject[] = [];
  let stolenCount = 0;
  let stoleLast = false;
  for (const line of shipment.lines) {
    const o = deliveredObject(ctx, line);
    let toDeliver = 0;
    for (let j = 0; j < line.count; j++) {
      const roll = (bonus: number) => ctx.rng.main.int(DAILY_DIE) < chance + bonus;
      const steals = loaded ? !stoleLast && chance > 0 && roll(line.count) : j > 1 && !stoleLast && chance > 0 && roll(j);
      if (steals) {
        if (!loaded) stolen.push({ ...o, status: [...o.status] });
        stolenCount++;
        stoleLast = true;
        continue;
      }
      stoleLast = false;
      if (gridNo === LOST_SHIPMENT_GRIDNO) {
        damaged(ctx, o);
        delivered.push({ ...o, status: [...o.status] });
      } else toDeliver++;
    }
    if (line.count === 1 && toDeliver === 1) delivered.push(o);
    else delivered.push(...stackedObjects(ctx, line, toDeliver));
  }
  placeHidden(ctx, sector, gridNo, delivered, loaded);
  if (!loaded && stolen.length > 0) placeHidden(ctx, sector, PABLOS_STOLEN_DEST_GRIDNO, stolen, null);
  setFact(facts, Fact.PABLOS_STOLE_FROM_LATEST_SHIPMENT, stolenCount > 0);
  setFact(facts, Fact.LARGE_SIZED_OLD_SHIPMENT_WAITING, false);
  if (fact(facts, Fact.NEXT_PACKAGE_CAN_BE_DELAYED)) {
    setFact(facts, Fact.MEDIUM_SIZED_SHIPMENT_WAITING, false);
    setFact(facts, Fact.LARGE_SIZED_SHIPMENT_WAITING, false);
    setFact(facts, Fact.REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING, false);
  } else setShipmentSizeFacts(ctx, units - stolenCount);
  shipment.active = false;
  stopTimeCompression(ctx.clockContext, CompressionStop.SHIPMENT);
  if (fromKulba) ctx.mail(mailSpec(ctx.content, 'JOHN_KULBA_GIFT_IN_DRASSEN'), sender(ctx.content, 'JOHN_KULBA'));
  else ctx.mail({ name: dest.internalName, offset: dest.emailOffset, length: dest.emailLength }, sender(ctx.content, 'BOBBY_R'));
  ctx.emit({ type: 'shipmentDelivered', shipment: index, sector: sectorShortString(sector), items: delivered.length, stolen: stolenCount });
}
