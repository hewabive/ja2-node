import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { AmmoType, itemIndex, loadItemTable } from '../../content/items/items.ts';
import { createItem, createItems, createMoney, defaultMagazine, findReplacementMagazine, NO_PROFILE } from './object.ts';

describe('item objects', async () => {
  const table = await loadItemTable(async (path) => readDataJson(path));
  const id = (name: string) => itemIndex(table, name);

  it('loads a new gun with its default magazine', () => {
    const glock = createItem(table, id('GLOCK_17'), 95);
    expect(glock.status[0]).toBe(95);
    expect(glock.imprintId).toBe(NO_PROFILE);
    expect(glock.gunAmmoItem).toBe(id('CLIP9_15'));
    expect(glock.gunShotsLeft).toBe(15);
    expect(glock.gunAmmoType).toBe(AmmoType.REGULAR);
    expect(defaultMagazine(table, id('GLOCK_17'))).toBe(id('CLIP9_15'));
  });

  it('treats explosive guns and creature spit specially', () => {
    expect(createItem(table, id('ROCKET_LAUNCHER'), 100).gunShotsLeft).toBe(1);
    expect(createItem(table, id('TANK_CANNON'), 100).gunShotsLeft).toBe(0);
    expect(createItem(table, id('CREATURE_YOUNG_MALE_SPIT'), 100).gunAmmoType).toBe(AmmoType.MONSTER);
  });

  it('fills magazines, stacks and money', () => {
    expect(createItem(table, id('CLIP9_30_HP'), 100).status).toEqual([30]);
    const clips = createItems(table, id('CLIP9_15'), 100, 3);
    expect(clips.count).toBe(3);
    expect(clips.status).toEqual([15, 15, 15]);
    expect(createItem(table, id('FIRSTAIDKIT'), 0).status[0]).toBe(70);
    expect(createMoney(table, 1234).money).toBe(1234);
  });

  it('finds a replacement magazine with the same ammo type when it exists', () => {
    const glock = table.byIndex.get(id('GLOCK_17'))?.weapon;
    if (!glock) throw new Error('glock');
    expect(findReplacementMagazine(table, glock.calibre, 30, AmmoType.HP)).toBe(id('CLIP9_30_HP'));
    expect(findReplacementMagazine(table, glock.calibre, 15, AmmoType.SUPER_AP)).toBe(id('CLIP9_15'));
  });
});
