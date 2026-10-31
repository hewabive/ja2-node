import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { ShopBoxView, ShopView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { type CommandReplyLike, ShopModel, ShopQuoteId, type TradeQuote } from './shop-model.ts';

const TEXT: Readonly<Record<string, readonly string[]>> = {
  SKI_Text: ['', '', '', '', '', '', '', '', '', '', '', 'There is not enough room in your offer area.'],
  SkiMessageBoxText: ['Deduct %s to cover the difference?', 'You are short %s', 'Deduct %s to cover the cost?'],
};

const text: UiTextService = { string: (table, index) => TEXT[table]?.[index] ?? null, edt: () => null };

function box(item: string, index: number, count = 1, unitPrice = 100): ShopBoxView {
  return { key: { item: index, element: -1 }, item, count, status: 100, unitPrice, attachments: [], imprinted: false };
}

function shopView(boxes: readonly ShopBoxView[], extra: Partial<ShopView> = {}): ShopView {
  return {
    dealer: 91,
    name: 'Okonjo',
    kind: 'buySell',
    soldier: 0,
    pricing: { soldier: 0, weaponSaleModifier: 100 },
    balance: 1000,
    canTrade: [0, 1],
    boxes,
    repaired: [],
    ...extra,
  } as ShopView;
}

function quote(over: Partial<TradeQuote> = {}): TradeQuote {
  return {
    buy: [],
    sell: [],
    repair: [],
    cash: [],
    totals: { cost: 0, value: 0, cash: 0 },
    gift: false,
    change: 0,
    balanceNeeded: 0,
    refusal: null,
    quotes: [],
    poa: [],
    ...over,
  };
}

interface Fixture {
  readonly model: ShopModel;
  readonly sent: CommandEnvelope[];
  readonly said: number[];
  readonly boxes: string[];
  answers: (cmd: CommandEnvelope) => CommandReplyLike;
  confirmAnswer: boolean;
  shop: ShopView;
}

function fixture(shop: ShopView): Fixture {
  const f: Fixture = {
    sent: [],
    said: [],
    boxes: [],
    answers: () => ({ ok: true, data: quote() }),
    confirmAnswer: true,
    shop,
    model: null as unknown as ShopModel,
  };
  const model = new ShopModel({
    command: async (cmd) => {
      f.sent.push(cmd);
      return f.answers(cmd);
    },
    shop: () => f.shop,
    isMoney: (item) => item === 'MONEY',
    text,
    confirm: async (t) => {
      f.boxes.push(t);
      return f.confirmAnswer;
    },
    alert: async (t) => {
      f.boxes.push(t);
    },
    speak: (q) => {
      f.said.push(q);
      return true;
    },
    shutUp: () => undefined,
  });
  return Object.assign(f, { model });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ShopModel', () => {
  it('pages the dealer boxes fifteen at a time and moves units into one dealer offer slot per box', async () => {
    const boxes = Array.from({ length: 16 }, (_, k) => box(`ITEM${k}`, k, k === 0 ? 5 : 1));
    const f = fixture(shopView(boxes));
    expect(f.model.pages).toBe(2);
    expect(f.model.page).toBe(1);
    expect(f.model.pageUpEnabled()).toBe(false);
    expect(f.model.pageDownEnabled()).toBe(true);
    f.model.pageDown();
    expect(f.model.page).toBe(2);
    expect(f.model.dealerBox(0)?.box.item).toBe('ITEM15');
    f.model.pageUp();
    expect(f.model.dealerClick(0, false)).toBe(true);
    expect(f.model.dealerClick(0, false)).toBe(true);
    expect(f.model.dealerOffer[0]).toMatchObject({ item: 'ITEM0', count: 2 });
    expect(f.model.left(0)).toBe(3);
    f.model.dealerClick(0, true);
    expect(f.model.left(0)).toBe(0);
    expect(f.model.dealerClick(0, false)).toBe(false);
    f.model.dealerClick(1, false);
    expect(f.model.request()).toEqual({
      buy: [
        { item: 0, element: -1, count: 5 },
        { item: 1, element: -1, count: 1 },
      ],
      sell: [],
      cash: [],
    });
    f.model.dealerOfferClick(0, false);
    expect(f.model.dealerOffer[0]?.count).toBe(4);
    f.model.dealerOfferClick(0, true);
    expect(f.model.dealerOffer[0]).toBeNull();
    await settle();
    expect(f.sent.at(-1)?.type).toBe('quoteTrade');
  });

  it('aggregates perfect boxes of one key into one buy entry', () => {
    const f = fixture(shopView([box('GLOCK_17', 7), box('GLOCK_17', 7)]));
    f.model.dealerClick(0, false);
    f.model.dealerClick(1, false);
    expect(f.model.request().buy).toEqual([{ item: 7, element: -1, count: 2 }]);
  });

  it('offers a pocket at once, a money pocket as cash, picks with Ctrl and hatches the offered pockets', async () => {
    const f = fixture(shopView([box('GLOCK_17', 7)]));
    expect(f.model.pocketClick(0, 7, 'CLIP9_15', false)).toBe(true);
    expect(f.model.pocketClick(0, 12, 'MONEY', false)).toBe(true);
    expect(f.model.offered(0, 7)).toBe(true);
    expect(f.model.request()).toMatchObject({ sell: [{ soldier: 0, slot: 7 }], cash: [{ soldier: 0, slot: 12 }] });
    expect(f.model.pocketClick(0, 9, 'BANDAGE', true)).toBe(true);
    expect(f.model.held).toMatchObject({ kind: 'pocket', slot: 9 });
    expect(f.model.enableState()).toEqual({ transaction: false, done: false });
    expect(f.model.playerOfferClick(5)).toBe(true);
    expect(f.model.playerOffer[5]).toMatchObject({ slot: 9 });
    expect(f.model.held).toBeNull();
    expect(f.model.offerCash(1, 13, 'MONEY', 50)).toBe(true);
    expect(f.model.request().cash).toEqual([
      { soldier: 0, slot: 12 },
      { soldier: 1, slot: 13, amount: 50 },
    ]);
    f.model.playerOfferSecondary(0);
    expect(f.model.offered(0, 7)).toBe(false);
    await settle();
  });

  it('crosses out what the dealer rejects and leaves it out of the next quote and the trade', async () => {
    const f = fixture(shopView([box('GLOCK_17', 7)]));
    f.answers = (cmd) => {
      const sells = (cmd.sell as { slot: number }[] | undefined) ?? [];
      const rock = (s: { slot: number }) => s.slot === 8;
      return {
        ok: true,
        data: quote({
          sell: sells.map((s) => ({
            item: rock(s) ? 'ROCK' : 'CLIP9_15',
            evaluation: rock(s) ? 'rejected' : 'value',
            value: rock(s) ? 0 : 40,
          })),
          totals: { cost: 0, value: sells.some((s) => !rock(s)) ? 40 : 0, cash: 0 },
          quotes: [ShopQuoteId.REQUESTED_EVALUATION, ShopQuoteId.STUFF_REJECTED],
        }),
      };
    };
    f.model.pocketClick(0, 8, 'ROCK', false);
    await settle();
    f.model.pocketClick(0, 7, 'CLIP9_15', false);
    await settle();
    await settle();
    expect(f.model.crossedOut(0)).toBe(true);
    expect(f.model.crossedOut(1)).toBe(false);
    expect(f.model.request().sell).toEqual([{ soldier: 0, slot: 7 }]);
    expect(f.said.slice(0, 2)).toEqual([ShopQuoteId.REQUESTED_EVALUATION, ShopQuoteId.STUFF_REJECTED]);
  });

  it('follows the enable rules: cost over value and balance, money alone, the gift override and the held item', async () => {
    const f = fixture(shopView([box('GLOCK_17', 7)], { balance: 100 }));
    f.answers = () => ({
      ok: true,
      data: quote({
        buy: [{ key: { item: 7, element: -1 }, item: 'GLOCK_17', count: 1, price: 500 }],
        totals: { cost: 500, value: 0, cash: 0 },
      }),
    });
    f.model.dealerClick(0, false);
    await settle();
    expect(f.model.enableState().transaction).toBe(false);
    f.shop = shopView([box('GLOCK_17', 7)], { balance: 1000 });
    expect(f.model.enableState().transaction).toBe(true);
    f.model.dealerOfferClick(0, true);
    f.answers = () => ({ ok: true, data: quote({ cash: [{ amount: 30 }], totals: { cost: 0, value: 30, cash: 30 }, gift: true }) });
    f.model.offerCash(0, 12, 'MONEY', 30);
    await settle();
    expect(f.model.moneyOnly()).toBe(true);
    expect(f.model.enableState().transaction).toBe(true);
  });

  it('asks before paying from the balance, retries with useBalance, then clears the table and resets the page', async () => {
    const boxes = Array.from({ length: 20 }, (_, k) => box(`ITEM${k}`, k));
    const f = fixture(shopView(boxes));
    f.model.pageDown();
    f.model.dealerClick(0, false);
    await settle();
    f.answers = (cmd) => {
      if (cmd.type === 'quoteTrade')
        return {
          ok: true,
          data: quote({
            buy: [{ key: { item: 15, element: -1 }, item: 'ITEM15', count: 1, price: 100 }],
            totals: { cost: 100, value: 0, cash: 0 },
            balanceNeeded: 100,
          }),
        };
      if (cmd.useBalance) return { ok: true, data: {} };
      return { ok: false, reason: 'the offer does not cover the cost', data: { refusal: 'needBalance', amount: 100 } };
    };
    await f.model.requote(false);
    expect(await f.model.transaction()).toBe(true);
    expect(f.boxes).toEqual(['Deduct $100 to cover the cost?']);
    expect(f.sent.filter((c) => c.type === 'trade').map((c) => c.useBalance === true)).toEqual([false, true]);
    expect(f.model.dealerOffer.every((s) => s === null)).toBe(true);
    expect(f.model.page).toBe(1);
  });

  it('maps the refusals to the original boxes and the dealer cash quote', async () => {
    const f = fixture(shopView([box('GLOCK_17', 7)]));
    f.model.dealerClick(0, false);
    f.answers = (cmd) =>
      cmd.type === 'quoteTrade'
        ? {
            ok: true,
            data: quote({
              buy: [{ key: { item: 7, element: -1 }, item: 'GLOCK_17', count: 1, price: 100 }],
              totals: { cost: 100, value: 0, cash: 0 },
            }),
          }
        : { ok: false, reason: 'the balance and the offer do not cover the cost', data: { refusal: 'cannotAfford', shortfall: 25 } };
    await f.model.requote(false);
    expect(await f.model.transaction()).toBe(false);
    expect(f.boxes.at(-1)).toBe('You are short $25');
    f.answers = (cmd) =>
      cmd.type === 'quoteTrade'
        ? {
            ok: true,
            data: quote({
              buy: [{ key: { item: 7, element: -1 }, item: 'GLOCK_17', count: 1, price: 100 }],
              totals: { cost: 100, value: 0, cash: 0 },
            }),
          }
        : { ok: false, reason: 'the dealer has not the cash', data: { refusal: 'dealerCannotAfford' } };
    expect(await f.model.transaction()).toBe(false);
    expect(f.said.at(-1)).toBe(ShopQuoteId.CANT_AFFORD);
    f.answers = (cmd) =>
      cmd.type === 'quoteTrade'
        ? {
            ok: true,
            data: quote({
              buy: [{ key: { item: 7, element: -1 }, item: 'GLOCK_17', count: 1, price: 100 }],
              totals: { cost: 100, value: 0, cash: 0 },
            }),
          }
        : { ok: false, reason: 'no room for the purchases', data: { refusal: 'noRoomForPurchases' } };
    expect(await f.model.transaction()).toBe(false);
    expect(f.boxes.at(-1)).toBe('There is not enough room in your offer area.');
  });

  it('reminds once about the things on the table, then leaves with closeShop', async () => {
    const f = fixture(shopView([box('GLOCK_17', 7)]));
    f.model.pocketClick(0, 7, 'CLIP9_15', false);
    await settle();
    expect(await f.model.done()).toBe('reminded');
    expect(f.said).toContain(ShopQuoteId.STUFF_ON_TABLE);
    expect(f.sent.some((c) => c.type === 'closeShop')).toBe(false);
    expect(await f.model.done()).toBe('leaving');
    expect(f.sent.at(-1)).toEqual({ type: 'closeShop' });
    expect(f.model.leaveRequested).toBe(true);
    expect(f.model.enableState().transaction).toBe(false);
  });

  it('shows the repairs collected on entry as REPAIRED entries and asks for the pricing merc', async () => {
    const f = fixture(
      shopView([], { kind: 'repair', repaired: [{ item: 'GLOCK_17', status: 100, owner: 4, soldier: 0 }] } as Partial<ShopView>),
    );
    f.model.syncRepaired(f.shop.repaired);
    f.model.syncRepaired(f.shop.repaired);
    expect(f.model.playerOffer.filter((s) => s?.kind === 'repaired')).toHaveLength(1);
    expect(f.model.repairs).toBe(true);
    f.model.playerOfferSecondary(0);
    f.model.syncRepaired(f.shop.repaired);
    expect(f.model.playerOffer.every((s) => s === null)).toBe(true);
    f.answers = (cmd) =>
      cmd.type === 'setShopPricing'
        ? { ok: false, reason: 'not a pricing merc', data: { refusal: 'noSuchPricingMerc' } }
        : { ok: true, data: quote() };
    expect(await f.model.setPricing(1)).toBe(false);
    f.answers = () => ({ ok: true, data: { shop: f.shop } });
    expect(await f.model.setPricing(1)).toBe(true);
    expect(f.sent.filter((c) => c.type === 'setShopPricing').at(-1)).toEqual({ type: 'setShopPricing', soldier: 1 });
  });
});
