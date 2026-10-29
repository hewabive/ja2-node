import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { gridNo } from '../../../content/world/grid.ts';
import { countHospitalSupplies } from '../../campaign/narrative/quest-world.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../../tactical/content.ts';
import { CivilianGroup } from '../../tactical/soldier.ts';
import { addItemToPool, Visibility } from '../../tactical/world-items.ts';
import { Fact } from './fact-ids.ts';
import { createNarrativeState, fact, type NarrativeState, setFact, setFactFalse, setFactTrue } from './facts.ts';
import {
  calcMedicalCost,
  calcPatientMedicalCost,
  checkForMissingHospitalSupplies,
  HospitalPrice,
  medicalRequestShownCost,
  refundUnusedHospitalPayment,
  type SupplyFacts,
} from './hospital.ts';

const patient = (life: number, bleeding = 0, modifier: number = HospitalPrice.UNSET) => ({
  life,
  lifeMax: 80,
  bleeding,
  hospitalPriceModifier: modifier,
});

describe('hospital prices', () => {
  it('charges life, the points below OKLIFE and bleeding, with the discounts', () => {
    expect(calcPatientMedicalCost(patient(70), HospitalPrice.NORMAL)).toBe(100);
    expect(calcPatientMedicalCost(patient(10, 3), HospitalPrice.NORMAL)).toBe(700 + 125 + 6);
    expect(calcPatientMedicalCost(patient(70), HospitalPrice.BREAK)).toBe(85);
    expect(calcPatientMedicalCost(patient(70, 0, HospitalPrice.COST), HospitalPrice.BREAK)).toBe(70);
    expect(calcPatientMedicalCost(patient(70, 0, HospitalPrice.RANDOM_FREEBIE), HospitalPrice.NORMAL)).toBe(0);
    expect(calcPatientMedicalCost(null, HospitalPrice.NORMAL)).toBe(0);
  });

  it('rounds the total up to ten dollars and asks at least ten', () => {
    expect(calcMedicalCost([patient(79), patient(78)], HospitalPrice.BREAK)).toBe(30);
    expect(calcMedicalCost([], HospitalPrice.NORMAL)).toBe(10);
    expect(medicalRequestShownCost(120, 30)).toBe(90);
    expect(medicalRequestShownCost(120, 121)).toBe(10);
  });

  it('refunds what a leaving patient did not use and forgets his modifier', () => {
    const account = { priceModifier: HospitalPrice.NORMAL, tempBalance: 0, refund: 15 };
    const leaver = patient(60, 0, HospitalPrice.COST);
    refundUnusedHospitalPayment(account, leaver);
    expect(account.refund).toBe(15 + 140);
    expect(leaver.hospitalPriceModifier).toBe(HospitalPrice.UNSET);
  });
});

function supplyFacts(n: NarrativeState): SupplyFacts {
  return { checkFact: (id) => fact(n, id), setFactTrue: (id) => setFactTrue(n, id), setFactFalse: (id) => setFactFalse(n, id) };
}

describe('missing hospital supplies', () => {
  it('marks a theft, a big theft, and clears both once everything is back', () => {
    const n = createNarrativeState();
    checkForMissingHospitalSupplies(supplyFacts(n), 18, 17);
    expect([fact(n, Fact.PLAYER_STOLE_MEDICAL_SUPPLIES), fact(n, Fact.PLAYER_STOLE_MEDICAL_SUPPLIES_AGAIN)]).toEqual([true, false]);
    checkForMissingHospitalSupplies(supplyFacts(n), 18, 3);
    expect(fact(n, Fact.PLAYER_STOLE_MEDICAL_SUPPLIES_AGAIN)).toBe(true);
    checkForMissingHospitalSupplies(supplyFacts(n), 18, 18);
    expect([fact(n, Fact.PLAYER_STOLE_MEDICAL_SUPPLIES), fact(n, Fact.PLAYER_STOLE_MEDICAL_SUPPLIES_AGAIN)]).toEqual([false, false]);
  });

  it('keeps the first theft fact when the supplies come back without the second', () => {
    const n = createNarrativeState();
    setFact(n, Fact.PLAYER_STOLE_MEDICAL_SUPPLIES, true);
    checkForMissingHospitalSupplies(supplyFacts(n), 21, 21);
    expect(fact(n, Fact.PLAYER_STOLE_MEDICAL_SUPPLIES)).toBe(true);
  });
});

describe('counting the hospital supplies (Strategic_Event_Handler.cc CheckForMissingHospitalSupplies)', () => {
  let content: TacticalContent;

  beforeAll(async () => {
    content = await loadTestContent();
  });

  it('counts the medical items above status 60 on each tile the doctors own, once per ownership marker on it', () => {
    const t = newCombatSim(content).state;
    const item = (name: string, status = 100) => createItem(content.items, content.items.byName.get(name)?.index ?? -1, status);
    const doctorsMarker = () => {
      const marker = item('OWNERSHIP');
      marker.gunAmmoType = CivilianGroup.DOCTORS;
      return marker;
    };
    const shelf = gridNo(80, 80);
    for (const o of [doctorsMarker(), item('FIRSTAIDKIT'), item('MEDICKIT', 60), item('CANTEEN')])
      addItemToPool(t, shelf, o, Visibility.INVISIBLE, 0);
    expect(countHospitalSupplies(t)).toBe(1);
    addItemToPool(t, shelf, doctorsMarker(), Visibility.INVISIBLE, 0);
    expect(countHospitalSupplies(t)).toBe(2);
  });
});
