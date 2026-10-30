import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import type { ItemTable } from '../../content/items/items.ts';
import { createItem, createItems, emptyObject } from '../items/object.ts';
import type { TacticalContent } from './content.ts';
import { emptyInventory, InvSlot, objectGrams, objectWeight } from './inventory.ts';
import { compatibleSlots, invalidPlacementSlots, soldierContainsAnyCompatibleStuff } from './item-compatibility.ts';
import { convertedWeight, gunTitle, itemCons, itemPros, ProConMessage, weaponStats, weaponTypeIndex } from './item-description.ts';

let content: TacticalContent;
let items: ItemTable;

beforeAll(async () => {
  content = await loadTestContent();
  items = content.items;
});

const index = (name: string) => items.byName.get(name)?.index ?? -1;
const make = (name: string, status = 100) => createItem(items, index(name), status);

describe('the item description box (RenderItemDescriptionBox, GenerateProsString, GenerateConsString)', () => {
  it('weighs one object with its attachments and loaded magazine, in kilograms or pounds', () => {
    const glock = make('GLOCK_17');
    expect(objectGrams(items, glock)).toBe(800);
    expect(convertedWeight(800, true)).toBeCloseTo(0.8, 10);
    expect(convertedWeight(800, false)).toBeCloseTo(800 / 453.59237, 10);
    const clips = createItems(items, index('CLIP9_15'), 100, 3);
    expect(objectWeight(items, clips)).toBe(3 * objectGrams(items, clips));
  });

  it('lists the Glock 17 pros and cons in the original order', () => {
    const glock = make('GLOCK_17');
    expect(itemPros(items, glock)).toEqual([
      ProConMessage.LIGHT,
      ProConMessage.SMALL,
      ProConMessage.QUICK_FIRING,
      ProConMessage.RELIABLE,
      ProConMessage.EASY_TO_REPAIR,
    ]);
    expect(itemCons(items, glock)).toEqual([ProConMessage.SHORT_RANGE, ProConMessage.LOW_DAMAGE, ProConMessage.NO_BURST]);
  });

  it('rates the LAW and the tank cannon by the impact and magazine their weapon models set', () => {
    const law = make('ROCKET_LAUNCHER');
    expect(itemPros(items, law)).toContain(ProConMessage.HIGH_DAMAGE);
    expect(itemCons(items, law)).not.toContain(ProConMessage.LOW_DAMAGE);
    expect(itemCons(items, law)).toContain(ProConMessage.SMALL_AMMO_CAPACITY);
    expect(weaponStats(items, law, true)?.damage).toBeUndefined();
    expect(weaponStats(items, make('TANK_CANNON'), true)?.damage).toEqual({ value: 80, exceptional: true });
  });

  it('names an empty list None and prints the weapon stats with the exceptional thresholds', () => {
    expect(itemPros(items, make('FIRSTAIDKIT'))).toEqual([ProConMessage.NONE]);
    const stats = weaponStats(items, make('GLOCK_17'), true);
    expect(stats).toMatchObject({ status: 100, range: { value: 12, exceptional: false }, damage: { value: 21, exceptional: false } });
    expect(stats?.weight.exceptional).toBe(true);
    expect(stats?.bullets).toEqual({ single: 1, burst: 0 });
    const glock18 = weaponStats(items, make('GLOCK_18'), true);
    expect(glock18?.burstAp?.value).toBeGreaterThan(glock18?.ap.value ?? 0);
    expect(weaponStats(items, make('FIRSTAIDKIT'), true)).toBeNull();
  });

  it('titles a gun with its calibre and the WeaponType index', () => {
    expect(weaponTypeIndex(items.byIndex.get(index('GLOCK_17')))).toBe(1);
    expect(weaponTypeIndex(items.byIndex.get(index('SKS')))).toBe(4);
    expect(weaponTypeIndex(items.byIndex.get(index('M14')))).toBe(6);
    expect(gunTitle(items, index('GLOCK_17'))).toEqual({ calibre: items.byIndex.get(index('GLOCK_17'))?.weapon?.calibre, weaponType: 1 });
    expect(gunTitle(items, index('COMBAT_KNIFE'))).toBeNull();
  });
});

describe('the item cursor hatches and outlines (ReevaluateItemHatches, InternalHandleCompatibleAmmoUI)', () => {
  it('hatches slots the cursor item cannot go to unless it attaches or merges there', () => {
    const inv = emptyInventory();
    inv[InvSlot.HAND] = make('GLOCK_17');
    inv[InvSlot.SMALLPOCK1] = make('CLIP9_15');
    const silencer = make('SILENCER');
    const invalid = invalidPlacementSlots(items, inv, silencer);
    expect(invalid[InvSlot.HAND]).toBe(false);
    expect(invalid[InvSlot.HELMET]).toBe(true);
    expect(invalid[InvSlot.BIGPOCK1]).toBe(false);
    const clip = make('CLIP9_15');
    expect(invalidPlacementSlots(items, inv, clip)[InvSlot.SMALLPOCK1]).toBe(false);
  });

  it('outlines matching ammo for a gun and guns for ammo, never hidden add-ons', () => {
    const inv = emptyInventory();
    inv[InvSlot.HAND] = make('GLOCK_17');
    inv[InvSlot.SMALLPOCK1] = make('CLIP9_15');
    inv[InvSlot.SMALLPOCK2] = make('CLIP762N_5_AP');
    inv[InvSlot.SMALLPOCK3] = emptyObject();
    const forGun = compatibleSlots(items, inv, index('GLOCK_17'));
    expect(forGun[InvSlot.SMALLPOCK1]).toBe(true);
    expect(forGun[InvSlot.SMALLPOCK2]).toBe(false);
    expect(compatibleSlots(items, inv, index('CLIP9_15'))[InvSlot.HAND]).toBe(true);
    expect(compatibleSlots(items, inv, index('SILENCER'))[InvSlot.HAND]).toBe(true);
    expect(soldierContainsAnyCompatibleStuff(items, inv, index('CLIP9_15'))).toBe(true);
    expect(soldierContainsAnyCompatibleStuff(items, inv, index('SILENCER'))).toBe(false);
  });
});
