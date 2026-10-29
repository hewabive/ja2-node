import { beforeAll, describe, expect, it } from 'vitest';
import {
  itemId,
  loadMerchantTestContent,
  type MerchantFixture,
  type MerchantTestContent,
  merchantFixture,
  queued,
} from '../../../../../tests/support/merchants.ts';
import { RecordingRolls } from '../../../../../tests/support/queen.ts';
import { Rng } from '../../../../core/rng.ts';
import { Fact } from '../../narrative/fact-ids.ts';
import {
  adjustCertainDealersInventory,
  convertCreatureBloodToElixir,
  dailyCheckOnItemQuantities,
  FRANZ_HAS_SOLD_VIDEO_CAMERA,
  guaranteeAtLeastOneItemOfType,
  initAllArmsDealers,
  limitArmsDealersInventory,
  simulateArmsDealerCustomer,
} from './daily.ts';
import { addItemToArmsDealerInventory } from './inventory.ts';
import { activeSpecials, defaultItemInfo, header } from './state.ts';
import { dealerItemType } from './supply.ts';

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

const TONY = 0;
const FRANZ = 1;
const JAKE = 3;
const GABBY = 4;
const SAM = 7;
const FRANK = 8;
const ARNIE = 14;
const DEALERS = 19;
const FRANK_ALCOHOL = { BEER: 12, WINE: 6, ALCOHOL: 9 };
const SEED = 7;

function only(f: MerchantFixture, dealer: number): void {
  for (let d = 0; d < DEALERS; d++) {
    const status = f.ctx.state.dealers[d]?.status;
    if (status) status.outOfBusiness = d !== dealer;
  }
}

function used(condition: number) {
  return { ...defaultItemInfo(), condition };
}

describe('dealer initialisation and daily update', () => {
  it('initialises cash and stock and keeps total = perfect + active specials', () => {
    const f = merchantFixture(t, { random: Rng.fromSeed(SEED) });
    initAllArmsDealers(f.ctx);
    for (const d of t.content.dealers) {
      const s = f.ctx.state.dealers[d.id];
      expect(s?.status.cash).toBe(d.initialCash);
      for (const h of s?.headers ?? []) expect(h.total).toBe(h.perfect + activeSpecials(h));
    }
    expect(header(f.ctx.state, FRANK, itemId(t, 'BEER')).total).toBeGreaterThanOrEqual(FRANK_ALCOHOL.BEER / 3);
    expect(header(f.ctx.state, FRANK, itemId(t, 'WINE')).total).toBeGreaterThanOrEqual(FRANK_ALCOHOL.WINE / 3);
    expect(header(f.ctx.state, FRANK, itemId(t, 'ALCOHOL')).total).toBeGreaterThanOrEqual(FRANK_ALCOHOL.ALCOHOL / 3);
    expect(header(f.ctx.state, SAM, itemId(t, 'JAR')).total).toBe(12);
    expect(header(f.ctx.state, FRANZ, itemId(t, 'VIDEO_CAMERA')).total).toBeGreaterThanOrEqual(1);
    const ammoTypes = f.ctx.state.dealers[TONY]?.headers.filter((h, item) => h.total > 0 && t.items.byIndex.get(item)?.magazine);
    expect(ammoTypes?.length).toBeLessThanOrEqual(8);
    expect(header(f.ctx.state, FRANK, itemId(t, 'BEER')).previouslyEligible).toBe(true);
    expect(f.ctx.state.dealers[ARNIE]?.headers.every((h) => h.total === 0)).toBe(true);
  });

  it('lets customers buy perfect stock per unit, at most three elixirs, and each special separately', () => {
    const rolls = queued(0, 0, 0, 0);
    const f = merchantFixture(t, { random: rolls });
    only(f, GABBY);
    const elixir = itemId(t, 'JAR_ELIXIR');
    addItemToArmsDealerInventory(f.ctx, GABBY, elixir, defaultItemInfo(), 5);
    const jar = itemId(t, 'JAR');
    addItemToArmsDealerInventory(f.ctx, GABBY, jar, used(50), 1);
    simulateArmsDealerCustomer(f.ctx);
    expect(rolls.ranges).toEqual([100, 100, 100, 100]);
    expect(header(f.ctx.state, GABBY, elixir)).toMatchObject({ total: 2, perfect: 2 });
    expect(header(f.ctx.state, GABBY, jar).total).toBe(0);
  });

  it('sells every unit nobody should stock each morning, listed or not: Jake’s gas, Tony’s rocket rifles', () => {
    const f = merchantFixture(t, { random: RecordingRolls.maxima() });
    only(f, JAKE);
    const [gas, crowbar] = [itemId(t, 'GAS_CAN'), itemId(t, 'CROWBAR')];
    addItemToArmsDealerInventory(f.ctx, JAKE, gas, defaultItemInfo(), 5);
    addItemToArmsDealerInventory(f.ctx, JAKE, crowbar, defaultItemInfo(), 1);
    simulateArmsDealerCustomer(f.ctx);
    expect(header(f.ctx.state, JAKE, gas).total).toBe(0);
    expect(header(f.ctx.state, JAKE, crowbar).total).toBe(1);
    only(f, TONY);
    const rocketRifle = itemId(t, 'ROCKET_RIFLE');
    addItemToArmsDealerInventory(f.ctx, TONY, rocketRifle, used(80), 1);
    simulateArmsDealerCustomer(f.ctx);
    expect(header(f.ctx.state, TONY, rocketRifle).total).toBe(0);
  });

  it('turns all of Gabby’s creature blood into elixir without a draw', () => {
    const rolls = queued();
    const f = merchantFixture(t, { random: rolls });
    addItemToArmsDealerInventory(f.ctx, GABBY, itemId(t, 'JAR_CREATURE_BLOOD'), defaultItemInfo(), 4);
    convertCreatureBloodToElixir(f.ctx);
    expect(header(f.ctx.state, GABBY, itemId(t, 'JAR_CREATURE_BLOOD')).total).toBe(0);
    expect(header(f.ctx.state, GABBY, itemId(t, 'JAR_ELIXIR')).total).toBe(4);
    expect(rolls.ranges).toEqual([]);
  });

  it('resets cash daily for living dealers only, repairmen included', () => {
    const f = merchantFixture(t, { random: RecordingRolls.maxima() });
    only(f, ARNIE);
    const arnie = f.ctx.state.dealers[ARNIE]?.status;
    const tony = f.ctx.state.dealers[TONY]?.status;
    if (!arnie || !tony) throw new Error('no dealers');
    arnie.cash = 7;
    tony.cash = 9;
    dailyCheckOnItemQuantities(f.ctx);
    expect(arnie.cash).toBe(1500);
    expect(tony.cash).toBe(9);
  });

  it('restocks at half the maximum: instantly when first eligible, otherwise on the next update whatever the delay', () => {
    const rolls = queued(10, 2, 99, 99);
    const f = merchantFixture(t, { random: rolls, world: { day: 5 } });
    only(f, FRANK);
    const [alcohol, wine, beer] = [itemId(t, 'ALCOHOL'), itemId(t, 'WINE'), itemId(t, 'BEER')];
    dailyCheckOnItemQuantities(f.ctx);
    expect(rolls.ranges).toEqual([100, 3, 100, 100]);
    expect(header(f.ctx.state, FRANK, alcohol)).toMatchObject({ total: FRANK_ALCOHOL.ALCOHOL, previouslyEligible: true, qtyOnOrder: 0 });
    expect(header(f.ctx.state, FRANK, wine)).toMatchObject({ total: 0, previouslyEligible: true });
    expect(header(f.ctx.state, FRANK, beer)).toMatchObject({ total: 0, previouslyEligible: true });
    rolls.reset().push(10, 1, 1, 99);
    f.world.day = 6;
    dailyCheckOnItemQuantities(f.ctx);
    expect(rolls.ranges).toEqual([100, 3, 2, 100]);
    expect(header(f.ctx.state, FRANK, wine)).toMatchObject({ total: 0, qtyOnOrder: 3, orderArrivalDay: 8 });
    rolls.reset().push(99);
    f.world.day = 7;
    dailyCheckOnItemQuantities(f.ctx);
    expect(rolls.ranges).toEqual([100]);
    expect(header(f.ctx.state, FRANK, wine)).toMatchObject({ total: 3, qtyOnOrder: 0, orderArrivalDay: 0 });
  });

  it('guarantees Tony a big gun with weights that favour the first candidate by one', () => {
    const rolls = queued(0, 99);
    const f = merchantFixture(t, { random: rolls, world: { progress: 35 } });
    guaranteeAtLeastOneItemOfType(f.ctx, TONY, t.content.tables.categories.BIG_GUNS);
    const stocked = f.ctx.state.dealers[TONY]?.headers.findIndex((h) => h.total > 0) ?? -1;
    expect(stocked).toBeGreaterThan(0);
    expect(dealerItemType(t.items, t.content, stocked) & t.content.tables.categories.BIG_GUNS).not.toBe(0);
    expect(rolls.ranges[0]).toBeGreaterThan(0);
  });

  it('limits item types, removing one unit of a chosen type and redrawing past the stale total', () => {
    const rolls = queued(0, 0, 4, 1, 0);
    const f = merchantFixture(t, { random: rolls });
    const big = t.content.tables.categories.BIG_GUNS;
    const [mp5k, mac10, aksu, m14] = [itemId(t, 'MP5K'), itemId(t, 'MAC10'), itemId(t, 'AKSU74'), itemId(t, 'M14')];
    addItemToArmsDealerInventory(f.ctx, TONY, mp5k, defaultItemInfo(), 2);
    for (const gun of [mac10, aksu, m14]) addItemToArmsDealerInventory(f.ctx, TONY, gun, defaultItemInfo(), 1);
    limitArmsDealersInventory(f.ctx, TONY, big, 2);
    expect(rolls.ranges).toEqual([5, 2, 5, 5, 1]);
    expect([mp5k, mac10, aksu, m14].map((i) => header(f.ctx.state, TONY, i).total)).toEqual([1, 1, 1, 0]);
  });

  it('drops whole ammo types beyond Tony’s eighth', () => {
    const f = merchantFixture(t, { random: RecordingRolls.zeros() });
    const clips = t.items.ordered.filter((d) => d.magazine && !(d.flags & 0x0400)).slice(0, 10);
    for (const c of clips) addItemToArmsDealerInventory(f.ctx, TONY, c.index, defaultItemInfo(), 3);
    limitArmsDealersInventory(f.ctx, TONY, t.content.tables.categories.AMMO, 8);
    expect(clips.filter((c) => header(f.ctx.state, TONY, c.index).total > 0)).toHaveLength(8);
    expect(clips.every((c) => [0, 3].includes(header(f.ctx.state, TONY, c.index).total))).toBe(true);
  });

  it('guarantees Jake’s gas with a draw even when he has enough, and Franz’s camera until he sold one', () => {
    const rolls = RecordingRolls.zeros();
    const f = merchantFixture(t, { random: rolls });
    for (let d = 0; d < DEALERS; d++) {
      const status = f.ctx.state.dealers[d]?.status;
      if (status && d !== JAKE && d !== FRANZ) status.outOfBusiness = true;
    }
    f.facts.add(Fact.ESTONI_REFUELLING_POSSIBLE);
    addItemToArmsDealerInventory(f.ctx, JAKE, itemId(t, 'GAS_CAN'), defaultItemInfo(), 9);
    const franz = f.ctx.state.dealers[FRANZ]?.status;
    if (franz) franz.flags |= FRANZ_HAS_SOLD_VIDEO_CAMERA;
    adjustCertainDealersInventory(f.ctx);
    expect(rolls.ranges).toEqual([3]);
    expect(header(f.ctx.state, JAKE, itemId(t, 'GAS_CAN')).total).toBe(9);
    expect(header(f.ctx.state, FRANZ, itemId(t, 'VIDEO_CAMERA')).total).toBe(0);
  });
});
