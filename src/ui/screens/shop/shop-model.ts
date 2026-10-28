// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ShopKeeper_Interface.cc InitializeShopKeeper (ceil(boxes / 15) pages, the page reset after a
// @src transaction), ShopInventoryPageUp/Down, EnableDisableDealersInventoryPageButtons,
// @src SelectDealersInventoryRegionCallBackPrimary (one unit, SHIFT the rest, into one dealer's offer slot; the
// @src repairman's boxes ignore clicks), AddItemToArmsDealerOfferArea, SelectDealersOfferSlotsRegionCallBackPrimary (one
// @src unit back, SHIFT or the last one the whole slot), SelectPlayersOfferSlotsRegionCallBackPrimary (pick up, swap,
// @src drop), SelectPlayersOfferSlotsRegionCallBackSecondary (back to the owner), BeginSkiItemPointer (a pocket offered
// @src at once unless CTRL), OfferObjectToDealer, CrossOutUnwantedItems, EnableDisableEvaluateAndTransactionButtons (the
// @src enable rules in their order, the gift override), PerformTransaction (the deduction box, "not enough funds",
// @src "no room", the dealer's cash quote), ExitSKIRequested (the reminder, then the farewell), ResetAllQuoteSaidFlags.

import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { ShopBoxView, ShopView } from '../../../protocol/view.ts';
import { sprintMoney } from '../../text/money.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';

export const DEALER_SLOTS = 15;
export const OFFER_SLOTS = 12;
const REPAIR_KIND = 'repair';
const MONEY_CLASS_ITEM = 'MONEY';
const MAX_REQUOTES = OFFER_SLOTS + 2;

export const ShopQuoteId = {
  NOT_INTERESTED: 4,
  GIFT: 10,
  IDLE_1: 12,
  IDLE_2: 13,
  ITEMS_CHOSEN_TO_TRADE: 14,
  ITEMS_CHOSEN_TO_SELL_OR_REPAIR: 15,
  REQUESTED_EVALUATION: 16,
  STUFF_REJECTED: 17,
  VALUE_OF_ZERO: 18,
  REALLY_DAMAGED: 19,
  NORMAL_EVALUATION: 20,
  NOT_ENOUGH_VALUE: 21,
  EXACTLY_ENOUGH: 22,
  TOO_MUCH_MONEY: 23,
  STUFF_ON_TABLE: 26,
  CANT_AFFORD: 27,
  CAN_RESET_IMPRINTING: 31,
} as const;

const SKI_TEXT_NO_MORE_ROOM_IN_PLAYER_OFFER_AREA = 11;
const SKI_QUESTION_TO_DEDUCT_DIFFERENCE = 0;
const SKI_SHORT_FUNDS_TEXT = 1;
const SKI_QUESTION_TO_DEDUCT_COST = 2;
const NO_ROOM_REFUSALS: ReadonlySet<string> = new Set(['noRoomForPurchases', 'playerOfferAreaFull', 'dealerOfferAreaFull']);
const ENTRY_REFUSALS: ReadonlySet<string> = new Set(['wontBuy', 'worthless', 'notDamaged', 'wontRepair', 'tooManyToRepair']);

export type Evaluation = 'value' | 'reallyDamaged' | 'worthless' | 'rejected';

export interface QuoteRefusal {
  readonly reason: string;
  readonly entry?: number;
  readonly shortfall?: number;
  readonly amount?: number;
}

export interface QuoteBuy {
  readonly key: { readonly item: number; readonly element: number } | null;
  readonly item: string;
  readonly count: number;
  readonly price: number;
}

export interface QuoteSell {
  readonly soldier?: number;
  readonly slot?: number;
  readonly index?: number;
  readonly item: string;
  readonly evaluation: Evaluation;
  readonly value: number;
}

export interface QuoteRepair {
  readonly item: string;
  readonly owner: number;
  readonly cost: number;
  readonly minutes: number;
  readonly doneAt: number;
}

export interface QuotePoaEntry {
  readonly kind: 'money' | 'sold' | 'part';
  readonly item: string;
  readonly count: number;
  readonly status: number;
  readonly money?: number;
  readonly owner: number;
  readonly source?: { readonly soldier: number; readonly slot: number; readonly index?: number };
  readonly value: number;
}

export interface TradeQuote {
  readonly buy: readonly QuoteBuy[];
  readonly sell: readonly QuoteSell[];
  readonly repair: readonly QuoteRepair[];
  readonly cash: readonly { readonly amount: number }[];
  readonly totals: { readonly cost: number; readonly value: number; readonly cash: number };
  readonly gift: boolean;
  readonly change: number;
  readonly balanceNeeded: number;
  readonly refusal: QuoteRefusal | null;
  readonly quotes?: readonly number[];
  readonly poa?: readonly (QuotePoaEntry | null)[];
}

export interface DealerSelection {
  readonly kind: 'buy';
  readonly box: number;
  readonly key: { readonly item: number; readonly element: number };
  readonly item: string;
  count: number;
}

export interface PocketOffer {
  readonly kind: 'offer';
  readonly id: number;
  readonly soldier: number;
  readonly slot: number;
  readonly item: string;
  readonly cash: boolean;
  readonly amount: number | null;
}

export interface RepairedEntry {
  readonly kind: 'repaired';
  readonly id: number;
  readonly item: string;
  readonly status: number;
  readonly owner: number;
  readonly soldier: number | null;
}

export type PlayerSlot = PocketOffer | RepairedEntry;

export type HeldItem =
  | { readonly kind: 'pocket'; readonly soldier: number; readonly slot: number; readonly item: string }
  | { readonly kind: 'offer'; readonly offer: PocketOffer };

export interface CommandReplyLike {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export interface ShopModelHooks {
  readonly command: (cmd: CommandEnvelope) => Promise<CommandReplyLike>;
  readonly shop: () => ShopView | null;
  readonly isMoney: (item: string) => boolean;
  readonly text: UiTextService;
  readonly confirm: (text: string) => Promise<boolean>;
  readonly alert: (text: string) => Promise<void>;
  readonly speak: (quote: number) => boolean;
  readonly shutUp: () => void;
}

export interface EnableState {
  readonly transaction: boolean;
  readonly done: boolean;
}

export interface RepairedLike {
  readonly item: string;
  readonly status: number;
  readonly owner: number;
  readonly soldier: number | null;
}

function refusalOf(data: unknown): QuoteRefusal | null {
  if (typeof data !== 'object' || data === null) return null;
  return data as QuoteRefusal;
}

const EMPTY_TOTALS = { cost: 0, value: 0, cash: 0 } as const;

export function normalizeQuote(data: unknown): TradeQuote {
  const q = (typeof data === 'object' && data !== null ? data : {}) as Partial<TradeQuote>;
  return {
    buy: q.buy ?? [],
    sell: q.sell ?? [],
    repair: q.repair ?? [],
    cash: q.cash ?? [],
    totals: q.totals ?? EMPTY_TOTALS,
    gift: q.gift ?? false,
    change: q.change ?? 0,
    balanceNeeded: q.balanceNeeded ?? 0,
    refusal: q.refusal ?? null,
    quotes: q.quotes ?? [],
    poa: q.poa ?? [],
  };
}

function boxKey(key: { readonly item: number; readonly element: number }): string {
  return `${key.item}/${key.element}`;
}

export class ShopModel {
  readonly #hooks: ShopModelHooks;
  readonly dealerOffer: (DealerSelection | null)[] = Array.from({ length: OFFER_SLOTS }, () => null);
  readonly playerOffer: (PlayerSlot | null)[] = Array.from({ length: OFFER_SLOTS }, () => null);
  readonly #excluded = new Set<number>();
  readonly #dismissedRepairs = new Set<number>();
  #page = 1;
  #held: HeldItem | null = null;
  #quote: TradeQuote | null = null;
  #quoteSequence = 0;
  #nextId = 1;
  #busy = false;
  #reminded = false;
  #leaveRequested = false;
  #lastQuote: number | null = null;

  constructor(hooks: ShopModelHooks) {
    this.#hooks = hooks;
  }

  get page(): number {
    return this.pages === 0 ? 0 : Math.min(this.#page, this.pages);
  }

  get pages(): number {
    return Math.ceil(this.#boxes().length / DEALER_SLOTS);
  }

  get held(): HeldItem | null {
    return this.#held;
  }

  get quote(): TradeQuote | null {
    return this.#quote;
  }

  get busy(): boolean {
    return this.#busy;
  }

  get leaveRequested(): boolean {
    return this.#leaveRequested;
  }

  get reminded(): boolean {
    return this.#reminded;
  }

  get lastQuote(): number | null {
    return this.#lastQuote;
  }

  get repairs(): boolean {
    return this.#hooks.shop()?.kind === REPAIR_KIND;
  }

  #boxes(): readonly ShopBoxView[] {
    return this.#hooks.shop()?.boxes ?? [];
  }

  firstOnPage(): number {
    return Math.max(0, this.page - 1) * DEALER_SLOTS;
  }

  dealerBox(slot: number): { readonly box: ShopBoxView; readonly index: number } | null {
    const index = this.firstOnPage() + slot;
    const box = this.#boxes()[index];
    return box ? { box, index } : null;
  }

  takenFrom(boxIndex: number): number {
    return this.dealerOffer.reduce((n, s) => n + (s && s.box === boxIndex ? s.count : 0), 0);
  }

  left(boxIndex: number): number {
    const box = this.#boxes()[boxIndex];
    return box ? box.count - this.takenFrom(boxIndex) : 0;
  }

  selected(boxIndex: number): boolean {
    return this.dealerOffer.some((s) => s?.box === boxIndex);
  }

  excluded(offer: PocketOffer): boolean {
    return this.#excluded.has(offer.id);
  }

  pageUp(): void {
    if (this.#page > 1) this.#page--;
  }

  pageDown(): void {
    if (this.#page < this.pages) this.#page++;
  }

  pageUpEnabled(): boolean {
    return this.pages > 0 && this.page > 1;
  }

  pageDownEnabled(): boolean {
    return this.pages > 0 && this.page !== this.pages;
  }

  syncRepaired(entries: readonly RepairedLike[]): void {
    const shown = this.playerOffer.filter((s): s is RepairedEntry => s?.kind === 'repaired');
    entries.forEach((entry, k) => {
      if (this.#dismissedRepairs.has(k) || shown.some((s) => s.id === -(k + 1))) return;
      const free = this.playerOffer.indexOf(null);
      if (free < 0) return;
      this.playerOffer[free] = { kind: 'repaired', id: -(k + 1), ...entry };
    });
  }

  dealerClick(slot: number, shift: boolean): boolean {
    if (this.#held || this.repairs) return false;
    const found = this.dealerBox(slot);
    if (!found) return false;
    const left = this.left(found.index);
    if (left <= 0) return false;
    const existing = this.dealerOffer.find((s) => s?.box === found.index);
    const units = shift ? left : 1;
    if (existing) {
      existing.count += units;
    } else {
      const free = this.dealerOffer.indexOf(null);
      if (free < 0) return false;
      this.dealerOffer[free] = { kind: 'buy', box: found.index, key: found.box.key, item: found.box.item, count: units };
    }
    void this.requote(false);
    return true;
  }

  dealerOfferClick(slot: number, shift: boolean): boolean {
    if (this.repairs) return false;
    const selection = this.dealerOffer[slot];
    if (!selection) return false;
    if (shift || selection.count <= 1) this.dealerOffer[slot] = null;
    else selection.count--;
    void this.requote(false);
    return true;
  }

  offered(soldier: number, slot: number): boolean {
    if (this.#held?.kind === 'pocket' && this.#held.soldier === soldier && this.#held.slot === slot) return true;
    if (this.#held?.kind === 'offer' && this.#held.offer.soldier === soldier && this.#held.offer.slot === slot) return true;
    return this.playerOffer.some((s) => s?.kind === 'offer' && s.soldier === soldier && s.slot === slot);
  }

  pocketClick(soldier: number, slot: number, item: string | null, ctrl: boolean): boolean {
    const held = this.#held;
    if (held) {
      if (held.kind === 'pocket' && held.soldier === soldier && held.slot === slot) {
        this.#held = null;
        return true;
      }
      if (held.kind === 'offer' && held.offer.soldier === soldier && held.offer.slot === slot) {
        this.#held = null;
        void this.requote(false);
        return true;
      }
      return false;
    }
    if (!item || this.offered(soldier, slot)) return false;
    if (ctrl) {
      this.#held = { kind: 'pocket', soldier, slot, item };
      return true;
    }
    return this.#offer(this.#newOffer(soldier, slot, item, null), null);
  }

  offerCash(soldier: number, slot: number, item: string, amount: number | null): boolean {
    if (this.offered(soldier, slot)) return false;
    return this.#offer({ kind: 'offer', id: this.#nextId++, soldier, slot, item, cash: true, amount }, null);
  }

  #newOffer(soldier: number, slot: number, item: string, amount: number | null): PocketOffer {
    return { kind: 'offer', id: this.#nextId++, soldier, slot, item, cash: this.#hooks.isMoney(item), amount };
  }

  #offer(offer: PocketOffer, at: number | null): boolean {
    const free = at ?? this.playerOffer.indexOf(null);
    if (free < 0 || this.playerOffer[free]) {
      void this.#hooks.alert(this.#hooks.text.string('SKI_Text', SKI_TEXT_NO_MORE_ROOM_IN_PLAYER_OFFER_AREA) ?? '');
      return false;
    }
    this.playerOffer[free] = offer;
    void this.requote(true);
    return true;
  }

  playerOfferClick(slot: number): boolean {
    const held = this.#held;
    const occupant = this.playerOffer[slot] ?? null;
    if (!held) {
      if (occupant?.kind !== 'offer') {
        if (occupant?.kind === 'repaired') this.#dismissRepaired(slot, occupant);
        return occupant !== null;
      }
      this.playerOffer[slot] = null;
      this.#held = { kind: 'offer', offer: occupant };
      void this.requote(false);
      return true;
    }
    const placed = held.kind === 'offer' ? held.offer : this.#newOffer(held.soldier, held.slot, held.item, null);
    if (occupant?.kind === 'repaired') return false;
    this.playerOffer[slot] = placed;
    this.#held = occupant ? { kind: 'offer', offer: occupant } : null;
    void this.requote(held.kind === 'pocket');
    return true;
  }

  playerOfferSecondary(slot: number): boolean {
    const occupant = this.playerOffer[slot];
    if (!occupant) return false;
    if (occupant.kind === 'repaired') {
      this.#dismissRepaired(slot, occupant);
      return true;
    }
    this.playerOffer[slot] = null;
    this.#excluded.delete(occupant.id);
    void this.requote(false);
    return true;
  }

  #dismissRepaired(slot: number, entry: RepairedEntry): void {
    this.#dismissedRepairs.add(-entry.id - 1);
    this.playerOffer[slot] = null;
  }

  cancelHeld(): boolean {
    const held = this.#held;
    if (!held) return false;
    this.#held = null;
    if (held.kind === 'offer') void this.requote(false);
    return true;
  }

  #offers(): PocketOffer[] {
    return this.playerOffer.filter((s): s is PocketOffer => s?.kind === 'offer');
  }

  #requestOffers(): { readonly items: PocketOffer[]; readonly cash: PocketOffer[] } {
    const offers = this.#offers().filter((o) => !this.#excluded.has(o.id));
    return { items: offers.filter((o) => !o.cash), cash: offers.filter((o) => o.cash) };
  }

  request(extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    const buys = new Map<string, { item: number; element: number; count: number }>();
    for (const s of this.dealerOffer) {
      if (!s) continue;
      const k = boxKey(s.key);
      const found = buys.get(k);
      if (found) found.count += s.count;
      else buys.set(k, { item: s.key.item, element: s.key.element, count: s.count });
    }
    const { items, cash } = this.#requestOffers();
    const pockets = items.map((o) => ({ soldier: o.soldier, slot: o.slot }));
    return {
      buy: [...buys.values()],
      [this.repairs ? 'repair' : 'sell']: pockets,
      cash: cash.map((o) => ({ soldier: o.soldier, slot: o.slot, ...(o.amount !== null ? { amount: o.amount } : {}) })),
      ...extra,
    };
  }

  async requote(evaluating: boolean): Promise<TradeQuote | null> {
    const sequence = ++this.#quoteSequence;
    for (let round = 0; round < MAX_REQUOTES; round++) {
      const reply = await this.#hooks.command({ type: 'quoteTrade', ...this.request() });
      if (sequence !== this.#quoteSequence) return null;
      if (!reply.ok) {
        this.#quote = null;
        return null;
      }
      const quote = normalizeQuote(reply.data);
      if (!this.#excludeRefused(quote)) {
        this.#quote = quote;
        if (evaluating) this.#evaluationQuote(quote);
        if (this.#offers().length === 0) this.#resetQuoteFlags();
        return quote;
      }
    }
    return this.#quote;
  }

  #excludeRefused(quote: TradeQuote): boolean {
    const { items } = this.#requestOffers();
    let changed = false;
    quote.sell.forEach((s, k) => {
      const offer = items[k];
      if (offer && (s.evaluation === 'rejected' || s.evaluation === 'worthless')) {
        this.#excluded.add(offer.id);
        changed = true;
      }
    });
    if (changed) return true;
    const refusal = quote.refusal;
    if (refusal && refusal.entry !== undefined && ENTRY_REFUSALS.has(refusal.reason)) {
      const offer = items[refusal.entry];
      if (offer) {
        this.#excluded.add(offer.id);
        return true;
      }
    }
    return false;
  }

  readonly #evalQuotesSaid = new Set<number>();
  #evaluationSaidThisSession = false;
  #lastNormalEvaluationAt: number | null = null;

  #resetQuoteFlags(): void {
    this.#evalQuotesSaid.clear();
    this.#lastNormalEvaluationAt = null;
    this.#reminded = false;
  }

  evaluationChance: (elapsed: number | null) => boolean = () => false;
  clock: () => number = () => 0;

  #evaluationQuote(quote: TradeQuote): void {
    const ids = quote.quotes ?? [];
    if (!this.#evaluationSaidThisSession && ids.includes(ShopQuoteId.REQUESTED_EVALUATION)) {
      this.#evaluationSaidThisSession = true;
      this.#say(ShopQuoteId.REQUESTED_EVALUATION);
    }
    const result = ids.find(
      (q) =>
        q === ShopQuoteId.NOT_INTERESTED ||
        q === ShopQuoteId.STUFF_REJECTED ||
        q === ShopQuoteId.VALUE_OF_ZERO ||
        q === ShopQuoteId.REALLY_DAMAGED ||
        q === ShopQuoteId.CAN_RESET_IMPRINTING,
    );
    if (result !== undefined) {
      if (this.#evalQuotesSaid.has(result)) return;
      if (this.#say(result)) this.#evalQuotesSaid.add(result);
      return;
    }
    if (!quote.sell.some((s) => s.evaluation === 'value') || this.#evalQuotesSaid.has(ShopQuoteId.NORMAL_EVALUATION)) return;
    const now = this.clock();
    const elapsed = this.#lastNormalEvaluationAt === null ? null : now - this.#lastNormalEvaluationAt;
    if (!this.evaluationChance(elapsed)) return;
    if (this.#say(ShopQuoteId.NORMAL_EVALUATION)) {
      this.#evalQuotesSaid.add(ShopQuoteId.NORMAL_EVALUATION);
      this.#lastNormalEvaluationAt = now;
    }
  }

  #say(quote: number): boolean {
    if (this.#reminded || this.#leaveRequested) return false;
    const said = this.#hooks.speak(quote);
    if (said) this.#lastQuote = quote;
    return said;
  }

  speakCosmetic(quote: number): boolean {
    return this.#say(quote);
  }

  activeSlots(): number {
    return this.playerOffer.filter((s) => s !== null).length;
  }

  #hasValue(offer: PocketOffer, index: number, quote: TradeQuote): boolean {
    if (offer.cash) return true;
    const sell = quote.sell[index];
    return sell !== undefined && sell.value > 0;
  }

  enableState(): EnableState {
    const quote = this.#quote;
    const shop = this.#hooks.shop();
    const cost = quote?.totals.cost ?? 0;
    const value = quote?.totals.value ?? 0;
    const money = quote?.totals.cash ?? 0;
    const balance = shop?.balance ?? 0;
    const repairs = this.repairs;
    const { items } = this.#requestOffers();
    let evaluated = false;
    if (quote) {
      items.forEach((o, k) => {
        if (this.#hasValue(o, k, quote)) evaluated = true;
      });
      if (!repairs && money > 0) evaluated = true;
      if (repairs && quote.repair.length > 0) evaluated = true;
    }
    const doaCount = repairs ? (quote?.repair.length ?? 0) : this.dealerOffer.filter((s) => s !== null).length;
    let transaction = evaluated ? !(repairs && doaCount === 0 && money < cost) : cost !== 0;
    if (cost > value + balance) transaction = false;
    else if (value === money && money > 0 && cost === 0) transaction = false;
    let done = true;
    if (this.#held) {
      transaction = false;
      done = false;
    }
    if (this.moneyOnly() && doaCount === 0) transaction = true;
    if (this.#leaveRequested || this.#busy) transaction = false;
    return { transaction, done };
  }

  moneyOnly(): boolean {
    let money = false;
    for (const s of this.playerOffer) {
      if (!s) continue;
      if (s.kind !== 'offer' || !s.cash) return false;
      money = true;
    }
    return money;
  }

  async transaction(): Promise<boolean> {
    if (this.#busy || !this.enableState().transaction) return false;
    this.#hooks.shutUp();
    this.#busy = true;
    try {
      return await this.#trade(false);
    } finally {
      this.#busy = false;
    }
  }

  async #trade(useBalance: boolean): Promise<boolean> {
    const reply = await this.#hooks.command({ type: 'trade', ...this.request(useBalance ? { useBalance: true } : {}) });
    if (reply.ok) {
      this.#afterTrade();
      return true;
    }
    const refusal = refusalOf(reply.data);
    const reason = refusal?.reason ?? reply.reason?.split(':')[0] ?? '';
    const text = this.#hooks.text;
    if (reason === 'needBalance') {
      const amount = refusal?.amount ?? this.#quote?.balanceNeeded ?? 0;
      const index = (this.#quote?.totals.value ?? 0) > 0 ? SKI_QUESTION_TO_DEDUCT_DIFFERENCE : SKI_QUESTION_TO_DEDUCT_COST;
      const yes = await this.#hooks.confirm(printf(text.string('SkiMessageBoxText', index) ?? '', [sprintMoney(amount)]));
      return yes ? this.#trade(true) : false;
    }
    if (reason === 'cannotAfford') {
      await this.#hooks.alert(printf(text.string('SkiMessageBoxText', SKI_SHORT_FUNDS_TEXT) ?? '', [sprintMoney(refusal?.shortfall ?? 0)]));
      return false;
    }
    if (NO_ROOM_REFUSALS.has(reason)) {
      await this.#hooks.alert(text.string('SKI_Text', SKI_TEXT_NO_MORE_ROOM_IN_PLAYER_OFFER_AREA) ?? '');
      return false;
    }
    if (reason === 'dealerCannotAfford') this.#hooks.speak(ShopQuoteId.CANT_AFFORD);
    return false;
  }

  #afterTrade(): void {
    const { items, cash } = this.#requestOffers();
    const traded = new Set([...items, ...cash].map((o) => o.id));
    for (let k = 0; k < OFFER_SLOTS; k++) {
      const s = this.playerOffer[k];
      if (s?.kind === 'offer' && traded.has(s.id)) this.playerOffer[k] = null;
      this.dealerOffer[k] = null;
    }
    this.#page = 1;
    void this.requote(false);
  }

  async done(): Promise<'reminded' | 'leaving' | 'ignored'> {
    this.#hooks.shutUp();
    if (!this.#reminded) {
      const stuff = this.activeSlots() > 0 || (this.repairs && (this.#quote?.repair.length ?? 0) > 0);
      if (stuff) {
        this.#hooks.speak(ShopQuoteId.STUFF_ON_TABLE);
        this.#lastQuote = ShopQuoteId.STUFF_ON_TABLE;
        this.#reminded = true;
        return 'reminded';
      }
      if (this.#leaveRequested) return 'ignored';
    }
    if (this.#leaveRequested) return 'ignored';
    this.#leaveRequested = true;
    const reply = await this.#hooks.command({ type: 'closeShop' });
    if (!reply.ok) this.#leaveRequested = false;
    return reply.ok ? 'leaving' : 'ignored';
  }

  async setPricing(soldier: number): Promise<boolean> {
    const shop = this.#hooks.shop();
    if (!shop || shop.pricing.soldier === soldier) return false;
    const reply = await this.#hooks.command({ type: 'setShopPricing', soldier });
    if (reply.ok) void this.requote(false);
    return reply.ok;
  }

  idleQuoteCandidates(): readonly number[] {
    const quote = this.#quote;
    const value = quote?.totals.value ?? 0;
    const money = quote?.totals.cash ?? 0;
    const doa = this.repairs ? (quote?.repair.length ?? 0) : this.dealerOffer.filter((s) => s !== null).length;
    if (this.repairs) return doa > 0 ? [ShopQuoteId.ITEMS_CHOSEN_TO_SELL_OR_REPAIR] : [];
    if (value - money > 0) return [doa > 0 ? ShopQuoteId.ITEMS_CHOSEN_TO_TRADE : ShopQuoteId.ITEMS_CHOSEN_TO_SELL_OR_REPAIR];
    return [];
  }

  notEnoughOnTheTable(): boolean {
    const quote = this.#quote;
    const value = quote?.totals.value ?? 0;
    return (quote?.totals.cost ?? 0) > value && value > 0;
  }

  offerEvaluation(slot: number): QuoteSell | null {
    const occupant = this.playerOffer[slot];
    const quote = this.#quote;
    if (occupant?.kind !== 'offer' || occupant.cash || !quote || this.#excluded.has(occupant.id)) return null;
    const index = this.#requestOffers().items.findIndex((o) => o.id === occupant.id);
    return index < 0 ? null : (quote.sell[index] ?? null);
  }

  offerValue(slot: number): number {
    const occupant = this.playerOffer[slot];
    if (occupant?.kind !== 'offer') return 0;
    if (occupant.cash) return occupant.amount ?? -1;
    return this.offerEvaluation(slot)?.value ?? 0;
  }

  crossedOut(slot: number): boolean {
    const occupant = this.playerOffer[slot];
    if (occupant?.kind !== 'offer' || occupant.cash) return false;
    if (this.#excluded.has(occupant.id)) return true;
    if (this.repairs) return false;
    const evaluation = this.offerEvaluation(slot);
    return evaluation !== null && evaluation.value === 0;
  }

  dealerOfferPrice(slot: number): number {
    const selection = this.dealerOffer[slot];
    const quote = this.#quote;
    if (!selection || !quote) return 0;
    const buys = quote.buy.filter((b) => b.key !== null && boxKey(b.key) === boxKey(selection.key));
    if (buys.length === 0) return 0;
    const sameKey = this.dealerOffer.filter((s): s is DealerSelection => s !== null && boxKey(s.key) === boxKey(selection.key));
    const position = sameKey.indexOf(selection);
    if (buys.length === sameKey.reduce((n, s) => n + s.count, 0)) {
      const before = sameKey.slice(0, position).reduce((n, s) => n + s.count, 0);
      return buys.slice(before, before + selection.count).reduce((n, b) => n + b.price, 0);
    }
    return buys[position]?.price ?? buys[0]?.price ?? 0;
  }

  static isMoneyItem(item: string): boolean {
    return item === MONEY_CLASS_ITEM;
  }
}
