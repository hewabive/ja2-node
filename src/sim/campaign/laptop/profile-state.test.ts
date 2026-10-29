import { describe, expect, it } from 'vitest';
import { ItemClass, type ItemDef, type ItemTable } from '../../../content/items/items.ts';
import { InvSlot } from '../../tactical/inventory.ts';
import { MercStatus, type ProfileProgress } from '../../tactical/profiles.ts';
import { initProfileFromContent } from '../profiles.ts';
import { emptyProfile } from './imp.ts';
import { calcCompetence, calcMedicalDeposit, isMercHireable } from './profile-state.ts';

const KIT_ITEM = 201;
const KIT_ITEM_PRICE = 250;

function profile(stats: Partial<ProfileProgress['stats']>, traits: [number, number] = [0, 0]): ProfileProgress {
  return {
    stats: {
      lifeMax: 84,
      agility: 81,
      dexterity: 78,
      wisdom: 74,
      medical: 31,
      explosives: 22,
      mechanical: 28,
      marksmanship: 83,
      experience: 3,
      strength: 72,
      leadership: 61,
      ...stats,
    },
    skillTrait: traits[0],
    skillTrait2: traits[1],
  } as ProfileProgress;
}

describe('the A.I.M. medical deposit', () => {
  it('follows CalcCompetence with integer stats, truncated skills and the fifth root of the level', () => {
    expect(calcCompetence(profile({}))).toBe(329);
    expect(calcMedicalDeposit(profile({}))).toBe(1600);
  });

  it('adds five percent per skill trait and uses the table at levels 1 and 10', () => {
    expect(calcCompetence(profile({}, [1, 0]))).toBe(346);
    expect(calcCompetence(profile({}, [1, 2]))).toBe(362);
    expect(calcCompetence(profile({ experience: 1 }))).toBe(245);
    expect(calcCompetence(profile({ experience: 10 }))).toBe(479);
  });

  it('rounds the deposit to the nearest hundred, half up', () => {
    expect(calcMedicalDeposit(profile({ marksmanship: 50, medical: 0, mechanical: 0, explosives: 0 }))).toBe(300);
  });
});

describe('IsMercHireable', () => {
  it('accepts the available and the slightly annoyed only while the countdown is zero', () => {
    expect(isMercHireable({ mercStatus: MercStatus.OK, dayBecomesAvailable: 0 })).toBe(true);
    expect(isMercHireable({ mercStatus: MercStatus.ANNOYED_BUT_CAN_STILL_CONTACT, dayBecomesAvailable: 0 })).toBe(true);
    expect(isMercHireable({ mercStatus: MercStatus.ANNOYED_WONT_CONTACT, dayBecomesAvailable: 0 })).toBe(true);
    expect(isMercHireable({ mercStatus: MercStatus.OK, dayBecomesAvailable: 2 })).toBe(false);
    for (const status of [7, -1, -4, -5, -6, -7, -8]) expect(isMercHireable({ mercStatus: status, dayBecomesAvailable: 0 })).toBe(false);
  });
});

describe('the A.I.M. kit price', () => {
  it('adds one price per inventory slot, whatever the number of items in the slot', () => {
    const kitItem = { price: KIT_ITEM_PRICE, itemClass: ItemClass.MEDKIT } as ItemDef;
    const items = { byIndex: new Map([[KIT_ITEM, kitItem]]) } as unknown as ItemTable;
    const record = emptyProfile(0);
    const inventory = [...record.inventory];
    const inventoryCount = [...record.inventoryCount];
    inventory[InvSlot.BIGPOCK1] = KIT_ITEM;
    inventoryCount[InvSlot.BIGPOCK1] = 3;
    inventory[InvSlot.BIGPOCK2] = KIT_ITEM;
    inventoryCount[InvSlot.BIGPOCK2] = 1;
    const p = initProfileFromContent({ ...record, inventory, inventoryCount }, items, true);
    expect(p.optionalGearCost).toBe(2 * KIT_ITEM_PRICE);
  });
});
