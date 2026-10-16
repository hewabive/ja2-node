import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { parseSectorString, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { NUM_MIN_IN_DAY } from '../../strategic/time/constants.ts';
import { mercArrivalTimeOfDay } from '../contracts/contract-times.ts';
import type { RosterMerc } from '../roster.ts';
import { bobbyRayUnitPrice, shippingCost } from './bobby-ray.ts';
import { checkForValidArrivalSector, landingZoneRefusal } from './hire.ts';
import { compileQuiz, personalityFromList } from './imp.ts';
import { insuranceLength, insurancePremium } from './insurance.ts';
import type { LaptopFlow } from './laptop-flow.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function laptopFlow(seed: number): Promise<LaptopFlow> {
  const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { hire: [] });
  const flow = session.campaign.laptop;
  if (!flow) throw new Error('no laptop');
  return flow;
}

function hireOne(flow: LaptopFlow): RosterMerc {
  for (const profile of STUB_AIM_PROFILES) {
    if (flow.campaign.dispatch({ type: 'aimHire', profile, contract: 7, gear: false }).ok) break;
  }
  const m = flow.team()[0];
  if (!m) throw new Error('nobody could be hired');
  return m;
}

function clearMap(flow: LaptopFlow, free: readonly string[]): void {
  for (const e of flow.state.map.elements) {
    e.enemyControlled = true;
    e.enemyAirControlled = false;
  }
  for (const name of free) {
    const element = flow.state.map.elements[strategicIndex(parseSectorString(name))];
    if (element) element.enemyControlled = false;
  }
}

const PSYCHO = 7;
const STUB_AIM_PROFILES = [0, 1, 2, 3, 4, 5];
const MORNING = 7 * 60 + 30;
const NOON = 13 * 60 + 30;
const EVENING = 19 * 60 + 30;

describe('arrival slots (GetMercArrivalTimeOfDay)', () => {
  it('flies at 07:30, 13:30 or 19:30 with six hours to prepare, and after 13:59 the next morning', () => {
    const day = 2 * NUM_MIN_IN_DAY;
    const slots = Array.from({ length: 24 }, (_, hour) => mercArrivalTimeOfDay(day + hour * 60 + 30) - day);
    expect(slots).toEqual([
      ...Array<number>(2).fill(MORNING),
      ...Array<number>(6).fill(NOON),
      ...Array<number>(6).fill(EVENING),
      ...Array<number>(10).fill(NUM_MIN_IN_DAY + MORNING),
    ]);
  });
});

describe("Bobby Ray's prices", () => {
  it('charges shipping per started 0.1 kg with a 2 kg minimum, rounded half up, as the oracle orders do', async () => {
    const flow = await laptopFlow(3);
    const drassen = flow.content.destinations.find((d) => d.isPrimary);
    expect(drassen?.rates).toEqual([200, 100, 50]);
    expect(shippingCost(drassen, 0, 42)).toBe(840);
    expect(shippingCost(drassen, 1, 20)).toBe(200);
    expect(shippingCost(drassen, 2, 5)).toBe(100);
    expect(shippingCost(drassen, 2, 25)).toBe(125);
    expect(shippingCost(undefined, 0, 100)).toBe(0);
  });

  it('prices used items at half the price plus half scaled by quality, rounded half up', async () => {
    const flow = await laptopFlow(3);
    const slot = flow.laptop.bobbyRay.used[0];
    if (!slot) throw new Error('no used stock');
    const price = flow.tactical.items.byIndex.get(slot.item)?.price ?? 0;
    expect(bobbyRayUnitPrice(flow, { ...slot, quality: 100 }, true)).toBe(price);
    expect(bobbyRayUnitPrice(flow, { ...slot, quality: 0 }, true)).toBe(Math.trunc(price * 0.5 + 0.5));
    expect(bobbyRayUnitPrice(flow, { ...slot, quality: 77 }, true)).toBe(Math.trunc(price * (0.5 + 0.385) + 0.5));
    expect(bobbyRayUnitPrice(flow, { ...slot, quality: 77 }, false)).toBe(price);
  });
});

describe('the landing zone', () => {
  it('refuses moves before the first landing and reroutes to the nearest free sector in scan order', async () => {
    const flow = await laptopFlow(5);
    expect(landingZoneRefusal(flow, parseSectorString('B13'))).toBe('beforeFirstLanding');
    clearMap(flow, ['A13', 'C13', 'B11']);
    flow.laptop.mercArriveSector = sectorId(parseSectorString('B13'));
    checkForValidArrivalSector(flow);
    expect(flow.laptop.mercArriveSector).toBe(sectorId(parseSectorString('A13')));
    expect(flow.drainEvents()).toContainEqual(expect.objectContaining({ type: 'arrivalRerouted', from: 'B13', to: 'A13' }));
  });

  it('never picks row P', async () => {
    const flow = await laptopFlow(5);
    clearMap(flow, ['P15']);
    flow.laptop.mercArriveSector = sectorId(parseSectorString('O15'));
    checkForValidArrivalSector(flow);
    expect(flow.laptop.mercArriveSector).toBe(sectorId(parseSectorString('O15')));
  });
});

describe('I.M.P. quiz', () => {
  it('fills the lists in question order, with the gendered skill answers', async () => {
    const flow = await laptopFlow(7);
    const answers = [0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0];
    const male = compileQuiz(flow, answers, true);
    const female = compileQuiz(flow, answers, false);
    expect(male.skills).toEqual([12, 1, 8, 3, 10, 12, 5]);
    expect(female.skills).toEqual([10, 1, 8, 3, 10, 10, 5]);
    expect(male.attitudes).toEqual([9, 9, 4, 0]);
    expect(male.personalities).toEqual([PSYCHO]);
    expect(personalityFromList(male)).toBe(PSYCHO);
    expect(personalityFromList(compileQuiz(flow, Array<number>(16).fill(0), true))).toBe(0);
  });
});

describe('life insurance', () => {
  it('offers the contract days left minus one before the first purchase and nothing for a POW', async () => {
    const flow = await laptopFlow(9);
    const m = hireOne(flow);
    const p = flow.profile(m.profile);
    if (!p) throw new Error('no profile');
    const length = insuranceLength(flow, m);
    expect(length).toBe(flow.state.didGameJustStart ? 7 : 6);
    const daily = insurancePremium(flow, 1, m, p);
    expect(insurancePremium(flow, length, m, p)).toBe(daily * length);
    m.assignment = Assignment.ASSIGNMENT_POW;
    expect(insurancePremium(flow, length, m, p)).toBe(0);
  });

  it('wraps the unsigned day counts as the original when the insured days exceed the contract', async () => {
    const flow = await laptopFlow(9);
    const m = hireOne(flow);
    m.contract.lifeInsurance = 1;
    m.contract.startOfInsuranceContract = 2;
    m.contract.totalLengthOfInsuranceContract = 30;
    expect(insuranceLength(flow, m)).toBe(0);
  });
});
