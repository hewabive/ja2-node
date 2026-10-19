import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { Session } from '../../../server/session.ts';
import type { SimEvent } from '../../events.ts';
import { sectorInfo } from '../../strategic/map/sectors.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import { worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { MercStatus } from '../../tactical/profiles.ts';
import { FinanceCode } from '../finances.ts';
import { sectorKey } from '../sector-diff.ts';
import { Bookmark, MercAccountStatus } from './laptop-state.ts';
import { History } from './records.ts';

const SLOW_SCENARIO_MS = 30_000;
const VANT = 1;
const HOLLIS = 3;
const LASKO = 6;
const PUIG = 7;
const MARLOW = 8;
const VOSS = 10;
let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function inLaptop(seed: number): Promise<CampaignSession> {
  return createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { hire: [] });
}

function mailId(session: CampaignSession, type: string): number {
  const mail = session.view().laptop?.emails.find((m) => m.type === type);
  if (!mail) throw new Error(`no ${type} mail`);
  return mail.id;
}

function advanceTo(session: CampaignSession, day: number, hour: number): SimEvent[] {
  const live = new Session('t', session);
  const events: SimEvent[] = [];
  for (let k = 0; k < 50; k++) {
    const report = live.advance({ worldTime: { day, hour } });
    events.push(...report.events);
    if (report.reason === 'worldTime' || report.reason === 'refused' || report.reason === 'decision') break;
  }
  return events;
}

function available(session: CampaignSession, from: readonly number[]): number[] {
  const laptop = session.view().laptop;
  return from.filter((p) => laptop?.aim.find((a) => a.profile === p)?.face === 'available');
}

describe('the laptop at the start of a new game', () => {
  it('opens at day 1 01:00 with the four old mails, the I.M.P. invitation and the A.I.M. bookmark', async () => {
    const session = await inLaptop(11);
    const view = session.view();
    expect(view.clock).toMatchObject({ day: 1, hour: 1, minute: 0 });
    expect(view.strategic?.flow).toBe('laptop');
    const laptop = view.laptop;
    expect(laptop?.bookmarks).toEqual(['aim']);
    expect(laptop?.emails.map((m) => [m.type, m.read])).toEqual([
      ['OLD_ENRICO_1', true],
      ['OLD_ENRICO_2', true],
      ['RIS_REPORT', true],
      ['OLD_ENRICO_3', true],
      ['IMP_EMAIL_INTRO', false],
    ]);
    expect(laptop?.balance).toBe(35000);
    expect(laptop?.files).toEqual([{ code: 0, read: false }]);
    expect(laptop?.aim.map((a) => a.profile)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(laptop?.merc).toMatchObject({ bookmarked: false, accountStatus: 'noAccount', listed: [] });
    expect(laptop?.bobbyRay.open).toBe(false);
  });

  it('freezes the clock: advance is refused and compression cannot start until the laptop is closed', async () => {
    const session = await inLaptop(12);
    const live = new Session('t', session);
    const report = live.advance({ worldSeconds: 3600 });
    expect(report).toMatchObject({ reason: 'refused', refusal: expect.stringMatching(/^laptop:/) });
    expect(session.dispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ ok: false, reason: expect.stringMatching(/^laptop:/) });
    expect(session.dispatch({ type: 'closeLaptop' })).toEqual({ ok: true });
    expect(session.dispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ ok: false, reason: 'no merc has been hired yet' });
    expect(session.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
  });

  it('posts the I.M.P. reminder on every exit while no character exists and no merc was hired', async () => {
    const session = await inLaptop(13);
    const queue = session.campaign.state.queue;
    const reminders = () => queue.events.filter((e) => e.kind === EventKind.HAVENT_MADE_IMP_CHARACTER_EMAIL).length;
    session.dispatch({ type: 'closeLaptop' });
    session.dispatch({ type: 'openLaptop' });
    session.dispatch({ type: 'closeLaptop' });
    expect(reminders()).toBe(2);
    expect(session.campaign.state.laptop.newGameLaptop).toBe(true);
  });

  it('unlocks the I.M.P. site when its mail is read', async () => {
    const session = await inLaptop(14);
    expect(session.dispatch({ type: 'readEmail', id: 999 })).toEqual({ ok: false, reason: 'noSuchMail' });
    const read = session.dispatch({ type: 'readEmail', id: mailId(session, 'IMP_EMAIL_INTRO') });
    expect(read).toMatchObject({ ok: true, data: { type: 'IMP_EMAIL_INTRO', bookmarks: [Bookmark.AIM, Bookmark.IMP] } });
    expect(session.view().laptop?.imp).toMatchObject({ bookmarked: true, canCreate: true, charactersLeft: 1, cost: 3000 });
  });
});

describe('hiring from A.I.M.', { timeout: SLOW_SCENARIO_MS }, () => {
  it('charges salary plus kit and the deposit in two records, writes history and flies the merc in at 07:00', async () => {
    const session = await inLaptop(21);
    const profile = available(session, [0, 2])[0];
    if (profile === undefined) throw new Error('no merc with a deposit is available');
    const quote = session.dispatch({ type: 'aimQuote', profile, contract: 7 });
    expect(quote).toMatchObject({ ok: true, data: { contact: 'firstContact', affordable: true, withGear: true, contract: 7 } });
    const charge = (quote.data as { charge: { salary: number; medicalDeposit: number; gear: number; total: number } }).charge;
    const hired = session.dispatch({ type: 'aimHire', profile, contract: 7 });
    expect(hired).toMatchObject({ ok: true, data: { soldier: 0, charge, arrival: { minute: 1860, shownMinute: 1890, sector: 'A9' } } });
    const ledger = session.campaign.state.finances.ledger.slice(-2);
    expect(ledger.map((r) => [r.code, r.secondCode, r.amount])).toEqual([
      [FinanceCode.HIRED_MERC, profile, -(charge.salary + charge.gear)],
      [FinanceCode.MEDICAL_DEPOSIT, profile, -charge.medicalDeposit],
    ]);
    expect(session.campaign.state.laptop.history.at(-1)).toMatchObject({ code: History.HIRED_MERC_FROM_AIM, secondCode: profile });
    expect(session.campaign.state.profiles.get(profile)).toMatchObject({
      mercStatus: MercStatus.HIRED_BUT_NOT_ARRIVED_YET,
      optionalGearCost: 0,
    });
    expect(session.dispatch({ type: 'aimHire', profile, contract: 7 })).toMatchObject({ ok: false, reason: 'away' });
    expect(session.dispatch({ type: 'closeLaptop' })).toEqual({ ok: true });
    expect(session.campaign.state.laptop.newGameLaptop).toBe(false);
    await session.prepare({ type: 'compressTime', mode: 2 });
    expect(session.dispatch({ type: 'compressTime', mode: 2 }).ok).toBe(true);
    const view = session.view();
    expect(view.clock).toMatchObject({ day: 1, hour: 7, minute: 0 });
    expect(view.strategic?.mercs.map((m) => [m.id, m.sector, m.contract?.type === 'aim' && m.contract.endsAt])).toEqual([
      [0, 'A9', { day: 8, hour: 7 }],
    ]);
    expect(session.campaign.state.laptop.emails.at(-1)?.offset).toBe(10);
  });

  it('refuses in the original order: hangover, death rate, reputation, then funds, and never takes money for a refusal', async () => {
    const session = await inLaptop(22);
    const [profile] = available(session, [2, 0, 1, 3, 4, 5]);
    if (profile === undefined) throw new Error('nobody is available');
    const p = session.campaign.state.profiles.get(profile);
    const status = session.campaign.state.status;
    if (!p) throw new Error('no profile');
    p.daysOfMoraleHangover = 2;
    status.badReputation = 100;
    expect(session.dispatch({ type: 'aimHire', profile, contract: 1 })).toMatchObject({ ok: false, reason: 'hangover' });
    p.daysOfMoraleHangover = 0;
    Object.assign(p, { deathRate: 4, reputationTolerance: 50 });
    status.mercDeaths = 1;
    status.manDaysPlayed = 10;
    expect(session.dispatch({ type: 'aimHire', profile, contract: 1 })).toMatchObject({ ok: false, reason: 'deathRate' });
    Object.assign(p, { deathRate: 101 });
    expect(session.dispatch({ type: 'aimHire', profile, contract: 1 })).toMatchObject({ ok: false, reason: 'reputation' });
    status.badReputation = 0;
    session.campaign.state.finances.balance = 10;
    expect(session.dispatch({ type: 'aimHire', profile, contract: 1 })).toMatchObject({ ok: false, reason: 'funds' });
    expect(session.dispatch({ type: 'aimHire', profile, contract: 3 })).toMatchObject({ ok: false, reason: 'badContract' });
    expect(session.dispatch({ type: 'aimHire', profile: 42, contract: 7 })).toMatchObject({ ok: false, reason: 'notAimMerc' });
    expect(session.campaign.state.finances.balance).toBe(10);
  });

  it('leaves a message for an away merc that comes back as a reply mail', async () => {
    const session = await inLaptop(23);
    const p = session.campaign.state.profiles.get(1);
    if (!p) throw new Error('no profile');
    p.mercStatus = MercStatus.WORKING_ELSEWHERE;
    p.dayBecomesAvailable = 1;
    expect(session.dispatch({ type: 'aimLeaveMessage', profile: 1 })).toEqual({ ok: true });
    expect(session.dispatch({ type: 'aimLeaveMessage', profile: 1 })).toEqual({ ok: false, reason: 'alreadyLeft' });
    expect(session.dispatch({ type: 'aimLeaveMessage', profile: 0 })).toMatchObject({ ok: false });
    expect(p.miscFlags3 & 0x01).toBe(1);
  });
});

describe('after the landing', { timeout: SLOW_SCENARIO_MS }, () => {
  async function landed(seed: number): Promise<CampaignSession> {
    const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
    const start = sectorInfo(session.campaign.state.map, parseSectorString('A9'));
    start.numAdmins = 0;
    start.numTroops = 0;
    start.numElites = 0;
    const land = { type: 'compressTime', mode: 2 };
    await session.prepare(land);
    expect(session.dispatch(land).ok).toBe(true);
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    return session;
  }

  async function landedWith(seed: number, profiles: readonly number[]): Promise<CampaignSession> {
    const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, {
      hire: profiles.map((profile) => ({ profile })),
      land: false,
    });
    const start = sectorInfo(session.campaign.state.map, parseSectorString('A9'));
    Object.assign(start, { numAdmins: 0, numTroops: 0, numElites: 0 });
    const land = { type: 'compressTime', mode: 2 };
    await session.prepare(land);
    expect(session.dispatch(land).ok).toBe(true);
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    return session;
  }

  it('flies a later hire in on the next slot with the contract end recomputed at arrival', async () => {
    const session = await landed(31);
    expect(session.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
    const [profile] = available(session, [0, 1, 2, 3, 4, 5]);
    if (profile === undefined) throw new Error('nobody is available');
    const hired = session.dispatch({ type: 'aimHire', profile, contract: 1, gear: false });
    expect(hired).toMatchObject({ ok: true, data: { arrival: { minute: 1440 + 13 * 60 + 30, sector: 'A9' } } });
    const id = (hired.data as { soldier: number }).soldier;
    const merc = session.campaign.laptop?.roster.get(id);
    expect(merc?.contract.contractEnd).toBe(3 * 1440 + 13 * 60);
    expect(merc?.soldier.inv.every((o) => !o || o.item === 0)).toBe(true);
    expect(session.dispatch({ type: 'closeLaptop' })).toEqual({ ok: true });
    const events = advanceTo(session, 1, 14);
    expect(events.some((e) => e.type === 'mercArrived' && e.soldier === id)).toBe(true);
    expect(merc?.contract.contractEnd).toBe(2 * 1440 + 13 * 60);
    expect(merc?.sector).toEqual(parseSectorString('A9'));
  });

  it('lets the stub roster refuse for its own reasons and join for a friend', async () => {
    const session = await landedWith(34, [VANT, 0]);
    expect(session.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
    for (const id of [HOLLIS, LASKO, PUIG, MARLOW, VOSS]) {
      const p = session.campaign.state.profiles.get(id);
      if (p) Object.assign(p, { mercStatus: MercStatus.OK, dayBecomesAvailable: 0 });
    }
    expect(session.dispatch({ type: 'aimHire', profile: LASKO, contract: 1, gear: false })).toMatchObject({
      ok: false,
      reason: 'hatesTeammate',
      data: { hated: VANT, quote: { id: expect.any(Number), name: expect.stringMatching(/^HATE_MERC_[12]_ON_TEAM$/) } },
    });
    expect(session.dispatch({ type: 'hireCheck', profile: LASKO })).toMatchObject({
      ok: true,
      data: { profile: LASKO, contact: 'firstContact', accepted: false, refusal: 'hatesTeammate', hated: VANT },
    });
    const status = session.campaign.state.status;
    status.badReputation = 1;
    expect(session.dispatch({ type: 'aimHire', profile: MARLOW, contract: 1, gear: false })).toMatchObject({
      ok: false,
      reason: 'reputation',
      data: { quote: { id: 80, name: 'REPUTATION_REFUSAL' } },
    });
    status.badReputation = 0;
    Object.assign(status, { mercDeaths: 1, manDaysPlayed: 10 });
    expect(session.dispatch({ type: 'aimHire', profile: PUIG, contract: 1, gear: false })).toMatchObject({
      ok: false,
      reason: 'deathRate',
      data: { quote: { id: 81, name: 'DEATH_RATE_REFUSAL' } },
    });
    Object.assign(status, { mercDeaths: 0, manDaysPlayed: 0 });
    expect(session.dispatch({ type: 'aimHire', profile: HOLLIS, contract: 1, gear: false })).toMatchObject({ ok: true });
    expect(session.dispatch({ type: 'hireCheck', profile: LASKO })).toMatchObject({
      ok: true,
      data: { accepted: true, quote: { id: 92, name: 'JOINING_CAUSE_BUDDY_1_ON_TEAM' } },
    });
    expect(session.dispatch({ type: 'aimHire', profile: LASKO, contract: 1, gear: false })).toMatchObject({
      ok: true,
      data: { quote: { id: 92, name: 'JOINING_CAUSE_BUDDY_1_ON_TEAM' } },
    });
    expect(session.dispatch({ type: 'aimHire', profile: VOSS, contract: 1, gear: false })).toMatchObject({
      ok: true,
      data: { quote: null },
    });
  });

  it('moves the landing zone only to a surface sector with safe airspace', async () => {
    const session = await landed(32);
    expect(session.dispatch({ type: 'setLandingZone', sector: 'C5' })).toEqual({ ok: false, reason: 'enemyAirspace' });
    expect(session.dispatch({ type: 'setLandingZone', sector: 'A10' })).toMatchObject({ ok: true, data: { sector: 'A10' } });
    expect(session.view().strategic?.landingZone).toBe('A10');
    expect(session.dispatch({ type: 'setLandingZone', sector: 'Q5' })).toMatchObject({ ok: false });
  });

  it('opens M.E.R.C. after Speck mails, hires on account and settles the debt', async () => {
    const session = await landed(33);
    advanceTo(session, 3, 8);
    expect(session.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
    expect(session.dispatch({ type: 'mercOpenAccount' })).toEqual({ ok: false, reason: 'noBookmark' });
    session.dispatch({ type: 'readEmail', id: mailId(session, 'MERC_INTRO') });
    expect(session.dispatch({ type: 'mercHire', profile: 42 })).toEqual({ ok: false, reason: 'noAccount' });
    expect(session.dispatch({ type: 'mercOpenAccount' })).toMatchObject({ ok: true, data: { accountNumber: expect.any(Number) } });
    expect(session.campaign.state.laptop.merc.accountStatus).toBe(MercAccountStatus.VALID);
    const hired = session.dispatch({ type: 'mercHire', profile: 42 });
    expect(hired).toMatchObject({ ok: true, data: { profile: 42 } });
    expect(session.campaign.state.profiles.get(42)?.mercMercContractLength).toBe(1);
    const balance = session.campaign.state.finances.balance;
    expect(session.dispatch({ type: 'mercPay' })).toEqual({ ok: true, data: { paid: 150, full: true } });
    expect(session.campaign.state.finances.balance).toBe(balance - 150);
    expect(session.dispatch({ type: 'mercPay' })).toEqual({ ok: false, reason: 'nothingOwed' });
  });

  it('sells, ships and delivers a Bobby Ray order to Drassen once the airport is held', async () => {
    const session = await landed(34);
    const c = session.campaign;
    const b13 = parseSectorString('B13');
    const element = c.state.map.elements[b13.x + b13.y * 18];
    if (element) element.enemyControlled = false;
    const drassen = c.state.economy.towns[element?.nameId ?? 0];
    if (drassen) drassen.rating = 50;
    c.laptop?.surfaceSectorTaken(b13);
    expect(session.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
    const stock = session.view().laptop?.bobbyRay.newStock ?? [];
    const line = stock[0];
    if (!line) throw new Error('Bobby Ray has nothing');
    const order = { lines: [{ item: line.item, quantity: 1 }], destination: 2, speed: 0 };
    const quote = session.dispatch({ type: 'bobbyRayQuote', ...order });
    expect(quote).toMatchObject({ ok: true, data: { subtotal: line.price } });
    const placed = session.dispatch({ type: 'bobbyRayOrder', ...order });
    expect(placed).toMatchObject({ ok: true, data: { shipment: 0 } });
    expect(c.state.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.BOBBYR_PURCHASE, secondCode: 0 });
    session.dispatch({ type: 'closeLaptop' });
    const events = advanceTo(session, 2, 12);
    expect(events.some((e) => e.type === 'shipmentDelivered')).toBe(true);
    const items = c.state.sectorDiffs.get(sectorKey(b13))?.items ?? [];
    expect(items.some((i) => i.object.item === line.item)).toBe(true);
    expect(worldTotalMinutes(c.state.clock)).toBeGreaterThan(1440 + 8 * 60);
  });

  it('insures an A.I.M. merc for the days left on his contract', async () => {
    const session = await landed(35);
    expect(session.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
    const offer = session.view().laptop?.insurance[0];
    if (!offer) throw new Error('nobody is insurable');
    expect(offer).toMatchObject({ insured: false, contractDaysLeft: 7, offeredLength: 6 });
    const insured = session.dispatch({ type: 'insure', soldier: offer.soldier });
    expect(insured).toMatchObject({ ok: true, data: { length: 6, cost: offer.premium } });
    expect(session.campaign.state.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.PURCHASED_INSURANCE, amount: -offer.premium });
  });
});

describe('I.M.P.', () => {
  it('creates a character from one command and charges 3000', async () => {
    const session = await inLaptop(41);
    const command = {
      type: 'impCreate',
      code: 'XEP624',
      name: 'Stub Tester',
      gender: 'female',
      answers: [1, 0, 0, 1, 0, 1, 0, 2, 2, 1, 2, 1, 1, 1, 0, 0],
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
    expect(session.dispatch(command)).toEqual({ ok: false, reason: 'noBookmark' });
    session.dispatch({ type: 'readEmail', id: mailId(session, 'IMP_EMAIL_INTRO') });
    expect(session.dispatch({ ...command, code: 'nope' })).toEqual({ ok: false, reason: 'badCode' });
    expect(session.dispatch({ ...command, attributes: { ...command.attributes, health: 90 } })).toEqual({
      ok: false,
      reason: 'badAttributes',
    });
    const created = session.dispatch(command);
    expect(created).toMatchObject({ ok: true, data: { profile: 51, soldier: 0, arrival: { minute: 1860 } } });
    expect(session.campaign.state.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.IMP_PROFILE, amount: -3000 });
    expect(session.view().laptop?.imp).toMatchObject({ canCreate: false, charactersLeft: 0 });
    expect(session.campaign.laptop?.roster.get(0)?.soldier.name).toBe('Stub');
  });
});
