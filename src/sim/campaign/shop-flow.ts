// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ShopKeeper_Interface.cc EnterShopKeeperInterface, InitializeShopKeeper,
// @src CanMercInteractWithSelectedShopkeeper, ExitSKIRequested, DealWithItemsStillOnTheTable, ReturnItemToPlayerSomehow,
// @src SKITryToReturnInvToOwnerOrCurrentMerc, SKITryToAddInvToMercsInventory, GetInvSlotOfUnfullMoneyInMercInventory,
// @src ShopkeeperAutoPlaceObject, ShopkeeperAddItemToPool, HandleShopKeeperDialog (opening quote);
// @src Soldier_Control.cc (talking: AP_TALK, facing); Interface_Panels.cc (SM panel merc). See docs/23 §9, §13.

import { AnimFlags } from '../../content/anim/tables.ts';
import { ItemClass, NOTHING } from '../../content/items/items.ts';
import type { DealerDef } from '../../content/strategic/merchant-content.ts';
import { pythSpacesAway } from '../../content/world/grid.ts';
import { u8 } from '../../core/int.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import {
  cloneObject,
  createMoney,
  deleteObject,
  type ItemObject,
  MAX_OBJECTS_PER_SLOT,
  NO_PROFILE,
  removeObjectAt,
} from '../items/object.ts';
import { type CollectRepair, type DealerBox, determineArmsDealersSellingInventory } from '../strategic/economy/merchants/boxes.ts';
import { dealerDef, isMercADealer, type MerchantContext } from '../strategic/economy/merchants/context.ts';
import type { ShopItemRef } from '../strategic/economy/merchants/events.ts';
import { doesDealerDoRepairs, handlePossibleRepairDelays } from '../strategic/economy/merchants/repair.ts';
import { dealerState } from '../strategic/economy/merchants/state.ts';
import {
  executeTrade,
  type ObjectSource,
  type PlayerObject,
  type PoaEntry,
  planTrade,
  ShopQuote,
  type TradeInput,
  type TradePlan,
} from '../strategic/economy/merchants/trade.ts';
import { type ShopView, shopBoxView, shopKind } from '../strategic/economy/merchants/view.ts';
import { NUMBER_OF_SQUADS } from '../strategic/forces/constants.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { hasAnimFlag, setDesiredDirection } from '../tactical/animation.ts';
import { soldierTo3DLocationLos } from '../tactical/combat/positions.ts';
import { autoPlaceObject, moneySlotLimit, NUM_INV_SLOTS, placeObject } from '../tactical/inventory.ts';
import { directionToward, stopMerc } from '../tactical/movement.ts';
import { distanceVisible } from '../tactical/perception/sight.ts';
import { deductPoints, enoughPoints } from '../tactical/points.ts';
import { OKLIFE, type Soldier, Team } from '../tactical/soldier.ts';
import { soldierInventoryContext } from '../tactical/soldier-inventory.ts';
import type { TacticalState } from '../tactical/state.ts';
import { addItemToPool, Visibility } from '../tactical/world-items.ts';
import type { CampaignCommand, CampaignSim } from './campaign-sim.ts';
import { addTransaction, FinanceCode } from './finances.ts';

export const AP_TALK = 6;
export const NPC_TALK_RADIUS = 4;
const SHOP_LOS_CUBE_LEVEL = 3;
const DIRECTION_IRRELEVANT = -1;
const OPPOSITE = 4;
const DIRECTIONS = 8;
const NOT_VISIBLE = -1;
const SHOP_COMMANDS: ReadonlySet<string> = new Set(['openShop', 'quoteTrade', 'trade', 'closeShop']);

interface ShopSession {
  readonly dealer: number;
  readonly dealerSoldier: number;
  readonly selected: number;
  pricing: number;
  boxes: DealerBox[];
  businessDone: boolean;
}

type Json = Readonly<Record<string, unknown>>;

class Refusal extends Error {
  readonly data: Json | undefined;

  constructor(reason: string, data?: Json) {
    super(reason);
    this.data = data;
  }
}

const refuse = (reason: string, data?: Json): never => {
  throw new Refusal(reason, data);
};

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function itemRef(ctx: MerchantContext, o: ItemObject): ShopItemRef {
  const count = ctx.items.byIndex.get(o.item)?.itemClass === ItemClass.MONEY ? o.money : o.count;
  return { item: ctx.items.byIndex.get(o.item)?.name ?? String(o.item), count, status: o.status[0] ?? 0 };
}

export class ShopFlow {
  readonly #campaign: CampaignSim;
  readonly #events: SimEvent[] = [];
  #session: ShopSession | null = null;

  constructor(campaign: CampaignSim) {
    this.#campaign = campaign;
  }

  isOpen(): boolean {
    return this.#session !== null;
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  #emit(e: Record<string, unknown> & { readonly type: string }): void {
    this.#events.push({ ...e, tick: this.#campaign.tick } as SimEvent);
  }

  get #ctx(): MerchantContext {
    const ctx = this.#campaign.merchants;
    if (!ctx) throw new Error('no merchants in this campaign');
    return ctx;
  }

  get #t(): TacticalState | null {
    return this.#campaign.tactical?.state ?? null;
  }

  dispatch(cmd: CampaignCommand): CommandResult | null {
    const open = this.#session !== null;
    if (!SHOP_COMMANDS.has(cmd.type)) return open ? { ok: false, reason: 'a shop is open: trade or closeShop first' } : null;
    try {
      switch (cmd.type) {
        case 'openShop':
          return this.#open(cmd);
        case 'quoteTrade':
          return this.#trade(cmd, true);
        case 'trade':
          return this.#trade(cmd, false);
        default:
          return this.#close();
      }
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, reason: e.message, ...(e.data ? { data: e.data } : {}) };
      throw e;
    }
  }

  dealerSoldier(profile: number): Soldier | null {
    const t = this.#t;
    if (!t) return null;
    return t.soldiers.find((s) => s?.placed && s.team !== Team.OUR && s.profile === profile && !s.dead) ?? null;
  }

  #currentSquad(): number {
    return this.#campaign.state.forces.currentSquad;
  }

  #onCurrentSquad(s: Soldier): boolean {
    if (!this.#campaign.strategic) return s.team === Team.OUR;
    const q = this.#currentSquad();
    if (q < 0 || q >= NUMBER_OF_SQUADS) return false;
    return (this.#campaign.state.forces.squads[q] ?? []).includes(s.id);
  }

  #mechanical(s: Soldier): boolean {
    const merc = this.#campaign.strategic?.mercs.get(s.id);
    return merc ? merc.isVehicle || merc.isRobot : false;
  }

  #interactionRefusal(s: Soldier, dealer: Soldier): string | null {
    const t = this.#t;
    if (!t || dealer.life < OKLIFE) return 'dealerDown';
    if (!s.placed || s.team !== Team.OUR) return 'mercCantTrade';
    if (!this.#onCurrentSquad(s)) return 'notOnCurrentSquad';
    if (s.life < OKLIFE || this.#mechanical(s)) return 'mercCantTrade';
    const visible = distanceVisible(t, s, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, dealer.gridNo, dealer.level);
    if (!soldierTo3DLocationLos(t, s, dealer.gridNo, dealer.level, SHOP_LOS_CUBE_LEVEL, u8(visible), true)) return 'noLineOfSight';
    if (pythSpacesAway(s.gridNo, dealer.gridNo) > NPC_TALK_RADIUS) return 'tooFar';
    return null;
  }

  #canInteract(s: Soldier | null): boolean {
    const session = this.#session;
    const t = this.#t;
    const dealer = session && t ? t.soldiers[session.dealerSoldier] : null;
    return !!s && !!dealer && this.#interactionRefusal(s, dealer) === null;
  }

  #resolveDealer(value: unknown): DealerDef | null {
    const ctx = this.#ctx;
    if (isInt(value)) return ctx.content.dealers.find((d) => d.profile === value) ?? null;
    if (typeof value !== 'string') return null;
    const name = value.toUpperCase();
    return ctx.content.dealers.find((d) => d.profileName.toUpperCase() === name) ?? null;
  }

  #open(cmd: CampaignCommand): CommandResult {
    if (this.#session) refuse('a shop is already open');
    const campaign = this.#campaign;
    const tactical = campaign.tactical;
    const ctx = this.#ctx;
    if (campaign.state.flow !== 'tactical' || !tactical) refuse('notInTactical');
    if (campaign.battle?.hasPendingDecision()) refuse('a prompt is open');
    const t = tactical?.state as TacticalState;
    const s = tactical?.soldier(cmd.soldier) ?? null;
    if (!s || s.team !== Team.OUR) refuse('no such soldier of yours');
    const merc = s as Soldier;
    const turn = tactical?.canAct(merc) ?? null;
    if (turn) refuse(turn);
    const d = this.#resolveDealer(cmd.dealer);
    if (!d || !isMercADealer(ctx, d.profile)) refuse('notADealer');
    const def = d as DealerDef;
    const dealer = this.dealerSoldier(def.profile);
    if (!dealer) return refuse('dealerAbsent');
    if (dealerState(ctx.state, def.id).status.outOfBusiness) refuse('outOfBusiness');
    if (dealer.life < OKLIFE || dealer.collapsed) refuse('dealerDown');
    if (dealer.visible === NOT_VISIBLE) refuse('dealerHidden');
    if (!dealer.neutral) refuse('dealerHostile');
    if (!t.inCombat && hasAnimFlag(t.content, dealer.state, AnimFlags.MOVING)) refuse('dealerMoving');
    this.#selectSquadOf(merc);
    const interaction = this.#interactionRefusal(merc, dealer);
    if (interaction) refuse(interaction);
    if (!enoughPoints(t.inCombat, merc, AP_TALK)) refuse('notEnoughAP');
    if (ctx.hooks.buySellRecordPending(def.profile)) refuse('npcWantsToTalk');
    if (ctx.hooks.shopClosedByScript(def.profile)) refuse('shopClosedByScript');
    deductPoints(t.inCombat, merc, AP_TALK, 0);
    const facing = directionToward(merc.gridNo, dealer.gridNo);
    setDesiredDirection(t, merc, facing);
    setDesiredDirection(t, dealer, (facing + OPPOSITE) % DIRECTIONS);
    stopMerc(t, merc);
    this.#session = { dealer: def.id, dealerSoldier: dealer.id, selected: merc.id, pricing: merc.id, boxes: [], businessDone: false };
    this.#emit({ type: 'shopOpened', dealer: def.profile, soldier: merc.id });
    const delayed = doesDealerDoRepairs(ctx, def.id) && handlePossibleRepairDelays(ctx, def.id);
    if (delayed) {
      this.#emit({ type: 'repairDelayed', dealer: def.profile });
      this.#requireSession().businessDone = true;
    }
    this.#emit({ type: 'shopkeeperQuote', dealer: def.profile, quote: delayed ? ShopQuote.REPAIR_DELAYED : ShopQuote.FIRST_ENTERS });
    this.#initializeShopKeeper();
    return { ok: true, data: this.view() };
  }

  #selectSquadOf(s: Soldier): void {
    const merc = this.#campaign.strategic?.mercs.get(s.id);
    if (merc && merc.assignment >= 0 && merc.assignment < NUMBER_OF_SQUADS) this.#campaign.state.forces.currentSquad = merc.assignment;
  }

  #requireSession(): ShopSession {
    const session = this.#session;
    if (!session) return refuse('shopNotOpen');
    return session;
  }

  #initializeShopKeeper(): void {
    const session = this.#requireSession();
    const ctx = this.#ctx;
    dealerState(ctx.state, session.dealer).status.lastSkiMinute = worldTotalMinutes(this.#campaign.state.clock);
    session.boxes = determineArmsDealersSellingInventory(ctx, session.dealer, this.#collectRepair());
  }

  #collectRepair(): CollectRepair {
    return (repaired) => {
      const session = this.#requireSession();
      const ctx = this.#ctx;
      const t = this.#t;
      const pricing = t?.soldiers[session.pricing] ?? null;
      const current = this.#canInteract(pricing) ? pricing : null;
      const drop = current ?? t?.soldiers[session.selected] ?? null;
      const to = this.#deliver(repaired.object, repaired.owner, current, drop);
      this.#emit({
        type: 'repairCollected',
        dealer: dealerDef(ctx, session.dealer).profile,
        item: ctx.items.byIndex.get(repaired.object.item)?.name ?? String(repaired.object.item),
        owner: repaired.owner,
        to,
      });
      return true;
    };
  }

  #ownerSoldier(profile: number): Soldier | null {
    const t = this.#t;
    if (!t || profile === NO_PROFILE) return null;
    return t.soldiers.find((s) => s?.team === Team.OUR && s.profile === profile && !s.dead) ?? null;
  }

  #deliver(object: ItemObject, owner: number, current: Soldier | null, drop: Soldier | null): number | null {
    const o = cloneObject(object);
    const ownerSoldier = this.#ownerSoldier(owner);
    if (ownerSoldier && this.#canInteract(ownerSoldier) && this.#addToInventory(o, ownerSoldier)) return ownerSoldier.id;
    if (current && this.#addToInventory(o, current)) return current.id;
    if (drop) this.#dropAt(o, drop);
    return null;
  }

  #addToInventory(o: ItemObject, s: Soldier): boolean {
    const t = this.#t;
    if (!t) return false;
    const ctx = soldierInventoryContext(t, s);
    const money = this.#ctx.content.itemIds.MONEY;
    if (this.#ctx.items.byIndex.get(o.item)?.itemClass === ItemClass.MONEY) {
      for (let pos = 0; pos < NUM_INV_SLOTS; pos++) {
        const slot = s.inv[pos];
        if (slot?.item !== money || slot.money >= moneySlotLimit(pos)) continue;
        placeObject(ctx, s, pos, o);
        if (o.money === 0) return true;
        break;
      }
    }
    const copy = cloneObject(o);
    let left = o.count;
    while (left > 0) {
      o.count = Math.min(MAX_OBJECTS_PER_SLOT, left);
      left -= o.count;
      if (!autoPlaceObject(ctx, s, o)) {
        o.count += left;
        return false;
      }
      Object.assign(o, cloneObject(copy));
    }
    return true;
  }

  #dropAt(o: ItemObject, s: Soldier): void {
    const t = this.#t;
    if (!t || o.item === NOTHING || o.count === 0) return;
    const copy = cloneObject(o);
    const dropped: ShopItemRef[] = [];
    for (let left = o.count; left > 0; ) {
      const chunk = cloneObject(copy);
      chunk.count = Math.min(MAX_OBJECTS_PER_SLOT, left);
      left -= chunk.count;
      addItemToPool(t, s.gridNo, chunk, Visibility.VISIBLE, s.level, 0, 0);
      dropped.push(itemRef(this.#ctx, chunk));
    }
    this.#emit({ type: 'itemsDropped', gridNo: s.gridNo, items: dropped });
  }

  #close(): CommandResult {
    const session = this.#requireSession();
    const profile = dealerDef(this.#ctx, session.dealer).profile;
    this.#emit({
      type: 'shopkeeperQuote',
      dealer: profile,
      quote: session.businessDone ? ShopQuote.DONE_WITH_TRANSACTION : ShopQuote.DONE_WITHOUT_TRANSACTION,
    });
    this.#emit({ type: 'shopClosed', dealer: profile });
    this.#session = null;
    return { ok: true };
  }

  #pricingSoldier(cmd: CampaignCommand, session: ShopSession): Soldier {
    const t = this.#t;
    const id = cmd.soldier === undefined ? session.pricing : cmd.soldier;
    const s = isInt(id) ? (t?.soldiers[id] ?? null) : null;
    if (!s?.placed || s.team !== Team.OUR || s.life <= 0 || !this.#onCurrentSquad(s)) return refuse('noSuchPricingMerc');
    return s;
  }

  #receiver(cmd: CampaignCommand, pricing: Soldier): Soldier {
    const t = this.#t;
    const s = cmd.receiver === undefined ? pricing : isInt(cmd.receiver) ? (t?.soldiers[cmd.receiver] ?? null) : null;
    if (!s || !this.#canInteract(s)) return refuse('receiverCantTrade');
    return s;
  }

  #list(cmd: CampaignCommand, key: string): Json[] {
    const v = cmd[key];
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((e) => typeof e !== 'object' || e === null)) return refuse(`${key} must be a list of objects`);
    return v as Json[];
  }

  #itemId(value: unknown): number | null {
    const items = this.#ctx.items;
    if (isInt(value)) return items.byIndex.has(value) ? value : null;
    if (typeof value === 'string') return items.byName.get(value)?.index ?? null;
    return null;
  }

  #resolveBuys(cmd: CampaignCommand, session: ShopSession): TradeInput['buy'] {
    const seen = new Set<string>();
    return this.#list(cmd, 'buy').map((e) => {
      const item = this.#itemId(e.item);
      const element = e.element === undefined ? -1 : e.element;
      if (item === null || !isInt(element)) return refuse('noSuchBox');
      const key = `${item}/${element}`;
      if (seen.has(key)) refuse('duplicateSource');
      seen.add(key);
      const boxes = session.boxes.filter((b) => b.key.item === item && b.key.element === element);
      if (boxes.length === 0) refuse('noSuchBox');
      const count = e.count === undefined ? 1 : e.count;
      if (!isInt(count)) refuse('notEnoughInBox');
      return { boxes, count: count as number };
    });
  }

  #slotOf(value: unknown): number | null {
    if (value === 'hand') return 5;
    return isInt(value) && value >= 0 && value < NUM_INV_SLOTS ? value : null;
  }

  #resolveSources(cmd: CampaignCommand, key: 'sell' | 'repair' | 'cash', used: Set<string>): PlayerObject[] {
    const t = this.#t;
    return this.#list(cmd, key).map((e) => {
      const s = isInt(e.soldier) ? (t?.soldiers[e.soldier] ?? null) : null;
      const slot = this.#slotOf(e.slot);
      if (!s || s.team !== Team.OUR || slot === null) return refuse('itemNotFound');
      const o = s.inv[slot];
      if (!o || o.item === NOTHING || o.count === 0) return refuse('itemNotFound');
      if (!this.#canInteract(s)) refuse('mercCantTrade');
      const index = key === 'cash' || e.index === undefined ? null : e.index;
      if (index !== null && (!isInt(index) || index < 0 || index >= o.count)) return refuse('itemNotFound');
      const whole = `${s.id}/${slot}`;
      const member = index === null ? null : `${whole}/${index}`;
      if (used.has(whole) || (member && used.has(member)) || (index === null && [...used].some((u) => u.startsWith(`${whole}/`))))
        refuse('duplicateSource');
      used.add(member ?? whole);
      if (key === 'cash') return this.#cashObject(s, slot, o, e);
      const object = cloneObject(o);
      if (index !== null) {
        object.count = 1;
        object.status = [o.status[index] ?? 0];
      }
      return { object, owner: s.profile, source: { soldier: s.id, slot, index, amount: null } };
    });
  }

  #cashObject(s: Soldier, slot: number, o: ItemObject, e: Json): PlayerObject {
    if (this.#ctx.items.byIndex.get(o.item)?.itemClass !== ItemClass.MONEY) return refuse('notMoney');
    const amount = e.amount === undefined ? o.money : e.amount;
    if (!isInt(amount) || amount <= 0 || amount > o.money) return refuse('notEnoughMoney');
    const object = amount === o.money ? cloneObject(o) : createMoney(this.#ctx.items, amount);
    return { object, owner: s.profile, source: { soldier: s.id, slot, index: null, amount: amount === o.money ? null : amount } };
  }

  #tradeInput(cmd: CampaignCommand, session: ShopSession, pricing: Soldier): TradeInput {
    const used = new Set<string>();
    const ctx = this.#ctx;
    return {
      dealer: session.dealer,
      pricingProfile: pricing.profile,
      weaponSaleModifier: ctx.content.weaponSaleModifiers.get(pricing.profile) ?? 100,
      balance: this.#campaign.state.finances.balance,
      useBalance: cmd.useBalance === true,
      buy: this.#resolveBuys(cmd, session),
      sell: this.#resolveSources(cmd, 'sell', used),
      cash: this.#resolveSources(cmd, 'cash', used),
      repair: this.#resolveSources(cmd, 'repair', used),
    };
  }

  #quote(plan: TradePlan, input: TradeInput): Json {
    const ctx = this.#ctx;
    const name = (item: number) => ctx.items.byIndex.get(item)?.name ?? String(item);
    const repairs = doesDealerDoRepairs(ctx, plan.dealer);
    return {
      buy: repairs
        ? []
        : plan.doa.map((e) => ({ key: e.box?.key ?? null, item: name(e.object.item), count: e.object.count, price: e.price })),
      sell: plan.sells.map((s, k) => ({
        ...this.#sourceRef(input.sell[k]?.source),
        item: name(s.item),
        evaluation: s.evaluation,
        value: s.value,
      })),
      repair: repairs
        ? plan.doa.map((e) => ({ item: name(e.object.item), owner: e.owner, cost: e.price, minutes: e.repairMinutes, doneAt: e.doneAt }))
        : [],
      cash: input.cash.map((c) => ({ ...this.#sourceRef(c.source), amount: c.object.money })),
      totals: { cost: plan.cost, value: plan.value, cash: plan.cash },
      gift: plan.gift,
      change: plan.change,
      balanceNeeded: plan.balanceNeeded,
      refusal: plan.refusal,
    };
  }

  #sourceRef(source: ObjectSource | undefined): Json {
    return source ? { soldier: source.soldier, slot: source.slot, ...(source.index !== null ? { index: source.index } : {}) } : {};
  }

  #trade(cmd: CampaignCommand, quoteOnly: boolean): CommandResult {
    const session = this.#requireSession();
    const ctx = this.#ctx;
    const pricing = this.#pricingSoldier(cmd, session);
    const receiver = this.#receiver(cmd, pricing);
    const input = this.#tradeInput(cmd, session, pricing);
    const plan = planTrade(ctx, input);
    const quote = this.#quote(plan, input);
    if (quoteOnly) return { ok: true, data: quote };
    if (plan.refusal) {
      const { reason, ...detail } = plan.refusal;
      return { ok: false, reason, data: detail };
    }
    session.pricing = pricing.id;
    const outcome = executeTrade(ctx, plan);
    const profile = dealerDef(ctx, session.dealer).profile;
    for (const q of plan.quotes) this.#emit({ type: 'shopkeeperQuote', dealer: profile, quote: q });
    if (plan.gift) {
      this.#emit({ type: 'giftGiven', dealer: profile, amount: plan.cash, accepted: outcome.giftAccepted });
      this.#removeSources(outcome.taken.map((e) => e.source));
      return { ok: true, data: { giftAccepted: outcome.giftAccepted, shop: this.view() } };
    }
    this.#removeSources([...outcome.taken.map((e) => e.source), ...input.repair.map((r) => r.source)]);
    if (plan.fromBalance > 0) {
      const record = addTransaction(
        this.#campaign.state.finances,
        FinanceCode.PURCHASED_ITEM_FROM_DEALER,
        profile,
        worldTotalMinutes(this.#campaign.state.clock),
        -plan.fromBalance,
      );
      this.#emit({ type: 'moneyChanged', code: record.code, amount: record.amount, balance: record.balanceAfter });
    }
    const sold = outcome.taken.filter((e) => e.kind === 'sold');
    if (sold.length > 0)
      this.#emit({
        type: 'itemsSold',
        dealer: profile,
        items: sold.map((e) => itemRef(ctx, e.object)),
        total: sold.reduce((n, e) => n + e.value, 0),
      });
    if (outcome.purchased.length > 0)
      this.#emit({ type: 'itemsBought', dealer: profile, items: outcome.purchased.map((e) => itemRef(ctx, e.object)), total: plan.cost });
    for (const r of outcome.repairs) {
      this.#emit({
        type: 'repairQueued',
        dealer: profile,
        item: itemRef(ctx, r.entry.object).item,
        owner: r.entry.owner,
        doneAt: r.doneAt,
      });
    }
    const delivered = outcome.delivered.map((e) => this.#deliverEntry(e, receiver));
    session.businessDone = true;
    this.#initializeShopKeeper();
    return {
      ok: true,
      data: {
        paid: { cash: plan.cash, balance: plan.fromBalance },
        cost: plan.cost,
        value: plan.value,
        change: outcome.change,
        delivered,
        repairs: outcome.repairs.map((r) => ({ item: itemRef(ctx, r.entry.object).item, owner: r.entry.owner, doneAt: r.doneAt })),
        shop: this.view(),
      },
    };
  }

  #deliverEntry(e: PoaEntry, receiver: Soldier): Json {
    const to = this.#deliver(e.object, e.owner, receiver, receiver);
    return { kind: e.kind, ...itemRef(this.#ctx, e.object), to };
  }

  #removeSources(sources: readonly (ObjectSource | null)[]): void {
    const ordered = sources
      .filter((x): x is ObjectSource => x !== null)
      .sort((a, b) => a.soldier - b.soldier || a.slot - b.slot || (b.index ?? -1) - (a.index ?? -1));
    for (const source of ordered) this.#removeSource(source);
  }

  #removeSource(source: ObjectSource | null): void {
    const t = this.#t;
    if (!source || !t) return;
    const o = t.soldiers[source.soldier]?.inv[source.slot];
    if (!o) return;
    if (source.amount !== null) {
      o.money -= source.amount;
      if (o.money <= 0) deleteObject(o);
    } else if (source.index !== null) removeObjectAt(o, source.index);
    else deleteObject(o);
  }

  view(): ShopView | null {
    const session = this.#session;
    const t = this.#t;
    if (!session || !t) return null;
    const ctx = this.#ctx;
    const d = dealerDef(ctx, session.dealer);
    const pricing = t.soldiers[session.pricing];
    const modifier = ctx.content.weaponSaleModifiers.get(pricing?.profile ?? NO_PROFILE) ?? 100;
    const canTrade = t.soldiers.filter((s): s is Soldier => !!s && s.team === Team.OUR && this.#canInteract(s)).map((s) => s.id);
    return {
      dealer: d.profile,
      name: t.soldiers[session.dealerSoldier]?.name ?? d.profileName,
      kind: shopKind(d.type),
      soldier: session.selected,
      pricing: { soldier: session.pricing, weaponSaleModifier: modifier },
      balance: this.#campaign.state.finances.balance,
      canTrade,
      boxes: session.boxes.map((b) => shopBoxView(ctx, session.dealer, b, modifier)),
    };
  }

  merchantLabel(profile: number): string | null {
    const ctx = this.#campaign.merchants;
    if (!ctx || !isMercADealer(ctx, profile)) return null;
    const d = ctx.content.dealers.find((x) => x.profile === profile);
    return d ? shopKind(d.type) : null;
  }
}
