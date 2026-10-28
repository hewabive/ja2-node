import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import type { TextKey } from '../content/narrative/dialogue-text.ts';
import { MercType } from '../content/strategic/economy-content.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { loadUiStrings } from '../content/text/strings.ts';
import { REPO_ROOT } from '../node/repo.ts';
import type { LaptopView } from '../protocol/view.ts';
import { FinanceCode } from '../sim/campaign/finances.ts';
import { impReportRows } from '../sim/campaign/laptop/imp-report.ts';
import { BobbyRaySiteVisit, Bookmark, MercSiteVisit } from '../sim/campaign/laptop/laptop-state.ts';
import { mailSpec, sender } from '../sim/campaign/laptop/mail.ts';
import { SpeckQuote } from '../sim/campaign/laptop/merc-site.ts';
import { PLAYER_GENERATED_CHARACTER_ID } from '../sim/campaign/laptop/save-import.ts';
import { MercStatus } from '../sim/tactical/profiles.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { CampaignSession, type TextSource } from './campaign-session.ts';
import { aimListingOrder } from './laptop-view.ts';
import { emailText, IMP_REPORT_FILE, MAIL_TEXT_FILE, mailSubject } from './mail-text.ts';
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

const STUB_MAILS = JSON.parse(readFileSync(join(REPO_ROOT, 'stubs/text/email.json'), 'utf8')) as {
  readonly mails: Readonly<Record<string, readonly string[]>>;
};

async function newGame(seed: number): Promise<Laptop> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { hire: [] });
  created.useLabels(await loadUiStrings(kit.read, 'eng'));
  const session = drivenSession(created, stubSessionSources(kit));
  return { session, live: new ReloadingSession('laptop', session) };
}

function laptopOf(session: CampaignSession): LaptopView {
  const laptop = session.view().laptop;
  if (!laptop) throw new Error('the laptop is closed');
  return laptop;
}

function mailId(session: CampaignSession, type: string): number {
  const mail = laptopOf(session).emails.find((m) => m.type === type);
  if (!mail) throw new Error(`no ${type} mail`);
  return mail.id;
}

describe('the laptop view for the canvas pages', () => {
  it('raises the saved new-mail flag with every mail and clears it when the laptop closes', async () => {
    const { session, live } = await newGame(101);
    expect(laptopOf(session).newMail).toBe(true);
    expect(session.view().strategic?.newMail).toBe(true);
    expect(live.dispatch({ type: 'closeLaptop' })).toEqual({ ok: true });
    expect(session.view().strategic?.newMail).toBe(false);
    expect(live.dispatch({ type: 'openLaptop' })).toEqual({ ok: true });
    expect(laptopOf(session).newMail).toBe(false);
    const c = session.campaign.laptop?.content;
    if (!c) throw new Error('no laptop content');
    session.campaign.laptop?.mail(mailSpec(c, 'MERC_INTRO'), sender(c, 'SPECK_FROM_MERC'), { read: true });
    expect(laptopOf(session).newMail).toBe(true);
    expect(session.campaign.state.laptop.newMail).toBe(true);
  });

  it('sends the mail subjects in the view and the subject and body on emailText', async () => {
    const { session, live } = await newGame(102);
    const [subject, ...body] = STUB_MAILS.mails.IMP_EMAIL_INTRO ?? [];
    const id = mailId(session, 'IMP_EMAIL_INTRO');
    const mail = laptopOf(session).emails.find((m) => m.id === id);
    expect(mail).toMatchObject({ subject, length: body.length + 1 });
    expect(live.dispatch({ type: 'emailText', id })).toEqual({ ok: true, data: { id, subject, paragraphs: body } });
    expect(live.dispatch({ type: 'emailText', id: 999 })).toEqual({ ok: false, reason: 'noSuchMail' });
    const textless = new CampaignSession(session.campaign, session.presentation);
    expect(textless.dispatch({ type: 'emailText', id })).toEqual({ ok: false, reason: 'noText' });
    expect(session.campaign.state.laptop.emails.find((m) => m.id === id)?.read).toBe(false);
  });

  it('labels the ledger rows and sums the days as the finance summary page does', async () => {
    const { session, live } = await newGame(103);
    const start = laptopOf(session);
    expect(start.finances.map((r) => r.text)).toEqual(['Anonymous Deposit']);
    expect(start.financeSummary).toEqual({
      yesterday: { income: 0, otherDeposits: 0, debits: 0, closingBalance: 0 },
      today: { income: 0, otherDeposits: start.balance, debits: 0, balance: start.balance },
      projectedIncome: 0,
      projectedBalance: start.balance,
    });
    const profile = start.aim.find((a) => a.face === 'available')?.profile;
    if (profile === undefined) throw new Error('nobody is available');
    expect(live.dispatch({ type: 'aimHire', profile, contract: 1, gear: false })).toMatchObject({ ok: true });
    const nickname = laptopOf(session).aim.find((a) => a.profile === profile)?.nickname;
    const hired = laptopOf(session).finances.find((r) => r.code === FinanceCode.HIRED_MERC);
    expect(hired?.text).toBe(`Hired ${nickname} from AIM`);
    const after = laptopOf(session);
    expect(after.financeSummary.today.debits).toBe(after.balance - start.balance);
  });

  it('tells the conference the contact mode, the left message and the hire check before any money moves', async () => {
    const { session, live } = await newGame(104);
    const view = laptopOf(session);
    expect(view.aim.map((a) => a.profile)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const profileOf = (id: number) => {
      const found = session.campaign.state.profiles.get(id);
      if (!found) throw new Error('no profile');
      return found;
    };
    Object.assign(profileOf(1), { mercStatus: MercStatus.WORKING_ELSEWHERE, dayBecomesAvailable: 2 });
    expect(laptopOf(session).aim.find((a) => a.profile === 1)).toMatchObject({ contact: 'answeringMachine', messageLeft: false });
    expect(live.dispatch({ type: 'hireCheck', profile: 1 })).toEqual({
      ok: true,
      data: { profile: 1, contact: 'answeringMachine', accepted: false, refusal: 'away', quote: null },
    });
    expect(live.dispatch({ type: 'aimLeaveMessage', profile: 1 })).toEqual({ ok: true });
    expect(laptopOf(session).aim.find((a) => a.profile === 1)?.messageLeft).toBe(true);
    Object.assign(profileOf(1), { mercStatus: MercStatus.ANNOYED_WONT_CONTACT });
    expect(live.dispatch({ type: 'hireCheck', profile: 1 })).toMatchObject({
      ok: true,
      data: { contact: 'unavailable', accepted: false, refusal: 'unavailable', quote: null },
    });
    const available = laptopOf(session).aim.find((a) => a.contact === 'firstContact');
    if (!available) throw new Error('nobody answers');
    profileOf(available.profile).daysOfMoraleHangover = 1;
    const balance = session.campaign.state.finances.balance;
    expect(live.dispatch({ type: 'hireCheck', profile: available.profile })).toEqual({
      ok: true,
      data: {
        profile: available.profile,
        contact: 'firstContact',
        accepted: false,
        refusal: 'hangover',
        quote: { id: 82, name: 'LAME_REFUSAL' },
      },
    });
    expect(live.dispatch({ type: 'aimHire', profile: available.profile, contract: 7 })).toMatchObject({
      ok: false,
      reason: 'hangover',
      data: { quote: { id: 82, name: 'LAME_REFUSAL' } },
    });
    profileOf(available.profile).daysOfMoraleHangover = 0;
    expect(live.dispatch({ type: 'hireCheck', profile: available.profile })).toMatchObject({
      ok: true,
      data: { accepted: true, quote: null },
    });
    expect(live.dispatch({ type: 'hireCheck', profile: 99 })).toEqual({ ok: false, reason: 'notAimMerc' });
    expect(session.campaign.state.finances.balance).toBe(balance);
  });
});

describe('the A.I.M. listing order', () => {
  it('follows mercs-AIM-listings.json and appends the A.I.M. profiles it leaves out by id', () => {
    const aim = new Set([0, 1, 2, 5, 7]);
    const mercType = (id: number) => (aim.has(id) ? MercType.AIM : undefined);
    expect(aimListingOrder({ aimListings: [7, 2, 30, 0], mercType })).toEqual([7, 2, 0, 1, 5]);
  });
});

describe('visiting a site', () => {
  it('bookmarks the funeral home, the florist and the insurer and refuses unknown sites', async () => {
    const { session, live } = await newGame(111);
    expect(live.dispatch({ type: 'visitSite', site: 'moon' })).toEqual({ ok: false, reason: 'badSite' });
    expect(live.dispatch({ type: 'visitSite', site: 'florist' })).toEqual({
      ok: true,
      data: { site: 'florist', bookmarks: ['aim', 'florist'] },
    });
    live.dispatch({ type: 'visitSite', site: 'insurance' });
    live.dispatch({ type: 'visitSite', site: 'funeral' });
    live.dispatch({ type: 'visitSite', site: 'florist' });
    expect(laptopOf(session).bookmarks).toEqual(['aim', 'florist', 'insurance', 'funeral']);
    live.dispatch({ type: 'closeLaptop' });
    expect(live.dispatch({ type: 'visitSite', site: 'florist' })).toEqual({ ok: false, reason: 'laptopClosed' });
  });

  it("gates the Bobby Ray's mail on a visit while the site is under construction", async () => {
    const b13 = parseSectorString('B13');
    const visited = await newGame(112);
    expect(visited.live.dispatch({ type: 'visitSite', site: 'bobbyRay' })).toMatchObject({
      ok: true,
      data: { bookmarks: ['aim', 'bobbyRay'] },
    });
    expect(visited.session.campaign.state.laptop.bobbyRay.underConstructionVisit).toBe(BobbyRaySiteVisit.BEEN_TO_SITE_ONCE);
    visited.session.campaign.laptop?.surfaceSectorTaken(b13);
    expect(laptopOf(visited.session).emails.at(-1)?.type).toBe('BOBBYR_NOW_OPEN');
    const unvisited = await newGame(113);
    unvisited.session.campaign.laptop?.surfaceSectorTaken(b13);
    expect(laptopOf(unvisited.session).emails.some((m) => m.type === 'BOBBYR_NOW_OPEN')).toBe(false);
    expect(laptopOf(unvisited.session).bobbyRay.open).toBe(true);
  });

  it("counts every visit to M.E.R.C. and plays Speck's opening once per laptop session", async () => {
    const { session, live } = await newGame(114);
    const merc = () => session.campaign.state.laptop.merc;
    expect(live.dispatch({ type: 'visitSite', site: 'merc' })).toEqual({ ok: false, reason: 'noBookmark' });
    session.campaign.state.laptop.bookmarks.push(Bookmark.MERC);
    const first = live.dispatch({ type: 'visitSite', site: 'merc' });
    const firstSpeck = (first.data as { speck: number[] }).speck;
    expect(firstSpeck[0]).toBe(SpeckQuote.FIRST_TIME_IN);
    expect(firstSpeck.slice(-8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(merc().playerBeenToSiteStatus).toBe(MercSiteVisit.FIRST_VISIT);
    expect(live.dispatch({ type: 'visitSite', site: 'merc' })).toEqual({
      ok: true,
      data: { site: 'merc', bookmarks: ['aim', 'merc'] },
    });
    expect(merc().playerBeenToSiteStatus).toBe(MercSiteVisit.SECOND_VISIT);
    expect(live.dispatch({ type: 'mercOpenAccount' })).toMatchObject({ ok: true });
    expect(merc().playerBeenToSiteStatus).toBe(MercSiteVisit.SECOND_VISIT);
    live.dispatch({ type: 'closeLaptop' });
    live.dispatch({ type: 'openLaptop' });
    const third = live.dispatch({ type: 'visitSite', site: 'merc' });
    expect((third.data as { speck: number[] }).speck[0]).toBe(SpeckQuote.BUSINESS_BAD);
    expect(merc().playerBeenToSiteStatus).toBe(MercSiteVisit.THIRD_OR_MORE_VISITS);
    Object.assign(merc(), { siteHasGoneDownYet: true, firstVisitSinceServerWentDown: 0 });
    expect(live.dispatch({ type: 'visitSite', site: 'merc' })).toEqual({ ok: false, reason: 'siteDown' });
  });

  it('keeps the opening for agents that never visit: the first M.E.R.C. command of a session runs it', async () => {
    const { session, live } = await newGame(115);
    session.campaign.state.laptop.bookmarks.push(Bookmark.MERC);
    expect(live.dispatch({ type: 'mercOpenAccount' })).toMatchObject({ ok: true });
    expect(session.campaign.state.laptop.merc.playerBeenToSiteStatus).toBe(MercSiteVisit.FIRST_VISIT);
    expect(live.dispatch({ type: 'visitSite', site: 'merc' })).toEqual({
      ok: true,
      data: { site: 'merc', bookmarks: ['aim', 'merc'] },
    });
    expect(session.campaign.state.laptop.merc.playerBeenToSiteStatus).toBe(MercSiteVisit.SECOND_VISIT);
  });
});

describe('the mail text the server assembles', () => {
  const REFUND_TEMPLATE = 'Refund for $MERCNAME$: $AMOUN$ ($AMOUN$)';

  function fakeTexts(templates: ReadonlyMap<string, string>): TextSource {
    return {
      text: (key: TextKey) => templates.get(`${key.file}:${key.row}`) ?? `${key.file === IMP_REPORT_FILE ? 'imp' : 'mail'}:${key.row}`,
    };
  }

  it('substitutes the merc name and the amount in every subject and in the bodies of the refund and insurance mails', async () => {
    const { session } = await newGame(121);
    const flow = session.campaign.laptop;
    if (!flow) throw new Error('no laptop');
    const c = flow.content;
    const refund = flow.mail(mailSpec(c, 'AIM_MEDICAL_DEPOSIT_REFUND'), sender(c, 'AIM_SITE'), { firstData: -1500, secondData: 0 });
    const plain = flow.mail(mailSpec(c, 'MERC_INTRO'), sender(c, 'SPECK_FROM_MERC'), { firstData: 7, secondData: 0 });
    const templates = new Map([
      [`${MAIL_TEXT_FILE}:${refund.offset}`, REFUND_TEMPLATE],
      [`${MAIL_TEXT_FILE}:${refund.offset + 1}`, REFUND_TEMPLATE],
      [`${MAIL_TEXT_FILE}:${plain.offset}`, REFUND_TEMPLATE],
      [`${MAIL_TEXT_FILE}:${plain.offset + 1}`, REFUND_TEMPLATE],
    ]);
    const name = flow.profileRecord(0)?.name ?? '';
    const texts = fakeTexts(templates);
    const substitutedText = `Refund for ${name}: $-1,500 ($-1,500)`;
    expect(mailSubject(session.campaign, refund, texts)).toBe(substitutedText);
    expect(emailText(session.campaign, refund, texts)).toEqual({
      id: refund.id,
      subject: substitutedText,
      paragraphs: [substitutedText, `mail:${refund.offset + 2}`],
    });
    const plainText = emailText(session.campaign, plain, texts);
    expect(plainText?.subject).toBe(`Refund for ${name}: $7 ($7)`);
    expect(plainText?.paragraphs[0]).toBe(REFUND_TEMPLATE);
    expect(plainText?.paragraphs).toHaveLength(plain.length - 1);
  });

  it('builds the I.M.P. report from impass.edt for the profile of the mail, the name after the first record', async () => {
    const { session, live } = await newGame(122);
    live.dispatch({ type: 'readEmail', id: mailId(session, 'IMP_EMAIL_INTRO') });
    const created = live.dispatch({
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
    });
    const profile = (created.data as { profile: number }).profile;
    const flow = session.campaign.laptop;
    const record = flow?.profileRecord(profile);
    if (!flow || !record) throw new Error('no character');
    const c = flow.content;
    const named = flow.mail(mailSpec(c, 'IMP_EMAIL_PROFILE_RESULTS'), sender(c, 'IMP_PROFILE_RESULTS'), { firstData: profile });
    const legacy = flow.mail(mailSpec(c, 'IMP_EMAIL_PROFILE_RESULTS'), sender(c, 'IMP_PROFILE_RESULTS'), { firstData: 0 });
    session.campaign.state.laptop.imp.voiceId = profile - PLAYER_GENERATED_CHARACTER_ID;
    const texts = fakeTexts(new Map());
    const expected = (id: number) =>
      impReportRows({ ...record, initial: record }, c.imp.portraits, id % 2 === 0).map((r) =>
        r.appendName ? `imp:${r.row} Stub Tester` : `imp:${r.row}`,
      );
    expect(emailText(session.campaign, named, texts)).toEqual({
      id: named.id,
      subject: `mail:${named.offset}`,
      paragraphs: expected(named.id),
    });
    expect(emailText(session.campaign, legacy, texts)?.paragraphs).toEqual(expected(legacy.id));
    expect(expected(named.id)).not.toEqual(expected(legacy.id));
  });
});
