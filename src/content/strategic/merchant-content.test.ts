import { beforeAll, describe, expect, it } from 'vitest';
import { itemId, loadMerchantTestContent, type MerchantTestContent } from '../../../tests/support/merchants.ts';
import {
  DealerFlag,
  DealerType,
  dealerByProfile,
  doesItemAppearInDealerInventoryList,
  hasDealerFlag,
  maxItemAmount,
  NUM_ARMS_DEALERS,
  weaponSaleModifier,
} from './merchant-content.ts';

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

const FLO = 44;
const IVAN = 7;

describe('merchant content from data/externalized', () => {
  it('loads the 19 dealers in file order with their profiles, types and cash', () => {
    const dealers = t.content.dealers;
    expect(dealers).toHaveLength(NUM_ARMS_DEALERS);
    expect(dealers.map((d) => d.profileName)).toEqual([
      'TONY',
      'FRANZ',
      'KEITH',
      'JAKE',
      'GABBY',
      'DEVIN',
      'HOWARD',
      'SAM',
      'FRANK',
      'HERVE',
      'PETER',
      'ALBERTO',
      'CARLO',
      'MICKY',
      'ARNIE',
      'FREDO',
      'PERKO',
      'DRUGGIST',
      'MANNY',
    ]);
    expect(dealers[0]).toMatchObject({ id: 0, profile: 91, type: DealerType.BUYS_SELLS, initialCash: 15000 });
    expect(dealers[13]).toMatchObject({ type: DealerType.BUYS_ONLY, initialCash: 10000 });
    expect(dealers[14]).toMatchObject({ type: DealerType.REPAIRS, initialCash: 1500 });
    expect(dealerByProfile(t.content, 74)?.id).toBe(16);
  });

  it('keeps the multipliers as single-precision floats', () => {
    const [tony, , , jake, , , , , , , , , , micky, arnie, fredo, perko] = t.content.dealers;
    expect(tony?.buyingPrice).toBe(0.75);
    expect(tony?.sellingPrice).toBe(1.25);
    expect(jake?.sellingPrice).toBe(Math.fround(1.1));
    expect(jake?.buyingPrice).toBe(Math.fround(0.8));
    expect(micky?.sellingPrice).toBe(Math.fround(1.4));
    expect(arnie).toMatchObject({ repairSpeed: Math.fround(0.1), repairCost: Math.fround(0.8) });
    expect(fredo).toMatchObject({ repairSpeed: Math.fround(0.6), repairCost: Math.fround(0.6) });
    expect(perko).toMatchObject({ repairSpeed: 1, repairCost: Math.fround(0.4) });
  });

  it('parses the flags of each dealer', () => {
    const [tony, franz, keith, jake, , , , , frank, , , , , micky, , fredo, perko] = t.content.dealers;
    expect(tony?.flags).toBe(DealerFlag.SOME_USED_ITEMS | DealerFlag.GIVES_CHANGE);
    expect(franz && hasDealerFlag(franz, DealerFlag.BUYS_EVERYTHING)).toBe(true);
    expect(keith && hasDealerFlag(keith, DealerFlag.ONLY_USED_ITEMS)).toBe(true);
    expect(jake && hasDealerFlag(jake, DealerFlag.SELLS_FUEL)).toBe(true);
    expect(frank?.flags).toBe(DealerFlag.ACCEPTS_GIFTS | DealerFlag.SELLS_ALCOHOL);
    expect(micky && hasDealerFlag(micky, DealerFlag.HAS_NO_INVENTORY)).toBe(true);
    expect(fredo && hasDealerFlag(fredo, DealerFlag.REPAIRS_ELECTRONICS)).toBe(true);
    expect(perko && hasDealerFlag(perko, DealerFlag.DELAYS_REPAIR)).toBe(true);
  });

  it('distinguishes list entries of 0 (buys, never stocks) from absent items', () => {
    const tony = t.content.dealers[0];
    if (!tony) throw new Error('no Tony');
    const rocketRifle = itemId(t, 'ROCKET_RIFLE');
    expect(maxItemAmount(tony, rocketRifle)).toBe(0);
    expect(doesItemAppearInDealerInventoryList(tony, rocketRifle, false)).toBe(false);
    expect(doesItemAppearInDealerInventoryList(tony, rocketRifle, true)).toBe(true);
    expect(doesItemAppearInDealerInventoryList(tony, itemId(t, 'CANTEEN'), true)).toBe(false);
    expect(maxItemAmount(tony, itemId(t, 'CLIP9_15'))).toBe(8);
    expect(t.content.dealers[14]?.inventory.size).toBe(0);
  });

  it('reads the weapon sale modifier with a default of 100', () => {
    expect(weaponSaleModifier(t.content, FLO)).toBe(110);
    expect(weaponSaleModifier(t.content, IVAN)).toBe(100);
  });

  it('resolves the transcribed tables', () => {
    const tables = t.content.tables;
    expect(tables.dealerIds).toMatchObject({ BOBBYR: -1, TONY: 0, MICKY: 13, PERKO: 16, MANNY: 18 });
    expect(tables.categories.BIG_GUNS).toBe(
      tables.categories.SMGCLASS | tables.categories.RIFLECLASS | tables.categories.MGCLASS | tables.categories.SHOTGUNCLASS,
    );
    expect(tables.misc.byItem.get(itemId(t, 'BEER'))).toBe(tables.categories.ALCOHOL);
    expect(tables.face.byItem.get(itemId(t, 'NIGHTGOGGLES'))).toBe(tables.categories.ELECTRONICS);
    expect(tables.staples.has(itemId(t, 'JAR_CREATURE_BLOOD'))).toBe(true);
    expect(tables.liquids.has(itemId(t, 'GAS_CAN'))).toBe(true);
    expect(tables.liquids.has(itemId(t, 'WINE'))).toBe(false);
    expect(tables.sortCategories).toHaveLength(20);
  });
});
