import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers, runUntilIdle } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadMerchantTestContent, type MerchantTestContent } from '../../../tests/support/merchants.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { advance, expectReloadsInvisible, type RunMode } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { pythSpacesAway } from '../../content/world/grid.ts';
import type { SimEvent } from '../events.ts';
import { createItem, createMoney } from '../items/object.ts';
import { addItemToArmsDealerInventory } from '../strategic/economy/merchants/inventory.ts';
import { repairmanIsFixingItemsButNoneAreDoneYet } from '../strategic/economy/merchants/repair.ts';
import { defaultItemInfo, emptyDealerState, header } from '../strategic/economy/merchants/state.ts';
import type { ShopView } from '../strategic/economy/merchants/view.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { worldDay, worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { anim } from '../tactical/anim-states.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { setSoldierPosition } from '../tactical/movement.ts';
import { Body, createSoldier, Orders, type Soldier, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import { registerSoldier, whoIsThere } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { FinanceCode } from './finances.ts';
import { MercKind } from './roster.ts';
import { shopRefusal } from './shop-refusals.ts';

let kit: CampaignKit;
let merchants: MerchantTestContent;

beforeAll(async () => {
  const [sectors, economy, army, m] = await Promise.all([
    loadStubSectorKit(),
    loadEconomyTestContent(),
    loadArmyTestContent(),
    loadMerchantTestContent(),
  ]);
  kit = { sectors, economy, army };
  merchants = m;
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const FRANZ = 1;
const FRANZ_PROFILE = 124;
const SAM = 7;
const PERKO_PROFILE = 74;
const ARNIE = 14;
const ARNIE_PROFILE = 128;
const SK_QUOTE_FIRST_ENTERS = 11;
const DEALER_SLOT = 12;
const OPEN = 8 * 60;
const CLOSE = 20 * 60;
const COLS = 160;
const NEAR = [2, -2, 2 * COLS, -2 * COLS, 2 + COLS, -2 - COLS, 3, -3];

type Driver = (c: CampaignSim, ticks: number) => void;
const instant: Driver = (c, ticks) => {
  for (let i = 0; i < ticks; i++) c.step();
};
const manual: Driver = (c, ticks) => {
  const chunk = 7;
  for (let i = 0; i < ticks; i += chunk) for (let k = 0; k < chunk && i + k < ticks; k++) c.step();
};

const item = (name: string) => merchants.items.byName.get(name)?.index ?? -1;

function startCampaign(seed: number, mode?: RunMode): CampaignSim {
  const { campaign } = createTestCampaign(kit, {
    seed,
    garrison: { admins: 0, troops: 0, elites: 0 },
    merchants: merchants.content,
    merchantHooks: { shopHours: (profile) => (profile === PERKO_PROFILE ? { open: OPEN, close: CLOSE } : null) },
    ...(mode ? { mode } : {}),
  });
  landFirstSquad(campaign);
  runUntilIdle(campaign);
  return campaign;
}

function spawnDealer(c: CampaignSim, profile: number, slot: number, near: Soldier): Soldier {
  const t = c.tactical?.state;
  if (!t) throw new Error('no sector loaded');
  const s = createSoldier({
    id: TEAM_FIRST_ID[Team.CIV] + slot,
    team: Team.CIV,
    name: `Dealer ${profile}`,
    profile,
    bodyType: 0,
    palettes: { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: 'WHITEVEST', pants: 'JEANPANTS' },
    stats: {
      agility: 50,
      dexterity: 50,
      strength: 50,
      wisdom: 50,
      leadership: 50,
      marksmanship: 50,
      mechanical: 50,
      explosives: 50,
      medical: 50,
      experience: 3,
    },
    life: 60,
    gridNo: -1,
    direction: 4,
    state: anim(t.content, 'STANDING'),
    ai: { orders: Orders.STATIONARY },
  });
  registerSoldier(t, s);
  const g = NEAR.map((d) => near.gridNo + d).find((x) => !whoIsThere(t, x, 0) && pythSpacesAway(x, near.gridNo) <= 3);
  if (g === undefined) throw new Error('no free tile next to the merc');
  setSoldierPosition(t, s, g);
  c.tactical?.lookAround();
  return s;
}

function stockFranz(c: CampaignSim): void {
  const ctx = c.merchants;
  if (!ctx) throw new Error('no merchants');
  const fresh = emptyDealerState();
  fresh.status.cash = 5000;
  ctx.state.dealers[FRANZ] = fresh;
  addItemToArmsDealerInventory(ctx, FRANZ, item('VIDEO_CAMERA'), defaultItemInfo(), 1);
  addItemToArmsDealerInventory(ctx, FRANZ, item('KEVLAR_VEST'), defaultItemInfo(), 2);
}

function shopView(r: { readonly data?: unknown }): ShopView {
  return r.data as ShopView;
}

function firstMerc(c: CampaignSim): Soldier {
  const merc = ourSoldiers(c)[0];
  if (!merc) throw new Error('no merc');
  return merc;
}

function franzScenario(drive: Driver, seed: number, mode?: RunMode): { readonly c: CampaignSim; readonly log: SimEvent[] } {
  const c = startCampaign(seed, mode);
  const merc = firstMerc(c);
  spawnDealer(c, FRANZ_PROFILE, DEALER_SLOT, merc);
  stockFranz(c);
  const log: SimEvent[] = [...c.drainEvents()];
  merc.inv[InvSlot.SMALLPOCK1] = createMoney(merchants.items, 200);
  const opened = c.dispatch({ type: 'openShop', dealer: 'FRANZ', soldier: merc.id });
  expect(opened.ok, opened.reason).toBe(true);
  const view = shopView(opened);
  expect(view).toMatchObject({ dealer: FRANZ_PROFILE, kind: 'buySell', soldier: merc.id });
  expect(view.boxes.map((b) => [b.item, b.count, b.unitPrice])).toEqual([
    ['KEVLAR_VEST', 2, 249],
    ['VIDEO_CAMERA', 1, 450],
  ]);
  expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(false);
  const tick = c.tick;
  drive(c, 50);
  expect(c.tick).toBe(tick);
  expect(advance(c, { ticks: 10 })).toMatchObject({ reason: 'refused' });
  const camera = { item: 'VIDEO_CAMERA', element: -1, count: 1 };
  const cash = [{ soldier: merc.id, slot: InvSlot.SMALLPOCK1 }];
  const quote = c.dispatch({ type: 'quoteTrade', buy: [camera], cash });
  expect(quote.data).toMatchObject({
    totals: { cost: 450, value: 200, cash: 200 },
    balanceNeeded: 250,
    refusal: { refusal: 'needBalance', amount: 250 },
  });
  expect(c.dispatch({ type: 'trade', buy: [camera], cash })).toEqual(shopRefusal('needBalance', { amount: 250 }));
  const balance = c.state.finances.balance;
  const bought = c.dispatch({ type: 'trade', buy: [camera], cash, useBalance: true });
  expect(bought.ok, bought.reason).toBe(true);
  expect(c.state.finances.balance).toBe(balance - 250);
  expect(c.state.finances.ledger.at(-1)).toMatchObject({
    code: FinanceCode.PURCHASED_ITEM_FROM_DEALER,
    secondCode: FRANZ_PROFILE,
    amount: -250,
  });
  expect(firstMerc(c).inv.some((o) => o.item === item('VIDEO_CAMERA'))).toBe(true);
  expect(firstMerc(c).inv[InvSlot.SMALLPOCK1]?.item).not.toBe(item('MONEY'));
  const sold = c.dispatch({ type: 'trade', sell: [{ soldier: merc.id, slot: 'hand' }] });
  expect(sold.ok, sold.reason).toBe(true);
  expect(firstMerc(c).inv[InvSlot.HAND]?.item).toBe(0);
  const change = firstMerc(c).inv.find((o) => o.item === item('MONEY'));
  expect(change?.money).toBeGreaterThan(0);
  const pocket = firstMerc(c).inv.findIndex((o) => o.item === item('MONEY'));
  const gift = c.dispatch({ type: 'trade', cash: [{ soldier: merc.id, slot: pocket, amount: 10 }] });
  expect(gift).toMatchObject({ ok: true, data: { giftAccepted: false } });
  expect(firstMerc(c).inv[pocket]?.money).toBe(change?.money);
  expect(c.dispatch({ type: 'closeShop' }).ok).toBe(true);
  log.push(...c.drainEvents());
  const types = log.map((e) => e.type);
  expect(types).toEqual(expect.arrayContaining(['shopOpened', 'itemsBought', 'moneyChanged', 'itemsSold', 'giftGiven', 'shopClosed']));
  expect(header(c.merchants?.state ?? never(), FRANZ, item('VIDEO_CAMERA')).total).toBe(0);
  expect(c.merchants?.state.dealers[FRANZ]?.status.flags).toBe(1);
  return { c, log };
}

function never(): never {
  throw new Error('unreachable');
}

describe('shop scenario on the stub village', () => {
  it('trades with Franz: buy with cash and balance, sell, gift, close; identical under both drivers', () => {
    const a = franzScenario(instant, 3).log;
    const b = franzScenario(manual, 3).log;
    expect(b.map((e) => e.type)).toEqual(a.map((e) => e.type));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('trades with Franz the same way when the campaign is saved and restored after every input', async () => {
    await expectReloadsInvisible((mode) => franzScenario(manual, 3, mode).c);
  });

  it('restocks dealers at 09:00 while the map runs for three days', () => {
    const c = startCampaign(4);
    const ctx = c.merchants;
    if (!ctx) throw new Error('no merchants');
    expect(ctx.state.dealers.map((d) => d.status.cash)).toEqual(merchants.content.dealers.map((d) => d.initialCash));
    expect(header(ctx.state, SAM, item('JAR')).total).toBeGreaterThanOrEqual(1);
    const franz = ctx.state.dealers[FRANZ]?.status;
    if (franz) franz.cash = 1;
    const day = worldDay(c.state.clock);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    advance(c, { worldTime: { day: day + 3, hour: 9, minute: 30 }, mode: CompressMode.MIN60, compressionStopped: false });
    expect(worldDay(c.state.clock)).toBe(day + 3);
    expect(c.merchants?.state.dealers[FRANZ]?.status.cash).toBe(5000);
  });

  it('repairs a pistol at Perko inside shop hours and returns it at 100 % on the next visit, the same across reloads', async () => {
    await expectReloadsInvisible(perkoRepair);
  });

  it('lets only a regular merc of the squad price the trade, as the panel buttons do: no escort, no robot', () => {
    const c = startCampaign(7);
    const [merc, escort, robot, other] = ourSoldiers(c);
    if (!merc || !escort || !robot || !other) throw new Error('four mercs expected');
    spawnDealer(c, FRANZ_PROFILE, DEALER_SLOT, merc);
    const record = c.battle?.roster.get(escort.id)?.record;
    if (record) Object.assign(record, { kind: MercKind.EPC });
    Object.assign(robot, { bodyType: Body.ROBOTNOWEAPON });
    expect(c.dispatch({ type: 'openShop', dealer: 'FRANZ', soldier: merc.id }).ok).toBe(true);
    for (const soldier of [escort.id, robot.id])
      expect(c.dispatch({ type: 'setShopPricing', soldier })).toEqual(shopRefusal('noSuchPricingMerc'));
    expect(c.dispatch({ type: 'setShopPricing', soldier: other.id })).toMatchObject({ ok: true });
    expect(c.dispatch({ type: 'setShopPricing', soldier: merc.id })).toMatchObject({ ok: true });
    expect(c.dispatch({ type: 'stance', soldier: merc.id, stance: 'crouch' })).toMatchObject({ ok: false, data: { refusal: 'shopOpen' } });
  });

  it('greets with the usual quote at Arnie while his repairs are unfinished: the original overwrites quote 33', () => {
    const c = startCampaign(6);
    const merc = firstMerc(c);
    spawnDealer(c, ARNIE_PROFILE, DEALER_SLOT, merc);
    merc.inv[InvSlot.HAND] = createItem(merchants.items, item('GLOCK_17'), 50);
    expect(c.dispatch({ type: 'openShop', dealer: ARNIE_PROFILE, soldier: merc.id }).ok).toBe(true);
    const repaired = c.dispatch({ type: 'trade', repair: [{ soldier: merc.id, slot: 'hand' }], useBalance: true });
    expect(repaired.ok, repaired.reason).toBe(true);
    expect(c.dispatch({ type: 'closeShop' }).ok).toBe(true);
    c.drainEvents();
    expect(c.dispatch({ type: 'openShop', dealer: ARNIE_PROFILE, soldier: merc.id }).ok).toBe(true);
    expect(repairmanIsFixingItemsButNoneAreDoneYet(c.merchants ?? never(), ARNIE)).toBe(true);
    const greeting = c.drainEvents().find((e) => e.type === 'shopkeeperQuote');
    expect(greeting).toMatchObject({ dealer: ARNIE_PROFILE, quote: SK_QUOTE_FIRST_ENTERS });
  });
});

function perkoRepair(mode: RunMode): CampaignSim {
  const c = startCampaign(5, mode);
  const merc = firstMerc(c);
  spawnDealer(c, PERKO_PROFILE, DEALER_SLOT, merc);
  const glock = createItem(merchants.items, item('GLOCK_17'), 50);
  merc.inv[InvSlot.HAND] = glock;
  const ammo = glock.gunAmmoItem;
  expect(c.dispatch({ type: 'openShop', dealer: PERKO_PROFILE, soldier: merc.id }).ok).toBe(true);
  const repaired = c.dispatch({ type: 'trade', repair: [{ soldier: merc.id, slot: 'hand' }], useBalance: true });
  expect(repaired.ok, repaired.reason).toBe(true);
  const doneAt = (repaired.data as { repairs: { doneAt: number }[] }).repairs[0]?.doneAt ?? 0;
  expect(doneAt).toBeGreaterThan(worldTotalMinutes(c.state.clock));
  expect(firstMerc(c).inv[InvSlot.HAND]?.item).toBe(0);
  expect(firstMerc(c).inv.some((o) => o.item === ammo && (o.status[0] ?? 0) > 0)).toBe(true);
  expect(c.dispatch({ type: 'closeShop' }).ok).toBe(true);
  expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  advance(c, { worldTime: (doneAt + 60) * 60, mode: CompressMode.MIN30, compressionStopped: false });
  expect(c.dispatch({ type: 'tacticalScreen' }).ok).toBe(true);
  const again = c.dispatch({ type: 'openShop', dealer: 'PERKO', soldier: merc.id });
  expect(again.ok, again.reason).toBe(true);
  const pistol = firstMerc(c).inv.find((o) => o.item === item('GLOCK_17'));
  expect(pistol?.status[0]).toBe(100);
  expect(c.drainEvents().map((e) => e.type)).toContain('repairCollected');
  return c;
}
