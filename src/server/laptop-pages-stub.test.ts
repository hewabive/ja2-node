import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RELOAD_TEST_TIMEOUT_MS } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { loadUiStrings } from '../content/text/strings.ts';
import type { LaptopView } from '../protocol/view.ts';
import { FinanceCode } from '../sim/campaign/finances.ts';
import { addHistory, addToPersonnelList, ENRICO_BACKGROUND_FILE } from '../sim/campaign/laptop/records.ts';
import { QuestStatus, setQuestStatus } from '../sim/strategic/narrative/facts.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { HistoryCode } from './history-labels.ts';
import type { Session } from './session.ts';

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

const STUB_BOUQUET_PRICES = [30, 45, 38, 52, 27, 65, 33, 58, 29, 47];
const RESCUE_QUEST = 2;
const MINUTES_PER_DAY = 1440;

async function newGame(seed: number): Promise<Laptop> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { hire: [] });
  created.useLabels(await loadUiStrings(kit.read, 'eng'));
  const session = drivenSession(created, stubSessionSources(kit));
  return { session, live: new ReloadingSession('laptop-pages', session) };
}

function laptopOf(session: CampaignSession): LaptopView {
  const laptop = session.view().laptop;
  if (!laptop) throw new Error('the laptop is closed');
  return laptop;
}

function hire(game: Laptop, contract: number): { readonly profile: number; readonly soldier: number } {
  const profile = laptopOf(game.session).aim.find((a) => a.face === 'available')?.profile;
  if (profile === undefined) throw new Error('nobody is available');
  const reply = game.live.dispatch({ type: 'aimHire', profile, contract, gear: false });
  if (!reply.ok) throw new Error(`cannot hire ${profile}: ${reply.reason}`);
  return { profile, soldier: (reply.data as { soldier: number }).soldier };
}

describe('the laptop view for Personnel, History, Files, insurance and the florist', () => {
  it(
    'renders the history rows in the display language, with the location and the quest colour',
    async () => {
      const game = await newGame(201);
      const { profile } = hire(game, 1);
      const fullName = game.session.campaign.laptop?.profileRecord(profile)?.name;
      const hired = laptopOf(game.session).history.find((h) => h.code === HistoryCode.HIRED_MERC_FROM_AIM);
      expect(hired).toMatchObject({ text: `${fullName} was hired from A.I.M.`, location: 'N/A', questInProgress: false });
      const l = game.session.campaign.state.laptop;
      addHistory(l, HistoryCode.QUEST_STARTED, RESCUE_QUEST, MINUTES_PER_DAY, { x: 9, y: 1, z: 0 });
      addHistory(l, HistoryCode.QUEST_FINISHED, RESCUE_QUEST, MINUTES_PER_DAY, null);
      setQuestStatus(game.session.campaign.state.narrative, RESCUE_QUEST, QuestStatus.IN_PROGRESS);
      const rescue = (code: number) => laptopOf(game.session).history.find((h) => h.code === code && h.secondCode === RESCUE_QUEST);
      const started = rescue(HistoryCode.QUEST_STARTED);
      expect(started).toMatchObject({ text: 'Started: kill the leader', questInProgress: true, sector: 'A9', date: { day: 1 } });
      expect(started?.location).toMatch(/^A9: .+/);
      expect(rescue(HistoryCode.QUEST_FINISHED)?.text).toBe('Finished: kill the leader');
      setQuestStatus(game.session.campaign.state.narrative, RESCUE_QUEST, QuestStatus.DONE);
      expect(rescue(HistoryCode.QUEST_STARTED)?.questInProgress).toBe(false);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it(
    'marks a file read on readFile and refuses an unknown code',
    async () => {
      const game = await newGame(202);
      expect(laptopOf(game.session).files).toEqual([{ code: ENRICO_BACKGROUND_FILE, read: false }]);
      expect(game.live.dispatch({ type: 'readFile', code: 9 })).toEqual({ ok: false, reason: 'noSuchFile' });
      expect(game.live.dispatch({ type: 'readFile', code: ENRICO_BACKGROUND_FILE })).toEqual({
        ok: true,
        data: { code: ENRICO_BACKGROUND_FILE },
      });
      expect(laptopOf(game.session).files).toEqual([{ code: ENRICO_BACKGROUND_FILE, read: true }]);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it(
    'lists the team and the departed with the personnel block of each',
    async () => {
      const game = await newGame(203);
      const { profile, soldier } = hire(game, 7);
      const view = laptopOf(game.session);
      const merc = view.personnel.current.find((m) => m.soldier === soldier);
      const p = game.session.campaign.state.profiles.get(profile);
      if (!merc || !p) throw new Error('the hired merc is missing');
      expect(merc).toMatchObject({
        profile,
        alive: true,
        robot: false,
        record: { kills: 0, assists: 0, shotsFired: 0, shotsHit: 0, battlesFought: 0, timesWounded: 0 },
        stats: { agility: p.stats.agility, experience: p.stats.experience, health: p.stats.lifeMax },
        skills: [p.skillTrait, p.skillTrait2],
        employment: { kind: 'aim', totalDays: 7, dailyCost: Math.trunc(p.weeklySalary / 7), medicalDeposit: p.medicalDepositAmount },
      });
      expect(merc.teamStats).toHaveLength(11);
      expect(merc.inventory.every((i) => i.count > 0)).toBe(true);
      const l = game.session.campaign.state.laptop;
      const other = view.aim.find((a) => a.profile !== profile)?.profile ?? 0;
      addToPersonnelList(l, 'other', other);
      addToPersonnelList(l, 'left', profile);
      const departed = laptopOf(game.session).personnel.departed;
      expect(departed.map((d) => [d.profile, d.state])).toEqual([
        [profile, 'fired'],
        [other, 'contractExpired'],
      ]);
      expect(departed[0]).toMatchObject({ nickname: p.nickname ?? expect.any(String), life: p.life, record: { battlesFought: 0 } });
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it(
    'gives each insurance card the dead flag, the contract length and the nickname',
    async () => {
      const game = await newGame(204);
      const { profile, soldier } = hire(game, 7);
      const offer = laptopOf(game.session).insurance.find((o) => o.soldier === soldier);
      const nickname = game.session.campaign.laptop?.profileRecord(profile)?.nickname;
      expect(offer).toMatchObject({ dead: false, contractLength: 7, nickname, insured: false });
      expect(laptopOf(game.session).aimMercsOnTeam).toBe(true);
      const insured = game.live.dispatch({ type: 'insure', soldier });
      expect(insured).toMatchObject({ ok: true, data: { cost: offer?.premium } });
      expect(laptopOf(game.session).insurance.find((o) => o.soldier === soldier)?.insured).toBe(true);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it(
    'charges the bouquet with the extras and the delivery, and draws the order number on the form and on sending',
    async () => {
      const game = await newGame(205);
      const before = laptopOf(game.session);
      expect(before.florist.bouquetPrices).toEqual(STUB_BOUQUET_PRICES);
      expect(before.florist.orderNumber).toBe(0);
      const entered = game.live.dispatch({ type: 'visitSite', site: 'floristOrderForm' });
      const formNumber = (entered.data as { orderNumber: number }).orderNumber;
      expect(formNumber).toBeGreaterThanOrEqual(1);
      expect(formNumber).toBeLessThanOrEqual(5);
      expect(laptopOf(game.session).florist.orderNumber).toBe(formNumber);
      const destination = before.bobbyRay.destinations[0];
      if (!destination) throw new Error('no destination');
      const ordered = game.live.dispatch({ type: 'orderFlowers', bouquet: 1, destination: 0, nextDay: true, extras: ['blackRoses'] });
      const price = 45 + 20 + destination.flowers.nextDay;
      expect(ordered).toEqual({ ok: true, data: { price, orderNumber: formNumber } });
      const after = laptopOf(game.session);
      expect(after.balance).toBe(before.balance - price);
      expect(after.finances.at(-1)).toMatchObject({ code: FinanceCode.PURCHASED_FLOWERS, amount: -price });
      expect(after.florist.orderNumber - formNumber).toBeGreaterThanOrEqual(1);
      expect(after.florist.orderNumber - formNumber).toBeLessThanOrEqual(2);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );
});
