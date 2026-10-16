import { beforeAll, describe, expect, it } from 'vitest';
import { itemId, loadMerchantTestContent, type MerchantTestContent, queued } from '../../../../../tests/support/merchants.ts';
import { RecordingRolls } from '../../../../../tests/support/queen.ts';
import type { RollSource } from '../../forces/ports.ts';
import {
  BOBBY_RAY,
  canDealerItemBeSoldUsed,
  chanceOfItemTransaction,
  compareItemsForSorting,
  currentSuitabilityForItem,
  DEALER_BUYING,
  DEALER_SELLING,
  determineInitialInvItems,
  howManyItemsToReorder,
  itemTransactionOccurs,
  Suitability,
  type SupplyContext,
} from './supply.ts';

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

const TONY = 0;
const FRANZ = 1;
const DEVIN = 5;

function supply(progress = 0, random: RollSource = RecordingRolls.zeros(), gunNut = false): SupplyContext {
  return { items: t.items, content: t.content, random, gunNut, highestProgress: progress };
}

function itemOfCoolness(coolness: number): number {
  const def = t.items.ordered.find(
    (d) => d.coolness === coolness && d.price > 0 && !(d.flags & 0x0500) && !t.content.tables.staples.has(d.index) && d.weapon,
  );
  if (!def) throw new Error(`no item of coolness ${coolness}`);
  return def.index;
}

describe('dealer supply', () => {
  it('rates suitability by the coolness window of Bobby Ray, Tony and Devin', () => {
    const c = (k: number) => itemOfCoolness(k);
    expect([1, 2, 3, 4].map((k) => currentSuitabilityForItem(supply(0), BOBBY_RAY, c(k)))).toEqual([
      Suitability.HIGH,
      Suitability.HIGH,
      Suitability.NONE,
      Suitability.NONE,
    ]);
    expect([1, 2, 3, 4].map((k) => currentSuitabilityForItem(supply(0), TONY, c(k)))).toEqual([
      Suitability.HIGH,
      Suitability.HIGH,
      Suitability.NONE,
      Suitability.NONE,
    ]);
    expect([1, 3, 4, 5].map((k) => currentSuitabilityForItem(supply(0), DEVIN, c(k)))).toEqual([
      Suitability.MEDIUM,
      Suitability.HIGH,
      Suitability.HIGH,
      Suitability.NONE,
    ]);
    expect([2, 4, 5, 6].map((k) => currentSuitabilityForItem(supply(35), TONY, c(k)))).toEqual([
      Suitability.MEDIUM,
      Suitability.HIGH,
      Suitability.HIGH,
      Suitability.NONE,
    ]);
    expect([4, 5, 7, 8].map((k) => currentSuitabilityForItem(supply(70), BOBBY_RAY, c(k)))).toEqual([
      Suitability.LOW,
      Suitability.MEDIUM,
      Suitability.HIGH,
      Suitability.HIGH,
    ]);
    expect(currentSuitabilityForItem(supply(0), FRANZ, c(8))).toBe(Suitability.HIGH);
  });

  it('puts the not-buyable and coolness-0 tests before the staples', () => {
    expect(currentSuitabilityForItem(supply(), TONY, itemId(t, 'JAR_CREATURE_BLOOD'))).toBe(Suitability.NONE);
    expect(currentSuitabilityForItem(supply(), TONY, itemId(t, 'CLIP9_15'))).toBe(Suitability.ALWAYS);
    expect(currentSuitabilityForItem(supply(), TONY, itemId(t, 'GAS_CAN'))).toBe(Suitability.NONE);
  });

  it('halves selling chances after the coolness bonus and halves used chances again', () => {
    const glock = itemId(t, 'GLOCK_17');
    expect(chanceOfItemTransaction(supply(), FRANZ, glock, DEALER_BUYING, false)).toBe(50);
    expect(chanceOfItemTransaction(supply(), FRANZ, glock, DEALER_SELLING, false)).toBe(30);
    expect(chanceOfItemTransaction(supply(), FRANZ, glock, DEALER_SELLING, true)).toBe(15);
    expect(chanceOfItemTransaction(supply(), BOBBY_RAY, glock, DEALER_BUYING, false)).toBe(75);
    expect(chanceOfItemTransaction(supply(), TONY, itemId(t, 'CLIP9_15'), DEALER_SELLING, false)).toBe(42);
    expect(chanceOfItemTransaction(supply(), TONY, itemId(t, 'CLIP9_15'), DEALER_BUYING, false)).toBe(100);
    expect(chanceOfItemTransaction(supply(), TONY, itemId(t, 'GAS_CAN'), DEALER_SELLING, true)).toBe(100);
    expect(chanceOfItemTransaction(supply(), TONY, itemId(t, 'MINIMI'), DEALER_BUYING, true)).toBe(0);
  });

  it('draws even at chances 0 and 100 and marks eligibility only when buying with a chance', () => {
    const rolls = queued(99, 99, 0);
    let marks = 0;
    const mark = () => {
      marks++;
      return true;
    };
    expect(itemTransactionOccurs(supply(0, rolls), TONY, itemId(t, 'GAS_CAN'), DEALER_BUYING, false, mark)).toBe(false);
    expect(itemTransactionOccurs(supply(0, rolls), TONY, itemId(t, 'CLIP9_15'), DEALER_BUYING, false, mark)).toBe(true);
    expect(itemTransactionOccurs(supply(0, rolls), TONY, itemId(t, 'CLIP9_15'), DEALER_SELLING, false, mark)).toBe(true);
    expect(rolls.ranges).toEqual([100, 100, 100]);
    expect(marks).toBe(1);
    const refused = queued();
    expect(itemTransactionOccurs(supply(0, refused), BOBBY_RAY, itemId(t, 'GLOCK_17'), DEALER_BUYING, false, () => false)).toBe(false);
    expect(refused.ranges).toEqual([]);
  });

  it('rolls initial stock per unit and reorders the shortfall plus or minus half', () => {
    const rolls = queued(10, 60, 49);
    expect(determineInitialInvItems(supply(0, rolls), FRANZ, itemId(t, 'GLOCK_17'), 3, false, () => true)).toBe(2);
    expect(howManyItemsToReorder(queued(0), 8, 1)).toBe(10);
    expect(howManyItemsToReorder(queued(1), 8, 1)).toBe(4);
    expect(howManyItemsToReorder(queued(2), 8, 1)).toBe(7);
  });

  it('sorts by category, calibre and capacity for ammo, coolness otherwise, then price, index and quality', () => {
    const tables = t.content.tables;
    const cmp = (a: string, b: string, qa = 100, qb = 100) => compareItemsForSorting(t.items, tables, itemId(t, a), itemId(t, b), qa, qb);
    expect(cmp('GLOCK_17', 'M870')).toBeLessThan(0);
    expect(cmp('CLIP9_30', 'CLIP9_15')).toBeLessThan(0);
    expect(cmp('M14', 'MINI14')).toBeLessThan(0);
    expect(cmp('GLOCK_17', 'GLOCK_17', 80, 50)).toBeLessThan(0);
    expect(cmp('GLOCK_17', 'GLOCK_17')).toBe(0);
    expect(canDealerItemBeSoldUsed(t.items, tables, itemId(t, 'GLOCK_17'))).toBe(true);
    expect(canDealerItemBeSoldUsed(t.items, tables, itemId(t, 'MINIMI'))).toBe(false);
  });
});
