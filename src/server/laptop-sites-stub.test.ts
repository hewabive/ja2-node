import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RELOAD_TEST_TIMEOUT_MS } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString, strategicIndex } from '../content/strategic/sector-ids.ts';
import { loadUiStrings } from '../content/text/strings.ts';
import type { LaptopView } from '../protocol/view.ts';
import { addJohnsGunShipment } from '../sim/campaign/laptop/bobby-ray.ts';
import type { LaptopContext } from '../sim/campaign/laptop/context.ts';
import { MAX_MERCS_ON_TEAM } from '../sim/campaign/laptop/hire.ts';
import { impBeginRefusal } from '../sim/campaign/laptop/imp.ts';
import { Bookmark, MercAccountStatus } from '../sim/campaign/laptop/laptop-state.ts';
import { SpeckQuote } from '../sim/campaign/laptop/merc-site.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import type { Session } from './session.ts';

const GASKET = 42;
const DRASSEN = 2;
const AUSTIN = 0;
const OVERNIGHT = 0;
const STANDARD = 2;
const IMP_CODE = 'XEP624';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

interface Laptop {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function newGame(seed: number): Promise<Laptop> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { hire: [] });
  created.useLabels(await loadUiStrings(kit.read, 'eng'));
  const session = drivenSession(created, stubSessionSources(kit));
  return { session, live: new ReloadingSession('laptop-sites', session) };
}

function laptopOf(session: CampaignSession): LaptopView {
  const laptop = session.view().laptop;
  if (!laptop) throw new Error('the laptop is closed');
  return laptop;
}

function airport(session: CampaignSession) {
  return session.campaign.state.map.elements[strategicIndex(parseSectorString('B13'))];
}

function openBobbyRay(session: CampaignSession, liberate: boolean): void {
  const element = airport(session);
  if (liberate && element) element.enemyControlled = false;
  session.campaign.laptop?.surfaceSectorTaken(parseSectorString('B13'));
}

describe("Bobby Ray's for the canvas order form (X11)", () => {
  it(
    'quotes without a destination at no shipping cost and answers affordable and confirmDestination',
    async () => {
      const { session, live } = await newGame(201);
      openBobbyRay(session, true);
      const line = laptopOf(session).bobbyRay.newStock[0];
      if (!line) throw new Error('Bobby Ray has nothing');
      const lines = [{ item: line.item, quantity: 1 }];
      const bare = live.dispatch({ type: 'bobbyRayQuote', lines, speed: OVERNIGHT });
      expect(bare).toMatchObject({ ok: true, data: { subtotal: line.price, shipping: 0, total: line.price, confirmDestination: false } });
      expect(live.dispatch({ type: 'bobbyRayQuote', lines, destination: -1, speed: OVERNIGHT })).toMatchObject({
        ok: true,
        data: { shipping: 0 },
      });
      const drassen = live.dispatch({ type: 'bobbyRayQuote', lines, destination: DRASSEN, speed: OVERNIGHT });
      const quote = drassen.data as { shipping: number; total: number; affordable: boolean; confirmDestination: boolean };
      expect(quote.shipping).toBeGreaterThan(0);
      expect(quote).toMatchObject({ affordable: true, confirmDestination: false, total: line.price + quote.shipping });
      expect(live.dispatch({ type: 'bobbyRayQuote', lines, destination: AUSTIN, speed: OVERNIGHT })).toMatchObject({
        data: { confirmDestination: true },
      });
      const element = airport(session);
      if (element) element.enemyControlled = true;
      expect(live.dispatch({ type: 'bobbyRayQuote', lines, destination: DRASSEN, speed: OVERNIGHT })).toMatchObject({
        data: { confirmDestination: true },
      });
      session.campaign.state.finances.balance = 1;
      expect(live.dispatch({ type: 'bobbyRayQuote', lines, destination: DRASSEN, speed: OVERNIGHT })).toMatchObject({
        data: { affordable: false },
      });
      expect(live.dispatch({ type: 'bobbyRayOrder', lines, destination: -1, speed: OVERNIGHT })).toEqual({
        ok: false,
        reason: 'noDestination',
      });
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it(
    'lists stock entries with their store slot and catalogue',
    async () => {
      const { session } = await newGame(202);
      openBobbyRay(session, true);
      const { newStock, usedStock } = laptopOf(session).bobbyRay;
      const items = session.campaign.laptop?.tactical.items;
      expect(newStock.length).toBeGreaterThan(0);
      for (const entry of newStock) {
        expect(session.campaign.state.laptop.bobbyRay.inventory[entry.slot]?.item).toBe(entry.item);
        const itemClass = items?.byIndex.get(entry.item)?.itemClass ?? 0;
        expect(entry.catalogue === 'ammo').toBe(itemClass === 0x400);
      }
      expect(new Set(newStock.map((e) => e.catalogue))).toContain('guns');
      for (const entry of usedStock) expect(entry.catalogue).toBe('used');
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it(
    "shows the shipments the page prints: weight, prices and totals as paid, Kulba's gift without lines",
    async () => {
      const { session, live } = await newGame(203);
      openBobbyRay(session, true);
      const entries = laptopOf(session).bobbyRay.newStock.slice(0, 2);
      const lines = entries.map((e) => ({ item: e.item, quantity: 1 }));
      const order = { lines, destination: DRASSEN, speed: STANDARD };
      const quote = live.dispatch({ type: 'bobbyRayQuote', ...order }).data as { subtotal: number; shipping: number; weight: number };
      expect(live.dispatch({ type: 'bobbyRayOrder', ...order })).toMatchObject({ ok: true, data: { shipment: 0 } });
      const flow = session.campaign.laptop;
      if (!flow) throw new Error('no laptop');
      addJohnsGunShipment(flow);
      const [mine, gift] = laptopOf(session).bobbyRay.shipments;
      expect(mine).toMatchObject({
        index: 0,
        active: true,
        displayed: true,
        destination: DRASSEN,
        speed: STANDARD,
        units: 2,
        weight: Math.max(quote.weight, 20),
        subtotal: quote.subtotal,
        shipping: quote.shipping,
        total: quote.subtotal + quote.shipping,
      });
      expect(mine?.lines.map((l) => [l.item, l.unitPrice, l.quality])).toEqual(entries.map((e) => [e.item, e.price, 100]));
      expect(gift).toMatchObject({ index: 1, active: true, displayed: false, units: 4, lines: [], total: 0 });
    },
    RELOAD_TEST_TIMEOUT_MS,
  );
});

describe("Speck's lines and the M.E.R.C. pages (X6)", () => {
  it(
    'answers the account, the hire and the payment with the quotes Speck says next',
    async () => {
      const { session, live } = await newGame(204);
      session.campaign.state.laptop.bookmarks.push(Bookmark.MERC);
      expect(laptopOf(session).merc.slowLoad).toBe(true);
      expect(live.dispatch({ type: 'mercOpenAccount' })).toMatchObject({
        ok: true,
        data: { quotes: [SpeckQuote.THANK_PLAYER_FOR_OPENING_ACCOUNT] },
      });
      const listing = laptopOf(session).merc.listed.find((m) => m.profile === GASKET);
      expect(listing).toMatchObject({ married: false, advertiseQuote: expect.any(Number) });
      const hired = live.dispatch({ type: 'mercHire', profile: GASKET });
      const quotes = (hired.data as { quotes: number[] }).quotes;
      expect([SpeckQuote.GENERIC_THANKS_FOR_HIRING_MERCS_1, SpeckQuote.GENERIC_THANKS_FOR_HIRING_MERCS_2]).toContain(quotes.at(-1));
      expect(laptopOf(session).merc.account).toEqual([
        { profile: GASKET, name: expect.any(String), days: 1, rate: 150, charge: 150, dead: false },
      ]);
      expect(live.dispatch({ type: 'mercHire', profile: GASKET })).toEqual({
        ok: false,
        reason: 'unavailable',
        data: { quotes: [SpeckQuote.PLAYER_TRIES_TO_HIRE_ALREADY_HIRED_MERC] },
      });
      expect(live.dispatch({ type: 'mercPay' })).toEqual({
        ok: true,
        data: { paid: 150, full: true, quotes: [SpeckQuote.PLAYER_MAKES_FULL_PAYMENT] },
      });
      session.campaign.state.laptop.merc.accountStatus = MercAccountStatus.SUSPENDED;
      expect(live.dispatch({ type: 'mercHire', profile: GASKET })).toMatchObject({
        ok: false,
        data: { quotes: [SpeckQuote.ACCOUNT_SUSPENDED] },
      });
      session.campaign.state.laptop.merc.siteHasGoneDownYet = true;
      session.campaign.state.laptop.merc.firstVisitSinceServerWentDown = 1;
      expect(laptopOf(session).merc.slowLoad).toBe(false);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );
});

describe('the I.M.P. form rules (X12)', () => {
  it(
    'checks the code, refuses the begin page on funds before team size and sends the attribute rules',
    async () => {
      const { session, live } = await newGame(205);
      expect(live.dispatch({ type: 'impCheckCode', code: IMP_CODE })).toEqual({ ok: true, data: { result: 'ok' } });
      expect(live.dispatch({ type: 'impCheckCode', code: 'xep62' })).toEqual({ ok: true, data: { result: 'badCode' } });
      const imp = laptopOf(session).imp;
      expect(imp.beginRefusal).toBeNull();
      expect(imp.attributes).toEqual({
        start: 55,
        min: 35,
        max: 85,
        bonus: 40,
        zeroBonus: 15,
        order: [
          'health',
          'dexterity',
          'agility',
          'strength',
          'wisdom',
          'leadership',
          'marksmanship',
          'explosives',
          'medical',
          'mechanical',
        ],
        zeroable: ['marksmanship', 'medical', 'mechanical', 'explosives'],
      });
      expect(imp.quizAnswers).toEqual([6, 4, 4, 5, 4, 5, 4, 4, 4, 4, 5, 8, 4, 4, 4, 4]);
      expect(imp.portraits.male.length).toBeGreaterThan(0);
      expect(imp.portraits.female.length).toBeGreaterThan(0);
      expect(imp.voices.male.length).toBe(3);
      expect(imp.voices.female.length).toBe(3);
      const flow = session.campaign.laptop;
      if (!flow) throw new Error('no laptop');
      const balance = session.campaign.state.finances.balance;
      session.campaign.state.finances.balance = imp.cost - 1;
      expect(laptopOf(session).imp.beginRefusal).toBe('funds');
      session.campaign.state.finances.balance = balance;
      const full = Array.from({ length: MAX_MERCS_ON_TEAM }, () => ({ statusFlags: 0 }));
      const fullTeam = { state: flow.state, roster: { all: () => full } } as unknown as LaptopContext;
      expect(impBeginRefusal(fullTeam)).toBe('teamFull');
      session.campaign.state.finances.balance = imp.cost - 1;
      expect(impBeginRefusal(fullTeam)).toBe('funds');
      session.campaign.state.finances.balance = balance;
      session.campaign.state.laptop.imp.taken.push(51);
      expect(live.dispatch({ type: 'impCheckCode', code: IMP_CODE })).toEqual({ ok: true, data: { result: 'noSlot' } });
    },
    RELOAD_TEST_TIMEOUT_MS,
  );
});
