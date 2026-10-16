import { beforeAll, describe, expect, it } from 'vitest';
import {
  itemId,
  loadMerchantTestContent,
  type MerchantTestContent,
  merchantFixture,
  queued,
} from '../../../../../tests/support/merchants.ts';
import { createItem, createItems, NO_PROFILE } from '../../../items/object.ts';
import {
  addAmmoToArmsDealerInventory,
  addItemToArmsDealerInventory,
  addObjectToArmsDealerInventory,
  armsDealerGetsFreshStock,
  countDistinctItemsInArmsDealersInventory,
  makeObjectOutOfDealerItems,
  removeItemFromArmsDealerInventory,
  removeRandomItemFromArmsDealerInventory,
  specialItemInfoFromObject,
} from './inventory.ts';
import { activeSpecials, defaultItemInfo, header, isItemInfoSpecial } from './state.ts';

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

const TONY = 0;
const KEITH = 2;
const FRANK = 8;

function used(condition: number) {
  return { ...defaultItemInfo(), condition };
}

describe('dealer inventory model', () => {
  it('stores perfect items as a counter and anything used, imprinted or attached as special elements', () => {
    expect(isItemInfoSpecial(defaultItemInfo())).toBe(false);
    expect(isItemInfoSpecial(used(99))).toBe(true);
    expect(isItemInfoSpecial({ ...defaultItemInfo(), imprint: 7 })).toBe(true);
    const attached = defaultItemInfo();
    attached.attachments[1] = itemId(t, 'SNIPERSCOPE');
    expect(isItemInfoSpecial(attached)).toBe(true);
  });

  it('grows the special array by max(3, n), reuses inactive elements and keeps indices stable', () => {
    const { ctx } = merchantFixture(t);
    const glock = itemId(t, 'GLOCK_17');
    const h = header(ctx.state, TONY, glock);
    expect(addItemToArmsDealerInventory(ctx, TONY, glock, used(50), 1)).toBe(0);
    expect(h.specials).toHaveLength(3);
    expect(addItemToArmsDealerInventory(ctx, TONY, glock, used(60), 1)).toBe(1);
    removeItemFromArmsDealerInventory(ctx, TONY, glock, used(50), 1);
    expect(h.specials[0]?.active).toBe(false);
    expect(h.specials[1]?.info.condition).toBe(60);
    expect(addItemToArmsDealerInventory(ctx, TONY, glock, used(70), 1)).toBe(0);
    expect(addItemToArmsDealerInventory(ctx, TONY, glock, used(70), 5)).toBe(6);
    expect(h.specials).toHaveLength(3 + 4);
    expect(h.total).toBe(7);
    expect(activeSpecials(h)).toBe(7);
  });

  it('removes the first byte-equal special elements', () => {
    const { ctx } = merchantFixture(t);
    const glock = itemId(t, 'GLOCK_17');
    addItemToArmsDealerInventory(ctx, TONY, glock, used(40), 1);
    addItemToArmsDealerInventory(ctx, TONY, glock, used(50), 1);
    addItemToArmsDealerInventory(ctx, TONY, glock, used(40), 1);
    removeItemFromArmsDealerInventory(ctx, TONY, glock, used(40), 1);
    const h = header(ctx.state, TONY, glock);
    expect(h.specials.map((s) => (s.active ? s.info.condition : 0))).toEqual([0, 50, 40]);
  });

  it('caps a type at 255 units and lets the excess vanish', () => {
    const { ctx } = merchantFixture(t);
    const beer = itemId(t, 'BEER');
    addItemToArmsDealerInventory(ctx, FRANK, beer, defaultItemInfo(), 250);
    addItemToArmsDealerInventory(ctx, FRANK, beer, defaultItemInfo(), 10);
    expect(header(ctx.state, FRANK, beer)).toMatchObject({ total: 255, perfect: 255 });
  });

  it('turns stray rounds into full magazines', () => {
    const { ctx } = merchantFixture(t);
    const clip = itemId(t, 'CLIP9_15');
    addAmmoToArmsDealerInventory(ctx, TONY, clip, 10);
    expect(header(ctx.state, TONY, clip)).toMatchObject({ total: 0, strayAmmo: 10 });
    addAmmoToArmsDealerInventory(ctx, TONY, clip, 10);
    expect(header(ctx.state, TONY, clip)).toMatchObject({ total: 1, perfect: 1, strayAmmo: 5 });
    addAmmoToArmsDealerInventory(ctx, TONY, clip, 31);
    expect(header(ctx.state, TONY, clip)).toMatchObject({ total: 3, strayAmmo: 6 });
  });

  it('splits a sold gun into the gun, its bullets and every detachable attachment', () => {
    const { ctx } = merchantFixture(t);
    const m14 = createItem(t.items, itemId(t, 'M14'), 79);
    m14.imprintId = 7;
    m14.gunShotsLeft = 20;
    const scope = m14.attachments[0];
    const spring = m14.attachments[1];
    if (scope && spring) {
      scope.item = itemId(t, 'SNIPERSCOPE');
      scope.status = 90;
      spring.item = itemId(t, 'SPRING_AND_BOLT_UPGRADE');
      spring.status = 100;
    }
    addObjectToArmsDealerInventory(ctx, TONY, m14);
    const gun = header(ctx.state, TONY, itemId(t, 'M14')).specials[0];
    expect(gun?.info).toMatchObject({ condition: 79, imprint: 7 });
    expect(gun?.info.attachments).toEqual([itemId(t, 'SNIPERSCOPE'), itemId(t, 'SPRING_AND_BOLT_UPGRADE'), 0, 0]);
    expect(header(ctx.state, TONY, itemId(t, 'SNIPERSCOPE')).specials[0]?.info.condition).toBe(90);
    expect(header(ctx.state, TONY, itemId(t, 'SPRING_AND_BOLT_UPGRADE')).total).toBe(0);
    expect(header(ctx.state, TONY, m14.gunAmmoItem).total).toBe(1);
  });

  it('sells stacks member by member with the stack attachments and keeps no launcher payload', () => {
    const { ctx } = merchantFixture(t);
    const launcher = createItem(t.items, itemId(t, 'GLAUNCHER'), 90);
    launcher.gunAmmoItem = itemId(t, 'GL_HE_GRENADE');
    addObjectToArmsDealerInventory(ctx, KEITH, launcher);
    expect(header(ctx.state, KEITH, itemId(t, 'GLAUNCHER')).specials[0]?.info.condition).toBe(90);
    expect(header(ctx.state, KEITH, itemId(t, 'GL_HE_GRENADE')).total).toBe(0);
    const kits = createItems(t.items, itemId(t, 'FIRSTAIDKIT'), 100, 3);
    kits.status = [100, 50, 100];
    addObjectToArmsDealerInventory(ctx, KEITH, kits);
    expect(header(ctx.state, KEITH, itemId(t, 'FIRSTAIDKIT'))).toMatchObject({ total: 3, perfect: 2 });
  });

  it('makes objects without bullets for guns and with the stored status', () => {
    const info = used(-45);
    info.imprint = NO_PROFILE;
    const o = makeObjectOutOfDealerItems(t.items, itemId(t, 'GLOCK_17'), info, 1);
    expect(o).toMatchObject({ count: 1, gunShotsLeft: 0 });
    expect(o.status[0]).toBe(45);
    expect(specialItemInfoFromObject(t.items, createItems(t.items, itemId(t, 'CLIP9_15'), 100, 2)).condition).toBe(100);
  });

  it('draws a used condition for damageable, non-liquid stock of used-item dealers', () => {
    const rolls = queued(10, 30, 70);
    const { ctx } = merchantFixture(t, { random: rolls });
    armsDealerGetsFreshStock(ctx, TONY, itemId(t, 'GLOCK_17'), 2);
    expect(rolls.ranges).toEqual([100, 60, 100]);
    expect(header(ctx.state, TONY, itemId(t, 'GLOCK_17'))).toMatchObject({ total: 2, perfect: 1 });
    expect(header(ctx.state, TONY, itemId(t, 'GLOCK_17')).specials[0]?.info.condition).toBe(50);
    const none = queued();
    const frank = merchantFixture(t, { random: none });
    armsDealerGetsFreshStock(frank.ctx, FRANK, itemId(t, 'BEER'), 4);
    expect(none.ranges).toEqual([]);
  });

  it('removes a random unit, perfect or special, and counts distinct boxes', () => {
    const rolls = queued(2);
    const { ctx } = merchantFixture(t, { random: rolls });
    const glock = itemId(t, 'GLOCK_17');
    addItemToArmsDealerInventory(ctx, TONY, glock, defaultItemInfo(), 2);
    addItemToArmsDealerInventory(ctx, TONY, glock, used(30), 1);
    addItemToArmsDealerInventory(ctx, TONY, itemId(t, 'CLIP9_15'), defaultItemInfo(), 5);
    expect(countDistinctItemsInArmsDealersInventory(ctx, TONY)).toBe(4);
    removeRandomItemFromArmsDealerInventory(ctx, TONY, glock, 1);
    expect(rolls.ranges).toEqual([3]);
    expect(header(ctx.state, TONY, glock)).toMatchObject({ total: 2, perfect: 2 });
  });
});
