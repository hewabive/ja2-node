import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { ItemClass, itemIndex, loadItemTable, NOTHING } from '../../content/items/items.ts';
import { Rng } from '../../core/rng.ts';
import { createItem, ObjectFlags } from '../items/object.ts';
import { createEquipmentState, generateRandomEquipment, randomMagazine, replaceExtendedGuns } from './equipment.ts';
import { emptyInventory, InvSlot } from './inventory.ts';
import { Body, SoldierClass } from './soldier.ts';

describe('enemy equipment', async () => {
  const items = await loadItemTable(async (path) => readDataJson(path));
  const id = (name: string) => itemIndex(items, name);
  const target = (soldierClass: number, bodyType: number = Body.REGMALE) => ({
    inv: emptyInventory(),
    soldierClass,
    bodyType,
    experience: 5,
    marksmanship: 70,
  });

  it('arms a poorly rated trooper from the bottom gun tier with spare clips in a small pocket', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const t = target(SoldierClass.ARMY);
      generateRandomEquipment(items, Rng.fromSeed(seed), createEquipmentState(items), t, 0, 10);
      const gun = t.inv[InvSlot.HAND];
      expect([id('SW38'), id('DESERTEAGLE'), id('GLOCK_17'), id('BERETTA_93R')]).toContain(gun?.item);
      expect(gun?.status[0]).toBeGreaterThanOrEqual(70);
      const clips = t.inv[InvSlot.SMALLPOCK1];
      expect(items.byIndex.get(clips?.item ?? NOTHING)?.itemClass).toBe(ItemClass.AMMO);
      expect(clips?.count).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives elites armour, face gear and at least one grenade', () => {
    const t = target(SoldierClass.ELITE);
    generateRandomEquipment(items, Rng.fromSeed(4), createEquipmentState(items), t, 2, 50);
    expect(t.inv[InvSlot.HAND]?.item).not.toBe(NOTHING);
    expect(t.inv[InvSlot.VEST]?.item).not.toBe(NOTHING);
    expect([id('GASMASK'), id('EXTENDEDEAR')]).toContain(t.inv[InvSlot.HEAD1]?.item);
    expect([id('NIGHTGOGGLES'), id('UVGOGGLES')]).toContain(t.inv[InvSlot.HEAD2]?.item);
    expect(t.inv.some((o) => (items.byIndex.get(o.item)?.itemClass ?? 0) & (ItemClass.GRENADE | ItemClass.LAUNCHER))).toBe(true);
  });

  it('keeps locked slots and only adds spare clips for a pre-selected gun', () => {
    const t = target(SoldierClass.ARMY);
    const locked = createItem(items, id('FNFAL'), 90);
    locked.flags |= ObjectFlags.NO_OVERWRITE;
    t.inv[InvSlot.HAND] = locked;
    generateRandomEquipment(items, Rng.fromSeed(9), createEquipmentState(items), t, 1, 30);
    expect(t.inv[InvSlot.HAND]?.item).toBe(id('FNFAL'));
    const clips = t.inv.filter((o) => items.byIndex.get(o.item)?.magazine);
    expect(clips.every((o) => items.byIndex.get(o.item)?.magazine?.calibre === items.byIndex.get(id('FNFAL'))?.weapon?.calibre)).toBe(true);
  });

  it('marks the first gun of each type as droppable once per campaign', () => {
    const state = createEquipmentState(items);
    const first = target(SoldierClass.ARMY);
    generateRandomEquipment(items, Rng.fromSeed(2), state, first, 4, 30);
    const gun = first.inv[InvSlot.HAND];
    if (gun && !state.weaponsAlreadyDropped.has(NOTHING)) expect(state.weaponsAlreadyDropped.has(gun.item)).toBe(true);
    expect(state.weaponsAlreadyDropped.has(id('SW38'))).toBe(true);
    expect(state.weaponsAlreadyDropped.has(id('M1911'))).toBe(true);
  });

  it('equips tanks and leaves kids empty-handed', () => {
    const tank = target(SoldierClass.ARMY, Body.TANK_NE);
    generateRandomEquipment(items, Rng.fromSeed(1), createEquipmentState(items), tank, 2, 30);
    expect(tank.inv[InvSlot.HAND]?.item).toBe(id('TANK_CANNON'));
    const kid = target(SoldierClass.NONE, Body.KIDCIV);
    generateRandomEquipment(items, Rng.fromSeed(1), createEquipmentState(items), kid, 2, 30);
    expect(kid.inv.every((o) => o.item === NOTHING)).toBe(true);
  });

  it('replaces big-list guns and their magazines on static placements', () => {
    const inv = emptyInventory();
    inv[InvSlot.HAND] = createItem(items, id('M1911'), 80);
    inv[InvSlot.SMALLPOCK1] = createItem(items, id('CLIP45_7'), 100);
    replaceExtendedGuns(items, Rng.fromSeed(1), createEquipmentState(items), inv, SoldierClass.NONE);
    expect(inv[InvSlot.HAND]?.item).toBe(id('GLOCK_17'));
    expect(inv[InvSlot.HAND]?.status[0]).toBe(80);
    expect(inv[InvSlot.SMALLPOCK1]?.item).toBe(id('CLIP9_15'));
  });

  it('picks the standard magazine or one of the alternatives', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) seen.add(randomMagazine(items, Rng.fromSeed(seed), id('GLOCK_17'), 50));
    expect(seen.has(id('CLIP9_15'))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
});
