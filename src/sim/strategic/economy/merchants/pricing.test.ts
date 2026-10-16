import { beforeAll, describe, expect, it } from 'vitest';
import { itemId, loadMerchantTestContent, type MerchantTestContent, merchantFixture } from '../../../../../tests/support/merchants.ts';
import { createItem, createItems, type ItemObject } from '../../../items/object.ts';
import { Fact } from '../../narrative/fact-ids.ts';
import { calcShopKeeperItemPrice, calcValueOfItemToDealer, itemConditionModifier } from './pricing.ts';

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

const TONY = 0;
const FRANZ = 1;
const KEITH = 2;
const JAKE = 3;
const MICKY = 13;
const FLO_MODIFIER = 110;

function price(dealer: number, selling: boolean, o: ItemObject, weaponSaleModifier = 100, unitOnly = false): number {
  const { ctx } = merchantFixture(t);
  const d = t.content.dealers[dealer];
  if (!d) throw new Error(`no dealer ${dealer}`);
  return calcShopKeeperItemPrice(
    ctx,
    { dealer, dealerSelling: selling, unitOnly, modifier: selling ? d.sellingPrice : d.buyingPrice, weaponSaleModifier },
    o,
  );
}

function item(name: string, status = 100): ItemObject {
  return createItem(t.items, itemId(t, name), status);
}

describe('shopkeeper prices', () => {
  it('computes the condition modifier in single precision', () => {
    const glock = itemId(t, 'GLOCK_17');
    expect(itemConditionModifier(t.items, glock, 20)).toBe(Math.fround(0.6));
    expect(itemConditionModifier(t.items, glock, 30)).toBe(Math.fround(0.65));
    expect(itemConditionModifier(t.items, glock, 79)).toBe(Math.fround(0.895));
    expect(itemConditionModifier(t.items, glock, 99)).toBe(Math.fround(0.995));
    expect(itemConditionModifier(t.items, itemId(t, 'BEER'), 50)).toBe(0.5);
    expect(itemConditionModifier(t.items, itemId(t, 'CLIP9_15'), 5)).toBe(Math.fround(5 / 15));
  });

  it('reproduces the worked examples bit for bit', () => {
    const empty = item('GLOCK_17');
    empty.gunShotsLeft = 0;
    expect(price(TONY, true, empty)).toBe(437);
    const loaded = item('GLOCK_17', 50);
    loaded.gunShotsLeft = 15;
    expect(price(TONY, false, loaded)).toBe(207);
    expect(price(KEITH, false, item('FLAK_JACKET', 80))).toBe(202);
    expect(price(JAKE, true, item('GAS_CAN'))).toBe(275);
  });

  it('applies the weapon sale modifier to the sum up to 8 objects and to the unit above', () => {
    expect(price(TONY, true, createItems(t.items, itemId(t, 'CLIP9_15'), 100, 3), FLO_MODIFIER)).toBe(49);
    const overloaded = createItems(t.items, itemId(t, 'CLIP9_15'), 100, 8);
    overloaded.count = 9;
    expect(price(TONY, true, overloaded, FLO_MODIFIER)).toBe(153);
    expect(price(TONY, true, overloaded, FLO_MODIFIER, true)).toBe(17);
    expect(price(TONY, false, item('COMBAT_KNIFE', 100), FLO_MODIFIER)).toBe(82);
    expect(price(TONY, true, item('FLAK_JACKET'), FLO_MODIFIER)).toBe(0 + price(TONY, true, item('FLAK_JACKET')));
  });

  it('values items by the price class rules of Jake, Keith and Franz', () => {
    const { ctx, facts } = merchantFixture(t);
    const v = (dealer: number, name: string, selling: boolean) => calcValueOfItemToDealer(ctx, dealer, itemId(t, name), selling);
    expect(v(JAKE, 'M14', false)).toBe(0);
    expect(v(JAKE, 'M14', true)).toBe(353);
    expect(v(FRANZ, 'BEER', false)).toBe(0);
    expect(v(FRANZ, 'KEVLAR_VEST', false)).toBe(166);
    expect(v(FRANZ, 'SPECTRA_VEST', false)).toBe(1000);
    expect(v(JAKE, 'GAS_CAN', false)).toBe(250);
    expect(v(JAKE, 'CREATURE_PART_CLAWS', false)).toBe(0);
    expect(v(JAKE, 'JAR', false)).toBe(10);
    expect(v(KEITH, 'GLOCK_17', false)).toBe(0);
    facts.add(Fact.HILLBILLIES_KILLED);
    expect(v(KEITH, 'GLOCK_17', false)).toBe(175);
    expect(v(TONY, 'ROCKET_RIFLE', false)).toBe(5000);
    expect(v(TONY, 'CANTEEN', false)).toBe(0);
    expect(v(MICKY, 'CREATURE_PART_CLAWS', false)).toBe(500);
  });

  it('floors dealer selling prices at $1 and lets buying prices be worthless', () => {
    expect(price(JAKE, false, item('TSHIRT', 1))).toBe(0);
    expect(price(JAKE, true, item('TSHIRT', 1))).toBe(1);
  });

  it('prices guns with their loaded magazine and attachments', () => {
    const m14 = item('M14', 79);
    m14.gunShotsLeft = 0;
    const scope = m14.attachments[0];
    if (scope) {
      scope.item = itemId(t, 'SNIPERSCOPE');
      scope.status = 90;
    }
    const gunOnly = item('M14', 79);
    gunOnly.gunShotsLeft = 0;
    expect(price(TONY, false, m14)).toBe(price(TONY, false, gunOnly) + 356);
    expect(price(FRANZ, false, m14)).toBe(price(FRANZ, false, gunOnly) + 78);
  });
});
