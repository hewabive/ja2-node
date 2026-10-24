import { describe, expect, it } from 'vitest';
import type { BobbyRayStockView } from '../../../../protocol/view.ts';
import { cartSubtotal, padded, pageCount, pageEntries } from './bobby-ray-catalogue.ts';
import { perUnitRate } from './bobby-ray-order.ts';
import { BobbyRayCart, MAX_PURCHASE_AMOUNT } from './bobby-ray-session.ts';
import { lastActiveShipment } from './bobby-ray-shipments.ts';

const GUN = 0x2;
const KEY = 0x10000;

function stock(slot: number, item: number, quantity = 3, catalogue: BobbyRayStockView['catalogue'] = 'guns'): BobbyRayStockView {
  return { item, name: `item ${item}`, price: 100 + item, quantity, quality: 100, slot, catalogue };
}

describe("the Bobby Ray's cart", () => {
  it('grows a line while the stock covers it and refuses the eleventh line', () => {
    const cart = new BobbyRayCart();
    const pistol = stock(4, 7, 2);
    expect(cart.purchase(pistol, false)).toBeNull();
    expect(cart.purchase(pistol, false)).toBeNull();
    expect(cart.purchase(pistol, false)).toBe('noMoreInStock');
    expect(cart.count(4, false)).toBe(2);
    expect(cart.count(4, true)).toBeNull();
    for (let slot = 10; slot < 10 + MAX_PURCHASE_AMOUNT - 1; slot++) expect(cart.purchase(stock(slot, slot), false)).toBeNull();
    expect(cart.purchase(stock(30, 30), false)).toBe('tooManyLines');
    expect(cart.orderLines()[0]).toEqual({ item: 7, used: false, quantity: 2 });
  });

  it('frees a line when its last unit is put back and takes the first free entry again', () => {
    const cart = new BobbyRayCart();
    cart.purchase(stock(4, 7), false);
    cart.purchase(stock(5, 8), true);
    cart.unpurchase(4, false);
    expect(cart.lines[0]?.count).toBe(0);
    cart.purchase(stock(6, 9), false);
    expect(cart.lines[0]?.item).toBe(9);
    expect(cart.orderLines()).toEqual([
      { item: 9, used: false, quantity: 1 },
      { item: 8, used: true, quantity: 1 },
    ]);
  });

  it('clears the cart, the speed and the city on a new laptop session or the clear button', () => {
    const cart = new BobbyRayCart();
    cart.purchase(stock(4, 7), false);
    cart.speed = 2;
    cart.cities.stepDown();
    cart.clear();
    expect([cart.empty, cart.speed, cart.cities.selected]).toEqual([true, 0, -1]);
  });

  it('sums the subtotal from the current unit prices', () => {
    const cart = new BobbyRayCart();
    cart.purchase(stock(4, 7), false);
    cart.purchase(stock(4, 7), false);
    expect(cartSubtotal(cart, (_slot, _used, item) => item * 10)).toBe(140);
  });
});

describe("the Bobby Ray's catalogue pages", () => {
  it('starts each page at the n-th entry of the catalogue and fills four rows of shown classes', () => {
    const list = [stock(0, 1), stock(1, 2), stock(2, 3, 1, 'ammo'), stock(3, 4), stock(4, 5), stock(5, 6), stock(6, 7)];
    const classOf = (item: number) => (item === 5 ? KEY : GUN);
    const first = pageEntries(list, 'guns', 0, classOf);
    expect(first.matching).toHaveLength(6);
    expect(first.shown.map((s) => s.item)).toEqual([1, 2, 4, 6]);
    expect(pageEntries(list, 'guns', 1, classOf).shown.map((s) => s.item)).toEqual([6, 7]);
    expect(pageCount(6)).toBe(2);
    expect(pageCount(8)).toBe(2);
    expect(pageCount(0)).toBe(0);
  });

  it('pads numbers like the original format strings', () => {
    expect(padded(3, 4)).toBe('   3');
    expect(padded(1234, 3)).toBe('1234');
  });

  it('prints the shipping rate per pound by truncating the float division', () => {
    expect(perUnitRate(200, true)).toBe(200);
    expect(perUnitRate(200, false)).toBe(90);
  });

  it('selects the last active shipment on entry', () => {
    const shipment = (active: boolean) => ({ active, displayed: true }) as unknown as Parameters<typeof lastActiveShipment>[0][number];
    expect(lastActiveShipment([shipment(true), shipment(true), shipment(false)])).toBe(1);
    expect(lastActiveShipment([shipment(false)])).toBe(-1);
  });
});
