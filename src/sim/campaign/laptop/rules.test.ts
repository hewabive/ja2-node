import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import { parseSectorString, type Sector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import type { ItemObject } from '../../items/object.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { setFact } from '../../strategic/narrative/facts.ts';
import { EventKind, NUM_MIN_IN_DAY } from '../../strategic/time/constants.ts';
import { MercStatus } from '../../tactical/profiles.ts';
import { SkillTrait } from '../../tactical/soldier.ts';
import { mercArrivalTimeOfDay } from '../contracts/contract-times.ts';
import { FinanceCode } from '../finances.ts';
import type { RosterMerc } from '../roster.ts';
import { sectorKey } from '../sector-diff.ts';
import { bobbyRayPurchaseEvent, bobbyRayUnitPrice, dailyUpdateOfBobbyRaysInventory, placeOrder, shippingCost } from './bobby-ray.ts';
import { orderFlowers } from './florist.ts';
import { checkForValidArrivalSector, landingZoneRefusal } from './hire.ts';
import { compileQuiz, createPlayerAttitude, personalityFromList } from './imp.ts';
import { endInsuranceInvestigation, insuranceLength, insurancePremium, purchaseOrExtendInsurance } from './insurance.ts';
import type { LaptopFlow } from './laptop-flow.ts';
import { Bookmark, type Shipment, type StoreSlot, setBookmark } from './laptop-state.ts';
import { mercSiteDailyUpdate } from './merc-site.ts';

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

function scriptRolls(flow: LaptopFlow, values: readonly number[] = []): ScriptedRolls {
  const main = new ScriptedRolls(values);
  flow.useRandom({ main, pre: new ScriptedRolls() });
  return main;
}

function itemIndex(flow: LaptopFlow, name: string): number {
  const def = flow.tactical.items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

function shipment(flow: LaptopFlow, destination: number, lines: readonly (readonly [string, number])[]): Shipment {
  return {
    active: true,
    destination,
    speed: 0,
    lines: lines.map(([name, count]) => ({ item: itemIndex(flow, name), count, quality: 100, slot: 0, used: false })),
    weight: 0,
    orderDay: 1,
    displayedOnShipmentsPage: true,
  };
}

function openDeliverySector(flow: LaptopFlow, destination: number): Sector {
  const d = flow.content.destinations[destination];
  if (!d || d.deliverySector === null) throw new Error(`destination ${destination} delivers nowhere`);
  const sector = sectorFromId(d.deliverySector, d.deliverySectorZ);
  const element = flow.state.map.elements[strategicIndex(sector)];
  if (element) element.enemyControlled = false;
  const town = flow.state.economy.towns[element?.nameId ?? 0];
  if (town) town.rating = 50;
  return sector;
}

function deliveredItems(flow: LaptopFlow, sector: Sector): ItemObject[] {
  return (flow.state.sectorDiffs.get(sectorKey(sector))?.items ?? []).filter((i) => i.exists).map((i) => i.object);
}

function stockedSlot(flow: LaptopFlow, units: number): StoreSlot {
  flow.laptop.bobbyRay.siteCanBeAccessed = true;
  const slot = flow.laptop.bobbyRay.inventory.find((s) => s.onHand >= units);
  if (!slot) throw new Error(`Bobby Ray has no item ${units} times in stock`);
  return slot;
}

const PSYCHO = 7;
const STUB_AIM_PROFILES = [0, 1, 2, 3, 4, 5];
const STUB_MERC_PROFILE = 42;
const VERY_SUSPICIOUS = 2;
const MORNING = 7 * 60 + 30;
const NOON = 13 * 60 + 30;
const EVENING = 19 * 60 + 30;
const QUIZ_WITH_LOCKPICKING = [0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0];
const IMP_WITHOUT_LOCKPICKING_STATS = {
  type: 'impCreate',
  code: 'XEP624',
  name: 'Stub Tester',
  gender: 'male',
  answers: QUIZ_WITH_LOCKPICKING,
  attributes: {
    health: 75,
    agility: 75,
    dexterity: 70,
    strength: 55,
    wisdom: 60,
    leadership: 35,
    marksmanship: 75,
    medical: 55,
    mechanical: 55,
    explosives: 0,
  },
  portrait: 0,
  voice: 0,
};

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

  it('truncates the distance, so a diagonal neighbour scanned first beats a straight one', async () => {
    const flow = await laptopFlow(5);
    clearMap(flow, ['A12', 'B14']);
    flow.laptop.mercArriveSector = sectorId(parseSectorString('B13'));
    checkForValidArrivalSector(flow);
    expect(flow.laptop.mercArriveSector).toBe(sectorId(parseSectorString('A12')));
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

  it('rolls the attitude die even when one attitude leads alone', async () => {
    const flow = await laptopFlow(7);
    const rolls = scriptRolls(flow);
    expect(createPlayerAttitude(flow, [9, 9, 4, 0])).toBe(9);
    expect(rolls.ranges).toEqual([1]);
  });

  it('drops a skill the stats rule out by moving the last skill into its place before the draws', async () => {
    const flow = await laptopFlow(7);
    setBookmark(flow.laptop, Bookmark.IMP);
    const rolls = scriptRolls(flow, [0, 1, 0]);
    const created = flow.campaign.dispatch(IMP_WITHOUT_LOCKPICKING_STATS);
    expect(rolls.ranges.slice(0, 3)).toEqual([1, 6, 6]);
    expect(created).toMatchObject({ ok: true, data: { skills: [SkillTrait.THROWING, SkillTrait.MARTIALARTS] } });
  });
});

describe("Bobby Ray's restock", () => {
  it('stocks the new slot when a used item becomes eligible for the first time and leaves the used one on order', async () => {
    const flow = await laptopFlow(3);
    const br = flow.laptop.bobbyRay;
    const used = br.used.find((u) => u.previouslyEligible && br.inventory.some((n) => n.item === u.item));
    const fresh = br.inventory.find((n) => n.item === used?.item);
    if (!used || !fresh || !flow.merchants) throw new Error('no item sold both new and used');
    Object.assign(used, { onHand: 0, onOrder: 0, previouslyEligible: false });
    Object.assign(fresh, { onHand: 0, onOrder: 4 });
    scriptRolls(flow);
    dailyUpdateOfBobbyRaysInventory(flow, flow.merchants);
    expect(used).toMatchObject({ onHand: 0, onOrder: 1 });
    expect(fresh).toMatchObject({ onHand: 4, onOrder: 0 });
  });
});

describe("Bobby Ray's orders", () => {
  it('reuses only the first shipment slot, never a later one that is free', async () => {
    const flow = await laptopFlow(3);
    const slot = stockedSlot(flow, 4);
    const drassen = flow.content.destinations.findIndex((d) => d.isPrimary);
    const order = { lines: [{ item: slot.item, quantity: 1 }], destination: drassen, speed: 0 };
    const shipments = flow.laptop.bobbyRay.shipments;
    expect(placeOrder(flow, order)).toMatchObject({ ok: true, shipment: 0 });
    expect(placeOrder(flow, order)).toMatchObject({ ok: true, shipment: 1 });
    (shipments[1] as Shipment).active = false;
    expect(placeOrder(flow, order)).toMatchObject({ ok: true, shipment: 2 });
    (shipments[0] as Shipment).active = false;
    expect(placeOrder(flow, order)).toMatchObject({ ok: true, shipment: 0 });
    expect(shipments.map((s) => s.active)).toEqual([true, false, true]);
  });

  it('takes the money for an order to a city it cannot deliver to and ships nothing', async () => {
    const flow = await laptopFlow(3);
    const slot = stockedSlot(flow, 1);
    const nowhere = flow.content.destinations.findIndex((d) => !d.canDeliver);
    const balance = flow.state.finances.balance;
    const result = placeOrder(flow, { lines: [{ item: slot.item, quantity: 1 }], destination: nowhere, speed: 0 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.shipment).toBeNull();
    expect(flow.laptop.bobbyRay.shipments).toEqual([]);
    expect(flow.state.finances.balance).toBe(balance - result.quote.total);
    expect(flow.state.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.BOBBYR_PURCHASE, amount: -result.quote.total });
  });
});

describe("Bobby Ray's deliveries", () => {
  it('delivers a gun ordered alone empty but recreates every gun of a larger line loaded', async () => {
    const flow = await laptopFlow(3);
    const drassen = flow.content.destinations.findIndex((d) => d.isPrimary);
    const sector = openDeliverySector(flow, drassen);
    setFact(flow.state.narrative, Fact.PABLO_WONT_STEAL, true);
    flow.laptop.bobbyRay.shipments.push(
      shipment(flow, drassen, [
        ['GLOCK_17', 1],
        ['BERETTA_92F', 2],
      ]),
    );
    bobbyRayPurchaseEvent(flow, 0, null);
    const glock = itemIndex(flow, 'GLOCK_17');
    const beretta = itemIndex(flow, 'BERETTA_92F');
    expect(deliveredItems(flow, sector).map((o) => [o.item, o.gunShotsLeft > 0])).toEqual([
      [glock, false],
      [beretta, true],
      [beretta, true],
    ]);
  });

  it('never lets Pablo steal the first two units of a line delivered to an unloaded sector', async () => {
    const flow = await laptopFlow(3);
    const drassen = flow.content.destinations.findIndex((d) => d.isPrimary);
    openDeliverySector(flow, drassen);
    flow.laptop.bobbyRay.shipments.push(shipment(flow, drassen, [['BERETTA_92F', 3]]));
    const rolls = scriptRolls(flow);
    bobbyRayPurchaseEvent(flow, 0, null);
    expect(rolls.ranges).toEqual([4, 100]);
    expect(flow.drainEvents()).toContainEqual(expect.objectContaining({ type: 'shipmentDelivered', stolen: 1 }));
  });

  it('delivers outside Drassen only as many lines as the first shipment has', async () => {
    const flow = await laptopFlow(3);
    const meduna = flow.content.destinations.findIndex((d) => d.canDeliver && !d.isPrimary);
    const sector = openDeliverySector(flow, meduna);
    const shipments = flow.laptop.bobbyRay.shipments;
    shipments.push({ ...shipment(flow, meduna, [['GLOCK_17', 1]]), active: false });
    shipments.push(
      shipment(flow, meduna, [
        ['BERETTA_92F', 1],
        ['GLOCK_17', 1],
      ]),
    );
    bobbyRayPurchaseEvent(flow, 1, null);
    expect(deliveredItems(flow, sector).map((o) => o.item)).toEqual([itemIndex(flow, 'BERETTA_92F')]);
    expect(shipments[1]?.active).toBe(false);
  });
});

describe('the florist', () => {
  it('charges a bouquet without looking at the balance', async () => {
    const flow = await laptopFlow(11);
    flow.state.finances.balance = 0;
    const result = orderFlowers(flow, { bouquet: 0, destination: 0, nextDay: false, extras: [] }, { flowersMeanwhile: () => {} });
    if (typeof result === 'string') throw new Error(result);
    expect(result.price).toBeGreaterThan(0);
    expect(flow.state.finances.balance).toBe(-result.price);
  });
});

describe('the M.E.R.C. site', () => {
  it('posts the new-merc event again every midnight while a listing waits to be revealed', async () => {
    const flow = await laptopFlow(13);
    const listing = flow.content.mercListings.find((l) => l.profile === STUB_MERC_PROFILE);
    const p = flow.profile(STUB_MERC_PROFILE);
    if (!listing || !p) throw new Error('no M.E.R.C. stub listing');
    Object.assign(p, { mercStatus: MercStatus.OK, dayBecomesAvailable: 0 });
    flow.laptop.merc.lastMercIndex = listing.index - 1;
    mercSiteDailyUpdate(flow);
    mercSiteDailyUpdate(flow);
    expect(flow.state.queue.events.filter((e) => e.kind === EventKind.MERC_SITE_NEW_MERC_AVAILABLE)).toHaveLength(2);
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

  it('adds the length of a purchase it refused for lack of funds', async () => {
    const flow = await laptopFlow(9);
    const m = hireOne(flow);
    const length = insuranceLength(flow, m);
    flow.state.finances.balance = 0;
    expect(purchaseOrExtendInsurance(flow, m, length)).toMatchObject({ bought: false, extended: false });
    expect(m.contract).toMatchObject({ lifeInsurance: 0, totalLengthOfInsuranceContract: length });
  });

  it('keeps the payout slot of a death found to be fraud', async () => {
    const flow = await laptopFlow(9);
    const m = hireOne(flow);
    const p = flow.profile(m.profile);
    if (!p) throw new Error('no profile');
    p.suspiciousDeath = VERY_SUSPICIOUS;
    const insurance = flow.laptop.insurance;
    insurance.payouts.push({ active: true, soldier: m.id, profile: m.profile, payout: 500 });
    insurance.used = 1;
    const balance = flow.state.finances.balance;
    endInsuranceInvestigation(flow, 0);
    expect(insurance).toMatchObject({ used: 1, payouts: [{ active: true }] });
    expect(flow.state.finances.balance).toBe(balance);
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
