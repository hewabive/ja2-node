import { describe, expect, it } from 'vitest';
import { floristOrderMemory } from '../pages-memory.ts';
import { DestinationList, destinationListGeometry } from './destination-list.ts';
import {
  cardTextY,
  dollarsText,
  flowerOrderPrice,
  flowersOnPage,
  galleryNextEnabled,
  gallerySubPage,
  nextGalleryIndex,
  orderCheckFrames,
  orderExtras,
  previousGalleryIndex,
  SubPageVisits,
  toggleOrderCheck,
} from './florist-rules.ts';

describe('the florist gallery', () => {
  it('pages by three over ten bouquets and disables next only at the last index', () => {
    expect([0, 3, 6, 9].map(flowersOnPage)).toEqual([3, 3, 3, 1]);
    expect([0, 3, 6, 9].map(nextGalleryIndex)).toEqual([3, 6, 9, 9]);
    expect([9, 6, 3, 2, 0].map(previousGalleryIndex)).toEqual([6, 3, 0, 0, 0]);
    expect([0, 3, 6, 9].map(galleryNextEnabled)).toEqual([true, true, true, false]);
    expect([0, 3, 6, 9, 12].map(gallerySubPage)).toEqual([0, 1, 2, 3, 3]);
  });

  it('loads a sub-page slowly the first time and fast afterwards', () => {
    const visits = new SubPageVisits();
    expect([visits.visit(1), visits.visit(2), visits.visit(1)]).toEqual([false, false, true]);
  });
});

describe('the florist order form', () => {
  it('toggles the delivery pair together and each extra alone', () => {
    const order = floristOrderMemory();
    expect(orderCheckFrames(order)).toEqual([0, 1, 0, 0, 0, 0]);
    toggleOrderCheck(order, 1);
    expect(orderCheckFrames(order)).toEqual([1, 0, 0, 0, 0, 0]);
    toggleOrderCheck(order, 0);
    expect(order.nextDay).toBe(false);
    toggleOrderCheck(order, 3);
    toggleOrderCheck(order, 5);
    expect(orderCheckFrames(order)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(orderExtras(order)).toEqual(['blackRoses', 'fruitCake']);
  });

  it('adds the extras, the bouquet and the delivery of the chosen speed', () => {
    const order = { ...floristOrderMemory(), crushed: true, blackRoses: true };
    const delivery = { nextDay: 20, whenItGetsThere: 5 };
    expect(flowerOrderPrice(order, 45, delivery)).toBe(10 + 20 + 45 + 5);
    expect(flowerOrderPrice({ ...order, nextDay: true }, 45, delivery)).toBe(10 + 20 + 45 + 20);
    expect(dollarsText(80, 'USD')).toBe('$80.00 USD');
  });

  it('centres a card saying with the unsigned arithmetic of the card gallery', () => {
    expect(cardTextY(118, 30, 90)).toBe(118 + 10 + 30);
    expect(cardTextY(118, 31, 90)).toBe(118 + 10 + 29);
    expect(cardTextY(118, 94, 90)).toBe((118 + 10 + 0xfffe) & 0xffff);
  });
});

describe('the destination list', () => {
  it('measures rows of the font height + 2 and the border every 10 pixels', () => {
    expect(destinationListGeometry(17, 12, 230)).toEqual({
      rowStep: 14,
      regionHeight: 8,
      height: 17 * 14 + 10,
      topPieces: 21,
      sidePieces: 23,
    });
  });

  it('selects on hover while open and closes on a pick', () => {
    const chosen: number[] = [];
    const list = new DestinationList(['a', 'b', 'c'], 0, (i) => chosen.push(i));
    list.hover(1, true);
    expect(chosen).toEqual([]);
    list.show();
    list.hover(1, true);
    list.hover(1, false);
    expect(list.selected).toBe(1);
    list.pick(2);
    expect([list.selected, list.open, chosen]).toEqual([2, false, [1, 2]]);
    list.pick(0);
    expect(list.selected).toBe(2);
  });
});
