import { beforeAll, describe, expect, it } from 'vitest';
import { itemId, loadMerchantTestContent, type MerchantTestContent, merchantFixture } from '../../../../../tests/support/merchants.ts';
import { createItem, type ItemObject } from '../../../items/object.ts';
import { isMercADealer } from './context.ts';
import { addDeadArmsDealerItemsToWorld } from './death.ts';
import { addItemToArmsDealerInventory } from './inventory.ts';
import { giveObjectToArmsDealerForRepair } from './repair.ts';
import { defaultItemInfo, header } from './state.ts';

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

const SAM = 7;
const SAM_PROFILE = 126;
const PERKO = 16;
const PERKO_PROFILE = 74;
const MANNY = 18;
const MANNY_PROFILE = 155;
const IVAN = 7;
const NOT_A_DEALER = 3;

describe('dead dealers', () => {
  it('drop their stock in pocket-sized stacks, then specials and cash, and go out of business', () => {
    const { ctx } = merchantFixture(t);
    const jar = itemId(t, 'JAR');
    const crowbar = itemId(t, 'CROWBAR');
    addItemToArmsDealerInventory(ctx, SAM, jar, defaultItemInfo(), 5);
    addItemToArmsDealerInventory(ctx, SAM, crowbar, { ...defaultItemInfo(), condition: 40 }, 1);
    const status = ctx.state.dealers[SAM]?.status;
    if (status) status.cash = 3000;
    const dropped: ItemObject[] = [];
    expect(addDeadArmsDealerItemsToWorld(ctx, NOT_A_DEALER, (o) => dropped.push(o))).toBe(false);
    expect(addDeadArmsDealerItemsToWorld(ctx, SAM_PROFILE, (o) => dropped.push(o))).toBe(true);
    expect(dropped.map((o) => [t.items.byIndex.get(o.item)?.name, o.count, o.status[0], o.money])).toEqual([
      ['JAR', 2, 100, 0],
      ['JAR', 2, 100, 0],
      ['JAR', 1, 100, 0],
      ['CROWBAR', 1, 40, 0],
      ['MONEY', 1, 100, 3000],
    ]);
    expect(status).toMatchObject({ outOfBusiness: true, cash: 0 });
    expect(header(ctx.state, SAM, crowbar)).toMatchObject({ total: 0, specials: [] });
  });

  it('include Manny before he tends the bar: his stock drops and his shop closes for good', () => {
    const { ctx } = merchantFixture(t);
    const beer = itemId(t, 'BEER');
    addItemToArmsDealerInventory(ctx, MANNY, beer, defaultItemInfo(), 2);
    expect(isMercADealer(ctx, MANNY_PROFILE)).toBe(false);
    const dropped: ItemObject[] = [];
    expect(addDeadArmsDealerItemsToWorld(ctx, MANNY_PROFILE, (o) => dropped.push(o))).toBe(true);
    expect(dropped.map((o) => [t.items.byIndex.get(o.item)?.name, o.count])).toEqual([['BEER', 2]]);
    expect(ctx.state.dealers[MANNY]?.status.outOfBusiness).toBe(true);
  });

  it('return items in repair unrepaired', () => {
    const { ctx } = merchantFixture(t);
    giveObjectToArmsDealerForRepair(ctx, PERKO, createItem(t.items, itemId(t, 'GLOCK_17'), 35), IVAN);
    const dropped: ItemObject[] = [];
    addDeadArmsDealerItemsToWorld(ctx, PERKO_PROFILE, (o) => dropped.push(o));
    expect(dropped.map((o) => [t.items.byIndex.get(o.item)?.name, o.status[0], o.gunShotsLeft])).toEqual([['GLOCK_17', 35, 0]]);
  });
});
