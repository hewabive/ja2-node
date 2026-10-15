import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import {
  AmmoType,
  ArmourClass,
  handClass,
  ItemClass,
  ItemCursor,
  isClass,
  isTwoHanded,
  itemIndex,
  loadItemTable,
  WeaponClass,
} from './items.ts';

describe('item table', async () => {
  const table = await loadItemTable(async (path) => readDataJson(path));
  const get = (name: string) => {
    const def = table.byName.get(name);
    if (!def) throw new Error(name);
    return def;
  };

  it('merges every item source without index clashes', () => {
    expect(table.byIndex.size).toBe(306);
    expect(get('NOTHING').index).toBe(0);
    expect(itemIndex(table, 'GLOCK_17')).toBe(1);
  });

  it('classifies weapons like the original item table', () => {
    const glock = get('GLOCK_17');
    expect(glock.itemClass).toBe(ItemClass.GUN);
    expect(glock.cursor).toBe(ItemCursor.TARGET);
    expect(glock.weapon?.weaponClass).toBe(WeaponClass.HANDGUN);
    expect(get('GLAUNCHER').itemClass).toBe(ItemClass.LAUNCHER);
    expect(get('GLAUNCHER').weapon?.explosiveCalibre).toBe('40MM_GRENADE');
    expect(get('ROCK').itemClass).toBe(ItemClass.THROWN);
    expect(get('COMBAT_KNIFE').weapon?.weaponClass).toBe(WeaponClass.KNIFE);
    expect(isClass(table, itemIndex(table, 'THROWING_KNIFE'), ItemClass.THROWING_KNIFE)).toBe(true);
    expect(get('BERETTA_93R').weapon?.attachments).toContain('SILENCER');
  });

  it('links magazines, armour and explosives to their parameters', () => {
    const clip = get('CLIP9_30_HP');
    expect(clip.itemClass).toBe(ItemClass.AMMO);
    expect(clip.magazine).toMatchObject({ capacity: 30, ammoType: AmmoType.HP });
    expect(clip.magazine?.calibre).toBe(get('GLOCK_17').weapon?.calibre);
    expect(get('KEVLAR_VEST_Y').armour).toMatchObject({ armourClass: ArmourClass.VEST, protection: 24 });
    const grenade = get('HAND_GRENADE');
    expect(grenade.itemClass).toBe(ItemClass.GRENADE);
    expect(grenade.explosive?.blast).toEqual({ damage: 25, radius: 4, structuralDamageDivisor: 3 });
    expect(get('SMOKE_GRENADE').explosive?.smoke?.type).toBe('SMOKE');
    expect(get('MINE').explosive?.pressureTriggered).toBe(true);
  });

  it('chooses the hand animation class from item class and handedness', () => {
    expect(handClass(table, itemIndex(table, 'GLOCK_17'))).toBe('pistol');
    expect(handClass(table, itemIndex(table, 'FNFAL'))).toBe('rifle');
    expect(isTwoHanded(table, itemIndex(table, 'FNFAL'))).toBe(true);
    expect(handClass(table, itemIndex(table, 'ROCKET_LAUNCHER'))).toBe('nothing');
    expect(handClass(table, itemIndex(table, 'COMBAT_KNIFE'))).toBe('nothing');
    expect(handClass(table, 0)).toBe('nothing');
  });
});
