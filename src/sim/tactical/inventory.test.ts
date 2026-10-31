import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import { itemIndex, loadItemTable, NOTHING } from '../../content/items/items.ts';
import { createItem, createItems, findAttachment, type ItemObject } from '../items/object.ts';
import {
  autoPlaceObject,
  type Carrier,
  emptyInventory,
  hiredMercInventory,
  type InventoryContext,
  InvSlot,
  itemIn,
  npcProfileInventory,
  placeObject,
  reducedGunListInventory,
  reloadGun,
} from './inventory.ts';

describe('soldier inventory', async () => {
  const items = await loadItemTable(async (path) => readDataJson(path));
  const id = (name: string) => itemIndex(items, name);

  function context(inCombat: boolean, ap = 20): InventoryContext & { ap: number; dropped: ItemObject[] } {
    const ctx = {
      items,
      inCombat,
      ap,
      dropped: [] as ItemObject[],
      actionPoints: () => ctx.ap,
      spendActionPoints: (n: number) => {
        ctx.ap -= n;
      },
      dropAtFeet: (o: ItemObject) => {
        ctx.dropped.push(o);
      },
    };
    return ctx;
  }

  function profile(slots: Record<number, [string, number, number]>, money = 0): MercProfile {
    const inventory = Array.from({ length: 19 }, () => 0);
    const status = Array.from({ length: 19 }, () => 0);
    const count = Array.from({ length: 19 }, () => 0);
    for (const [k, [name, st, n]] of Object.entries(slots)) {
      inventory[Number(k)] = id(name);
      status[Number(k)] = st;
      count[Number(k)] = n;
    }
    return {
      id: 4,
      inventory,
      inventoryStatus: status,
      inventoryCount: count,
      inventoryUndroppable: 0,
      money,
    } as unknown as MercProfile;
  }

  it('swaps big-list guns and their magazines for the reduced gun list', () => {
    const swapped = reducedGunListInventory(items, [id('M1911'), id('CLIP45_7'), id('MP53'), id('CLIP556_30_AP'), id('CLIP9_15')]);
    expect(swapped).toEqual([id('GLOCK_17'), id('CLIP9_15'), id('MP5K'), id('CLIP9_30_AP'), id('CLIP9_15')]);
  });

  it('auto-places a hired merc kit into hands, body slots and pockets', () => {
    const inv = hiredMercInventory(
      context(false),
      profile({
        0: ['STEEL_HELMET', 99, 1],
        1: ['KEVLAR_VEST', 100, 1],
        5: ['M1911', 100, 1],
        7: ['M1911', 100, 1],
        8: ['CLIP45_7', 100, 6],
        9: ['TOOLKIT', 98, 1],
        10: ['HAND_GRENADE', 100, 1],
      }),
      true,
    );
    expect(itemIn(inv, InvSlot.HELMET)).toBe(id('STEEL_HELMET'));
    expect(itemIn(inv, InvSlot.VEST)).toBe(id('KEVLAR_VEST'));
    expect(itemIn(inv, InvSlot.HAND)).toBe(id('GLOCK_17'));
    expect(itemIn(inv, InvSlot.SECOND_HAND)).toBe(id('GLOCK_17'));
    expect(inv[InvSlot.SMALLPOCK1]).toMatchObject({ item: id('CLIP9_15'), count: 4 });
    expect(inv[InvSlot.SMALLPOCK2]).toMatchObject({ item: id('CLIP9_15'), count: 2 });
    expect(itemIn(inv, InvSlot.BIGPOCK1)).toBe(id('TOOLKIT'));
    expect(inv[InvSlot.SMALLPOCK3]).toMatchObject({ item: id('HAND_GRENADE'), count: 1 });
  });

  it('attaches a detonator to the explosive it fits when hiring', () => {
    const inv = hiredMercInventory(context(false), profile({ 8: ['TNT', 100, 1], 9: ['DETONATOR', 100, 1] }), true);
    const tnt = inv.find((o) => o.item === id('TNT'));
    expect(tnt && findAttachment(tnt, id('DETONATOR'))).toBe(0);
    expect(inv.some((o) => o.item === id('DETONATOR'))).toBe(false);
  });

  it('copies NPC profile slots one to one and spreads money over pockets', () => {
    const inv = npcProfileInventory(items, profile({ 5: ['GLOCK_17', 90, 1] }, 25_000), true);
    expect(itemIn(inv, InvSlot.HAND)).toBe(id('GLOCK_17'));
    expect(inv[InvSlot.BIGPOCK1]).toMatchObject({ money: 20_000 });
    expect(inv[InvSlot.BIGPOCK2]).toMatchObject({ money: 5_000 });
  });

  it('moves a second-hand item to a pocket when a two-handed gun takes the main hand', () => {
    const c: Carrier = { inv: emptyInventory() };
    const ctx = context(false);
    autoPlaceObject(ctx, c, createItem(items, id('GLOCK_17'), 100));
    autoPlaceObject(ctx, c, createItem(items, id('GLOCK_17'), 100));
    const rifle = createItem(items, id('FNFAL'), 100);
    expect(placeObject(ctx, c, InvSlot.HAND, rifle)).toBe(true);
    expect(itemIn(c.inv, InvSlot.HAND)).toBe(id('FNFAL'));
    expect(itemIn(c.inv, InvSlot.SECOND_HAND)).toBe(NOTHING);
    expect(itemIn(c.inv, InvSlot.BIGPOCK1)).toBe(id('GLOCK_17'));
    expect(rifle.item).toBe(id('GLOCK_17'));
  });

  it('stacks keys only of the same lock, swapping a key of another lock (PlaceObject)', () => {
    const c: Carrier = { inv: emptyInventory() };
    const ctx = context(false);
    const key = (keyId: number, count: number) => Object.assign(createItems(items, id('KEY_1'), 100, count), { keyId });
    expect(placeObject(ctx, c, InvSlot.BIGPOCK1, key(1, 2))).toBe(true);
    const sameLock = key(1, 1);
    expect(placeObject(ctx, c, InvSlot.BIGPOCK1, sameLock)).toBe(true);
    expect(c.inv[InvSlot.BIGPOCK1]).toMatchObject({ count: 3, keyId: 1 });
    const otherLock = key(2, 1);
    expect(placeObject(ctx, c, InvSlot.BIGPOCK1, otherLock)).toBe(true);
    expect(c.inv[InvSlot.BIGPOCK1]).toMatchObject({ count: 1, keyId: 2 });
    expect(otherLock).toMatchObject({ count: 3, keyId: 1 });
  });

  it('tops off in real time and swaps magazines in combat for 5 AP', () => {
    const c: Carrier = { inv: emptyInventory() };
    const gun = createItem(items, id('GLOCK_17'), 100);
    gun.gunShotsLeft = 5;
    const mag = createItems(items, id('CLIP9_15'), 100, 1);
    expect(reloadGun(context(false), c, gun, mag)).toBe(true);
    expect(gun.gunShotsLeft).toBe(15);
    expect(mag.status[0]).toBe(5);

    const ctx = context(true, 12);
    const gun2 = createItem(items, id('GLOCK_17'), 100);
    gun2.gunShotsLeft = 3;
    const mag2 = createItems(items, id('CLIP9_15'), 100, 1);
    expect(reloadGun(ctx, c, gun2, mag2)).toBe(true);
    expect(gun2.gunShotsLeft).toBe(15);
    expect(mag2).toMatchObject({ item: id('CLIP9_15'), count: 1, status: [3] });
    expect(ctx.ap).toBe(7);
    expect(reloadGun(context(true, 4), c, gun2, mag2)).toBe(false);
  });
});
