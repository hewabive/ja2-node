import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mainAdvance } from '../../tests/support/explosives.ts';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { ReloadingSession } from '../../tests/support/session-reload.ts';
import { STUB_DEALER, STUB_REPAIRMAN, stubCampaignInA10, stubSoldierOfProfile, walkNextToProfile } from '../../tests/support/stub-shops.ts';
import type { ShopView } from '../protocol/view.ts';
import { shopRefusal } from '../sim/campaign/shop-refusals.ts';
import { setSoldierPosition } from '../sim/tactical/movement.ts';
import { Personality, Team } from '../sim/tactical/soldier.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const DEALER = STUB_DEALER;
const REPAIRMAN = STUB_REPAIRMAN;
const REPAIR_WAIT_SECONDS = 3600;
const FAR_FROM_THE_DEALER = 10;

const OFFER_AREA_SLOTS = 12;
const SK_QUOTE_FIRST_ENTERS = 11;
const SK_QUOTE_REQUESTED_EVALUATION = 16;
const SK_QUOTE_EXACTLY_ENOUGH = 22;

const inA10 = (seed: number, mode?: RunMode, mercs?: number): Promise<CampaignSession> => stubCampaignInA10(kit, seed, mode, mercs);
const walkNextTo = walkNextToProfile;

describe('stub dealers in A10', () => {
  it('stand as merchants a stub squad reaches from the start sector without a fight', async () => {
    const session = await inA10(3);
    const view = session.view();
    expect(view.mapPath).toBe('stubs/world/maps/a10.dat');
    const labels = view.soldiers.filter((s) => s.team === Team.CIV && s.merchant).map((s) => [s.name, s.merchant]);
    expect(labels).toEqual(
      expect.arrayContaining([
        ['Okonjo', 'buySell'],
        ['Castell', 'repair'],
      ]),
    );
  });

  it('buy and sell at the dealer, then a repair at the repairman, the same across reloads', async () => {
    await expectReloadsInvisible(tradeAndRepair);
  });
});

describe('the shop screen fields of the stub dealer', () => {
  it('name the quote text, the ammo type of dealer guns, and let prev and next change the pricing merc', async () => {
    const session = await inA10(5);
    const [first, second] = session.view().strategic?.mercs ?? [];
    if (!first || !second) throw new Error('two mercs expected');
    walkNextTo(session, first.id, DEALER);
    session.drainEvents();
    const opened = session.dispatch({ type: 'openShop', dealer: DEALER, soldier: first.id });
    expect(opened).toMatchObject({ ok: true, data: { pricing: { soldier: first.id }, repaired: [] } });
    const quote = session.drainEvents().find((e) => e.type === 'shopkeeperQuote');
    expect(quote).toMatchObject({
      dealer: DEALER,
      quote: SK_QUOTE_FIRST_ENTERS,
      textKey: { file: 'npcdata/091.edt', row: SK_QUOTE_FIRST_ENTERS },
    });
    expect(typeof (quote as { chars?: unknown }).chars).toBe('number');
    const shop = opened.data as ShopView;
    const guns = shop.boxes.filter((b) => kit.content.items.byName.get(b.item)?.weapon);
    const loaded = guns.filter((g) => g.ammo);
    expect(loaded.length).toBeGreaterThan(0);
    for (const gun of loaded) expect(kit.content.items.byName.get(gun.ammo?.item ?? '')?.magazine).toBeDefined();
    expect(loaded.every((g) => g.ammo?.shots === 0)).toBe(true);
    expect(session.dispatch({ type: 'setShopPricing', soldier: second.id })).toMatchObject({
      ok: true,
      data: { shop: { pricing: { soldier: second.id } } },
    });
    expect(session.view().shop?.pricing.soldier).toBe(second.id);
    for (const cmd of [{ type: 'setShopPricing' }, { type: 'setShopPricing', soldier: 999 }])
      expect(session.dispatch(cmd)).toEqual(shopRefusal('noSuchPricingMerc'));
    expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });
    expect(session.dispatch({ type: 'setShopPricing', soldier: first.id })).toEqual(shopRefusal('shopNotOpen'));
  });
});

describe('the squad and the selection as the stub dealer is talked to for his shop (Interface_Dialogue.cc InitTalkingMenu)', () => {
  async function traderInASecondSquad(seed: number) {
    const session = await inA10(seed);
    const [first, trader] = session.view().strategic?.mercs ?? [];
    if (!first || !trader) throw new Error('two mercs expected');
    expect(session.dispatch({ type: 'assignSquad', soldier: trader.id, squad: 'new' })).toMatchObject({ ok: true, data: { squad: 1 } });
    const squadAndSelection = () => [session.campaign.state.forces.currentSquad, session.campaign.tactical?.state.turn.selected];
    return { session, first: first.id, trader: trader.id, squadAndSelection };
  }

  it("makes the trader's squad current and selects him, after its first merc, forced: a psycho first merc draws", async () => {
    const opened = async (psycho: boolean) => {
      const session = await inA10(6, undefined, 3);
      const [first, leader, trader] = session.view().strategic?.mercs.map((m) => m.id) ?? [];
      if (first === undefined || leader === undefined || trader === undefined) throw new Error('three mercs expected');
      expect(session.dispatch({ type: 'assignSquad', soldier: leader, squad: 'new' })).toMatchObject({ ok: true, data: { squad: 1 } });
      expect(session.dispatch({ type: 'assignSquad', soldier: trader, squad: 1 })).toMatchObject({ ok: true });
      walkNextTo(session, trader, DEALER);
      expect(session.dispatch({ type: 'selectSquad', squad: 0 })).toEqual({ ok: true });
      const squadAndSelection = () => [session.campaign.state.forces.currentSquad, session.campaign.tactical?.state.turn.selected];
      expect(squadAndSelection()).toEqual([0, first]);
      const leaderSoldier = session.campaign.tactical?.state.soldiers[leader];
      if (psycho && leaderSoldier) leaderSoldier.personalityTrait = Personality.PSYCHO;
      const before = session.campaign.state.rng.state();
      expect(session.dispatch({ type: 'openShop', dealer: DEALER, soldier: trader })).toMatchObject({ ok: true });
      expect(squadAndSelection()).toEqual([1, trader]);
      return mainAdvance(before, session.campaign.state.rng.state());
    };
    const [plain, psycho] = [await opened(false), await opened(true)];
    expect(psycho - plain).toBe(1);
  });

  it('leaves the squad and the selection alone when the shop refuses a trader too far away', async () => {
    const { session, first, trader, squadAndSelection } = await traderInASecondSquad(7);
    const t = session.campaign.tactical?.state;
    const soldier = t?.soldiers[trader];
    if (!t || !soldier) throw new Error('no trader on the map');
    setSoldierPosition(t, soldier, stubSoldierOfProfile(session, DEALER).gridNo + FAR_FROM_THE_DEALER);
    expect(squadAndSelection()).toEqual([0, first]);
    expect(session.dispatch({ type: 'openShop', dealer: DEALER, soldier: trader })).toMatchObject({
      ok: false,
      data: { refusal: 'tooFar' },
    });
    expect(squadAndSelection()).toEqual([0, first]);
  });
});

async function tradeAndRepair(mode?: RunMode): Promise<CampaignSession> {
  const session = await inA10(4, mode);
  const merc = session.view().strategic?.mercs[0]?.id ?? 0;
  walkNextTo(session, merc, DEALER);
  const opened = session.dispatch({ type: 'openShop', dealer: DEALER, soldier: merc });
  expect(opened).toMatchObject({ ok: true, data: { kind: 'buySell' } });
  const shop = opened.data as ShopView;
  const box = shop.boxes.find((b) => b.unitPrice !== undefined && b.unitPrice <= shop.balance);
  if (!box) throw new Error('the dealer sells nothing affordable');
  const buy = { buy: [{ item: box.key.item, element: box.key.element, count: 1 }], useBalance: true };
  expect(session.dispatch({ type: 'quoteTrade', ...buy })).toMatchObject({ ok: true });
  const balance = session.campaign.state.finances.balance;
  expect(session.dispatch({ type: 'trade', ...buy })).toMatchObject({ ok: true });
  expect(session.campaign.state.finances.balance).toBeLessThan(balance);
  const inv = session.campaign.tactical?.state.soldiers[merc]?.inv ?? [];
  const slot = inv.findIndex((o) => o?.item === kit.content.items.byName.get('CLIP9_15')?.index);
  expect(slot).toBeGreaterThanOrEqual(0);
  const sell = { sell: [{ soldier: merc, slot, index: 0 }] };
  const quoted = session.dispatch({ type: 'quoteTrade', ...sell });
  expect(quoted).toMatchObject({ ok: true, data: { quotes: [SK_QUOTE_REQUESTED_EVALUATION, SK_QUOTE_EXACTLY_ENOUGH] } });
  const poa = (quoted.data as { poa: unknown[] }).poa;
  expect(poa).toHaveLength(OFFER_AREA_SLOTS);
  expect(poa[0]).toMatchObject({ kind: 'sold', item: 'CLIP9_15', count: 1, owner: 0, source: { soldier: merc, slot, index: 0 } });
  expect(poa.slice(1).every((e) => e === null)).toBe(true);
  expect(session.dispatch({ type: 'trade', ...sell })).toMatchObject({ ok: true });
  expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });

  walkNextTo(session, merc, REPAIRMAN);
  const gun = session.campaign.tactical?.state.soldiers[merc]?.inv[5];
  if (!gun?.item) throw new Error('no gun in hand');
  gun.status[0] = 60;
  expect(session.dispatch({ type: 'openShop', dealer: REPAIRMAN, soldier: merc })).toMatchObject({ ok: true, data: { kind: 'repair' } });
  const repair = { repair: [{ soldier: merc, slot: 'hand' }], useBalance: true };
  const estimate = session.dispatch({ type: 'quoteTrade', ...repair });
  expect(estimate).toMatchObject({ ok: true, data: { repair: [{ item: 'GLOCK_17', owner: 0 }] } });
  const parts = (estimate.data as { poa: ({ kind: string; item: string; source?: unknown } | null)[] }).poa.filter((e) => e !== null);
  expect(parts.map((e) => [e.kind, e.item, e.source])).toEqual([['part', 'CLIP9_15', { soldier: merc, slot: 5 }]]);
  expect((estimate.data as { refusal?: unknown }).refusal ?? null).toBeNull();
  expect(session.dispatch({ type: 'trade', ...repair })).toMatchObject({ ok: true });
  expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  new ReloadingSession('t', session).advance({ worldSeconds: REPAIR_WAIT_SECONDS });
  expect(session.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
  session.drainEvents();
  const reopened = session.dispatch({ type: 'openShop', dealer: REPAIRMAN, soldier: merc });
  expect(reopened).toMatchObject({ ok: true });
  expect((reopened.data as ShopView).repaired).toEqual([{ item: 'GLOCK_17', status: 100, owner: 0, soldier: merc }]);
  expect(session.view().shop?.repaired).toHaveLength(1);
  const events = session.drainEvents().map((e) => e.type);
  expect(events).toContain('repairCollected');
  expect(session.campaign.tactical?.state.soldiers[merc]?.inv[5]?.status[0]).toBe(100);
  expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });
  return session;
}
