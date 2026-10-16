import { beforeAll, describe, expect, it } from 'vitest';
import { itemId, loadMerchantTestContent, type MerchantTestContent, merchantFixture } from '../../../../../tests/support/merchants.ts';
import { createItem, createMoney, type ItemObject, NO_PROFILE } from '../../../items/object.ts';
import { determineArmsDealersSellingInventory } from './boxes.ts';
import { MerchantFact } from './context.ts';
import { FRANZ_HAS_SOLD_VIDEO_CAMERA } from './daily.ts';
import { addItemToArmsDealerInventory } from './inventory.ts';
import { giveObjectToArmsDealerForRepair } from './repair.ts';
import { defaultItemInfo, header } from './state.ts';
import { executeTrade, type PlayerObject, planTrade, ShopQuote, type TradeInput } from './trade.ts';

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

const TONY = 0;
const FRANZ = 1;
const KEITH = 2;
const JAKE = 3;
const HOWARD = 6;
const FRANK = 8;
const MICKY = 13;
const PERKO = 16;
const IVAN = 7;
const DAY = 1440;

let slot = 0;

function offer(object: ItemObject): PlayerObject {
  return { object, owner: IVAN, source: { soldier: 0, slot: slot++, index: null, amount: null } };
}

function cash(amount: number): PlayerObject {
  return offer(createMoney(t.items, amount));
}

function input(dealer: number, parts: Partial<TradeInput>): TradeInput {
  return {
    dealer,
    pricingProfile: IVAN,
    weaponSaleModifier: 100,
    balance: 0,
    useBalance: false,
    buy: [],
    sell: [],
    cash: [],
    repair: [],
    ...parts,
  };
}

const item = (name: string, status = 100) => createItem(t.items, itemId(t, name), status);

describe('shop transactions', () => {
  it('keeps money given to gift-taking dealers and sets Frank’s bribe fact from $10', () => {
    const f = merchantFixture(t);
    const plan = planTrade(f.ctx, input(FRANK, { cash: [cash(10)] }));
    expect(plan).toMatchObject({ gift: true, refusal: null });
    expect(plan.quotes).toContain(ShopQuote.GIFT);
    const outcome = executeTrade(f.ctx, plan);
    expect(outcome.giftAccepted).toBe(true);
    expect(f.ctx.state.dealers[FRANK]?.status.cash).toBe(10);
    expect(f.setFacts).toEqual([MerchantFact.FRANK_HAS_BEEN_BRIBED]);
    const refused = executeTrade(f.ctx, planTrade(f.ctx, input(TONY, { cash: [cash(500)] })));
    expect(refused).toMatchObject({ giftAccepted: false, taken: [] });
    expect(f.ctx.state.dealers[TONY]?.status.cash).toBe(0);
  });

  it('buys a box with cash, gives change and removes the units from the dealer', () => {
    const f = merchantFixture(t);
    const clip = itemId(t, 'CLIP9_15');
    addItemToArmsDealerInventory(f.ctx, TONY, clip, defaultItemInfo(), 10);
    const status = f.ctx.state.dealers[TONY]?.status;
    if (status) status.cash = 1000;
    const boxes = determineArmsDealersSellingInventory(f.ctx, TONY, () => true);
    const plan = planTrade(f.ctx, input(TONY, { buy: [{ boxes, count: 9 }], cash: [cash(500)] }));
    expect(plan).toMatchObject({ cost: 9 * 18, value: 500, change: 500 - 162, refusal: null });
    const outcome = executeTrade(f.ctx, plan);
    expect(outcome.delivered.map((e) => [e.kind, e.object.count, e.object.money])).toEqual([
      ['purchase', 9, 0],
      ['change', 1, 338],
    ]);
    expect(header(f.ctx.state, TONY, clip).total).toBe(1);
    expect(status?.cash).toBe(1000 + 500 - 338);
  });

  it('asks for the balance, then takes the shortfall from it', () => {
    const f = merchantFixture(t);
    addItemToArmsDealerInventory(f.ctx, TONY, itemId(t, 'GLOCK_17'), defaultItemInfo(), 1);
    const boxes = determineArmsDealersSellingInventory(f.ctx, TONY, () => true);
    const buy = [{ boxes, count: 1 }];
    expect(planTrade(f.ctx, input(TONY, { buy, cash: [cash(100)], balance: 100 })).refusal).toEqual({
      reason: 'cannotAfford',
      shortfall: 237,
    });
    expect(planTrade(f.ctx, input(TONY, { buy, cash: [cash(100)], balance: 1000 })).refusal).toEqual({
      reason: 'needBalance',
      amount: 337,
    });
    const plan = planTrade(f.ctx, input(TONY, { buy, cash: [cash(100)], balance: 1000, useBalance: true }));
    expect(plan).toMatchObject({ fromBalance: 337, change: 0, refusal: null });
    executeTrade(f.ctx, plan);
    expect(f.ctx.state.dealers[TONY]?.status.cash).toBe(437);
  });

  it('refuses when the dealer cannot pay the difference, ignoring the money offered, except Jake who is topped up', () => {
    const f = merchantFixture(t);
    const keith = f.ctx.state.dealers[KEITH]?.status;
    if (keith) keith.cash = 100;
    const sale = { sell: [offer(item('FLAK_JACKET', 80))], cash: [cash(5000)] };
    expect(planTrade(f.ctx, input(KEITH, sale)).refusal).toEqual({ reason: 'dealerCannotAfford' });
    const jake = f.ctx.state.dealers[JAKE]?.status;
    if (jake) jake.cash = 0;
    const plan = planTrade(f.ctx, input(JAKE, { sell: [offer(item('GLOCK_17', 60))] }));
    expect(plan.refusal).toBeNull();
    executeTrade(f.ctx, plan);
    expect(jake?.cash).toBe(0);
    expect(plan.change).toBeGreaterThan(0);
  });

  it('refuses unwanted and worthless items and full offer areas', () => {
    const f = merchantFixture(t);
    expect(planTrade(f.ctx, input(TONY, { sell: [offer(item('CANTEEN'))] })).refusal).toEqual({ reason: 'wontBuy', entry: 0 });
    expect(planTrade(f.ctx, input(JAKE, { sell: [offer(item('TSHIRT', 1))] })).refusal).toEqual({ reason: 'worthless', entry: 0 });
    addItemToArmsDealerInventory(f.ctx, TONY, itemId(t, 'GLOCK_17'), defaultItemInfo(), 12);
    const boxes = determineArmsDealersSellingInventory(f.ctx, TONY, () => true);
    const status = f.ctx.state.dealers[TONY]?.status;
    if (status) status.cash = 1;
    expect(planTrade(f.ctx, input(TONY, { buy: [{ boxes, count: 12 }], balance: 99999, useBalance: true })).refusal).toEqual({
      reason: 'noRoomForPurchases',
    });
    expect(planTrade(f.ctx, input(TONY, { buy: [{ boxes, count: 13 }] })).refusal).toEqual({ reason: 'notEnoughInBox', entry: 0 });
  });

  it('keeps overpayment at dealers without change and lets items sold to buy-only dealers vanish', () => {
    const f = merchantFixture(t);
    addItemToArmsDealerInventory(f.ctx, FRANK, itemId(t, 'BEER'), defaultItemInfo(), 5);
    const boxes = determineArmsDealersSellingInventory(f.ctx, FRANK, () => true);
    const plan = planTrade(f.ctx, input(FRANK, { buy: [{ boxes, count: 1 }], cash: [cash(100)] }));
    expect(plan.change).toBe(0);
    expect(executeTrade(f.ctx, plan).delivered.map((e) => e.kind)).toEqual(['purchase']);
    const micky = f.ctx.state.dealers[MICKY]?.status;
    if (micky) micky.cash = 10000;
    const claws = itemId(t, 'CREATURE_PART_CLAWS');
    executeTrade(f.ctx, planTrade(f.ctx, input(MICKY, { sell: [offer(item('CREATURE_PART_CLAWS'))] })));
    expect(header(f.ctx.state, MICKY, claws).total).toBe(0);
  });

  it('sets Howard’s fact and Franz’s camera flag on a transaction', () => {
    const f = merchantFixture(t);
    addItemToArmsDealerInventory(f.ctx, HOWARD, itemId(t, 'FIRSTAIDKIT'), defaultItemInfo(), 1);
    const kit = determineArmsDealersSellingInventory(f.ctx, HOWARD, () => true);
    executeTrade(f.ctx, planTrade(f.ctx, input(HOWARD, { buy: [{ boxes: kit, count: 1 }], cash: [cash(1000)] })));
    expect(f.setFacts).toEqual([MerchantFact.FACT_222]);
    addItemToArmsDealerInventory(f.ctx, FRANZ, itemId(t, 'VIDEO_CAMERA'), defaultItemInfo(), 1);
    const franz = f.ctx.state.dealers[FRANZ]?.status;
    if (franz) franz.cash = 5000;
    const camera = determineArmsDealersSellingInventory(f.ctx, FRANZ, () => true);
    executeTrade(f.ctx, planTrade(f.ctx, input(FRANZ, { buy: [{ boxes: camera, count: 1 }], cash: [cash(5000)] })));
    expect(franz?.flags).toBe(FRANZ_HAS_SOLD_VIDEO_CAMERA);
  });

  it('splits a loaded gun for repair, queues the gun and returns the bullets', () => {
    const f = merchantFixture(t, { world: { minutes: DAY + 600 } });
    const glock = item('GLOCK_17', 50);
    glock.gunShotsLeft = 9;
    const plan = planTrade(f.ctx, input(PERKO, { repair: [offer(glock)], cash: [cash(100)] }));
    expect(plan.refusal).toBeNull();
    expect(plan.doa.map((e) => [e.object.item, e.object.gunShotsLeft, e.price, e.repairMinutes, e.doneAt])).toEqual([
      [glock.item, 0, 56, 56, DAY + 656],
    ]);
    const outcome = executeTrade(f.ctx, plan);
    expect(
      outcome.delivered.map((e) => [e.kind, e.object.item, e.kind === 'change' ? e.object.money : e.object.status[0], e.owner]),
    ).toEqual([
      ['part', glock.gunAmmoItem, 9, IVAN],
      ['change', itemId(t, 'MONEY'), 44, NO_PROFILE],
    ]);
    expect(outcome.repairs.map((r) => r.doneAt)).toEqual([DAY + 656]);
    expect(f.ctx.state.dealers[PERKO]?.status.cash).toBe(56);
  });

  it('counts uncollected repairs against the limit of four and refuses undamaged items', () => {
    const f = merchantFixture(t, { world: { minutes: DAY + 600 } });
    for (let k = 0; k < 3; k++) giveObjectToArmsDealerForRepair(f.ctx, PERKO, item('GLOCK_17', 40), IVAN);
    f.world.minutes = DAY * 9;
    expect(planTrade(f.ctx, input(PERKO, { repair: [offer(item('FLAK_JACKET', 100))] })).refusal).toEqual({
      reason: 'notDamaged',
      entry: 0,
    });
    expect(
      planTrade(f.ctx, input(PERKO, { repair: [offer(item('BERETTA_92F', 50))], balance: 1000, useBalance: true })).refusal,
    ).toBeNull();
    const two = planTrade(
      f.ctx,
      input(PERKO, { repair: [offer(item('BERETTA_92F', 50)), offer(item('M14', 50))], balance: 9999, useBalance: true }),
    );
    expect(two.refusal).toEqual({ reason: 'tooManyToRepair', entry: 1 });
    expect(planTrade(f.ctx, input(PERKO, { repair: [offer(item('VIDEO_CAMERA', 50))] })).refusal).toEqual({
      reason: 'wontRepair',
      entry: 0,
    });
  });
});
