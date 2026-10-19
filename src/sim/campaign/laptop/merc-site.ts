// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Mercs.cc GameInitMercs, EnterMercs (visit count), GetSpeckConditionalOpening (with the quote ids it
// @src queues; the intro quotes 1-8 follow the tags, as the repeated calls queue them), IsSpeckTryingToRecruit,
// @src DailyUpdateOfMercSite (the part after the account), ShouldTheMercSiteServerGoDown, GetMercSiteBackOnline,
// @src GetProfileIDFromMERCListing, HasLarryRelapsed, MakeBiffAwayForCoupleOfDays, AreAnyOfTheNewMercsAvailable,
// @src ScheduleNewMercsToBeAvailable, CanMercBeAvailableYet, SetLastMercArrival, MakeNewMercsAvailable,
// @src NewMercsAvailableAtMercSiteCallBack, IsMercMercAvailable, ShouldSpeckStartTalkingDueToActionOnSubPage (the coin toss),
// @src IsAnyMercMercsHired, IsAnyMercMercsDead, CountNumberOfMercMercsHired, CountNumberOfMercMercsWhoAreDead, CalcMercDaysServed;
// @src Laptop/Mercs_No_Account.cc BtnOpenAccountBoxButtonCallback; Laptop/Mercs_Files.cc BtnMercHireButtonCallback,
// @src MercFilesHireMerc; Laptop/Mercs_Account.cc SettleMercAccounts, CalculateHowMuchPlayerOwesSpeck; Laptop/Speck_Quotes.h.
// @src See docs/21 §3.

import type { MercListing } from '../../../content/strategic/laptop-content.ts';
import { i32, u32 } from '../../../core/int.ts';
import { InsertionCode } from '../../strategic/forces/constants.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { fact } from '../../strategic/narrative/facts.ts';
import { EventKind, NUM_MIN_IN_HOUR } from '../../strategic/time/constants.ts';
import { addStrategicEvent } from '../../strategic/time/event-queue.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import { midnightOfFutureDay } from '../contracts/contract-times.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { ProfileMiscFlag3 } from '../profiles.ts';
import { isMercOnTeam } from '../relations/relations.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { LaptopContext } from './context.ts';
import { type HireHooks, hireMercCore } from './hire.ts';
import { Bookmark, MercAccountStatus, MercSiteVisit, SpeckQuoteFlag, setBookmark } from './laptop-state.ts';
import { mailSpec, sender } from './mail.ts';
import { isMercDead, isMercHireable } from './profile-state.ts';
import { History } from './records.ts';

const ACCOUNT_NUMBERS = 99999;
const LastMercArrival = { BUBBA: 0, LARRY: 1, NUMB: 2, COUGAR: 3 } as const;
const NEW_MERC_EVENT_HOUR_MINUTES = 420;
const NEW_MERC_EVENT_SPREAD = 3 * NUM_MIN_IN_HOUR;
const BACK_ONLINE_MINUTES = 18 * NUM_MIN_IN_HOUR;
const SERVER_DOWN_BASE = 10;
const SERVER_DOWN_PER_DAY = 2;
const DAILY_DIE = 100;
const BUSINESS_GOOD = 40;
const TRYING_TO_RECRUIT = 80;
const OWES_A_LOT = 5000;
const IDLE_TAGS = 4;
const BIFF_AWAY_BASE = 2;
const BIFF_AWAY_SPREAD = 2;
const FIRST_VISIT_SINCE_DOWN = 1;
const SPOKEN_SINCE_DOWN = 2;

export const SpeckQuote = {
  FIRST_TIME_IN: 0,
  LAST_FIRST_TIME_IN: 8,
  TOUGH_START: 10,
  BUSINESS_BAD: 11,
  BUSINESS_GOOD: 12,
  TRYING_TO_RECRUIT: 13,
  ACCOUNT_SUSPENDED: 14,
  ALMOST_BANKRUPT_1: 15,
  ALMOST_BANKRUPT_2: 16,
  FIRST_VISIT_SINCE_SERVER_WENT_DOWN: 19,
  GENERIC_OPENING: 20,
  TAG_FOR_GENERIC_OPENING: 21,
  NEW_MERCS_AVAILABLE: 22,
  PLAYERS_LOST_MERCS: 23,
  TAG_PLAYER_OWES_MONEY: 24,
  FIRST_MERC_DIES: 27,
  FLO_IS_DEAD_BIFF_ALIVE: 32,
  FLO_IS_DEAD_BIFF_IS_DEAD: 33,
  FLO_MARRIED_A_COUSIN_BIFF_IS_ALIVE: 34,
  LARRY_RELAPSED: 37,
  FIRST_IDLE_TAG: 41,
} as const;

export type MercCommandRefusal = 'noBookmark' | 'siteDown';
export type MercHireRefusal =
  | MercCommandRefusal
  | 'noAccount'
  | 'accountSuspended'
  | 'accountInvalid'
  | 'notListed'
  | 'unavailable'
  | 'teamFull'
  | 'cannotHire';

export function larryRelapsed(ctx: LaptopContext): boolean {
  return fact(ctx.state.narrative, Fact.LARRY_CHANGED);
}

export function listingProfile(ctx: LaptopContext, listing: MercListing): number {
  const named = ctx.content.namedProfiles;
  return listing.profile === named.LARRY_NORMAL && larryRelapsed(ctx) ? (named.LARRY_DRUNK ?? listing.profile) : listing.profile;
}

function listed(ctx: LaptopContext): { readonly listing: MercListing; readonly profile: number; readonly p: ProfileProgress }[] {
  return ctx.content.mercListings.flatMap((listing) => {
    const profile = listingProfile(ctx, listing);
    const p = ctx.profile(profile);
    return p ? [{ listing, profile, p }] : [];
  });
}

export function isMercListed(ctx: LaptopContext, listing: MercListing): boolean {
  return listing.index <= ctx.laptop.merc.lastMercIndex;
}

export function isMercMercAvailable(ctx: LaptopContext, profile: number): boolean {
  for (const { listing, profile: id, p } of listed(ctx)) {
    if (!isMercListed(ctx, listing)) break;
    if (id === profile) return isMercHireable(p);
  }
  return false;
}

export function canMercBeAvailableYet(ctx: LaptopContext, listing: MercListing): boolean {
  if (isMercListed(ctx, listing)) return false;
  const p = ctx.profile(listingProfile(ctx, listing));
  if (!p || !isMercHireable(p)) return false;
  return listing.minTotalSpending <= ctx.laptop.merc.totalMoneyPaidToSpeck && listing.minDays <= ctx.day();
}

function lastMercArrival(ctx: LaptopContext, listing: MercListing): number | null {
  const named = ctx.content.namedProfiles;
  if (listing.profile === named.BUBBA) return LastMercArrival.BUBBA;
  if (listing.profile === named.COUGAR) return LastMercArrival.COUGAR;
  if (listing.profile === named.NUMB) return LastMercArrival.NUMB;
  if (listing.profile === named.LARRY_NORMAL) return LastMercArrival.LARRY;
  return null;
}

export function makeNewMercsAvailable(ctx: LaptopContext, notify: boolean): void {
  const merc = ctx.laptop.merc;
  let revealed = false;
  for (const listing of ctx.content.mercListings) {
    if (!canMercBeAvailableYet(ctx, listing) || merc.lastMercIndex >= listing.index) continue;
    merc.lastMercIndex = listing.index;
    merc.lastMercAvailableId = lastMercArrival(ctx, listing) ?? merc.lastMercAvailableId;
    revealed = true;
  }
  if (!revealed || !notify) return;
  ctx.mail(mailSpec(ctx.content, 'NEW_MERCS_AT_MERC'), sender(ctx.content, 'SPECK_FROM_MERC'));
  merc.newMercsAvailable = true;
}

function scheduleNewMercsToBeAvailable(ctx: LaptopContext): void {
  if (!ctx.content.mercListings.some((listing) => canMercBeAvailableYet(ctx, listing))) return;
  const s = ctx.state;
  const minute = midnightOfFutureDay(ctx.now(), 1) + NEW_MERC_EVENT_HOUR_MINUTES + ctx.rng.main.int(NEW_MERC_EVENT_SPREAD);
  addStrategicEvent(s.queue, EventKind.MERC_SITE_NEW_MERC_AVAILABLE, minute, 0);
}

function shouldTheMercSiteServerGoDown(ctx: LaptopContext): boolean {
  const merc = ctx.laptop.merc;
  if (merc.siteHasGoneDownYet || merc.lastMercAvailableId < LastMercArrival.LARRY || merc.accountStatus !== MercAccountStatus.VALID)
    return false;
  return ctx.rng.main.int(DAILY_DIE) < ctx.day() * SERVER_DOWN_PER_DAY + SERVER_DOWN_BASE;
}

export function mercSiteDailyUpdate(ctx: LaptopContext): void {
  scheduleNewMercsToBeAvailable(ctx);
  if (!shouldTheMercSiteServerGoDown(ctx)) return;
  ctx.laptop.merc.siteHasGoneDownYet = true;
  addStrategicEvent(ctx.state.queue, EventKind.MERC_SITE_BACK_ONLINE, midnightOfFutureDay(ctx.now(), 1) + BACK_ONLINE_MINUTES, 0);
}

export function getMercSiteBackOnline(ctx: LaptopContext): void {
  ctx.mail(mailSpec(ctx.content, 'MERC_NEW_SITE_ADDRESS'), sender(ctx.content, 'SPECK_FROM_MERC'));
  ctx.laptop.merc.firstVisitSinceServerWentDown = FIRST_VISIT_SINCE_DOWN;
}

export function isMercSiteDown(ctx: LaptopContext): boolean {
  const merc = ctx.laptop.merc;
  return merc.siteHasGoneDownYet && merc.firstVisitSinceServerWentDown === 0;
}

export function mercCommandRefusal(ctx: LaptopContext): MercCommandRefusal | null {
  if (!ctx.laptop.bookmarks.includes(Bookmark.MERC)) return 'noBookmark';
  if (isMercSiteDown(ctx)) return 'siteDown';
  return null;
}

function mercMercsOnTeam(ctx: LaptopContext): number {
  return listed(ctx).filter(({ profile }) => isMercOnTeam(ctx.team(), profile)).length;
}

function deadMercMercs(ctx: LaptopContext): number {
  return listed(ctx).filter(({ p }) => isMercDead(p)).length;
}

export function owedToSpeck(ctx: LaptopContext): number {
  return listed(ctx).reduce((sum, { p }) => u32(sum + p.salary * p.mercMercContractLength), 0);
}

function mercDaysServed(ctx: LaptopContext): number {
  return listed(ctx).reduce((sum, { p }) => u32(sum + p.totalDaysServed), 0);
}

function areAnyOfTheNewMercsAvailable(ctx: LaptopContext): boolean {
  if (ctx.laptop.merc.newMercsAvailable) return false;
  return listed(ctx).some(
    ({ listing, profile }) => !(listing.minDays === 0 && listing.minTotalSpending === 0) && isMercMercAvailable(ctx, profile),
  );
}

function isSpeckTryingToRecruit(ctx: LaptopContext): boolean {
  const listings = ctx.content.mercListings;
  const next = listings[ctx.laptop.merc.lastMercIndex + 1];
  return next !== undefined && canMercBeAvailableYet(ctx, next);
}

function makeBiffAwayForCoupleOfDays(ctx: LaptopContext): void {
  const biff = ctx.profile(ctx.content.namedProfiles.BIFF ?? -1);
  const days = ctx.rng.main.int(BIFF_AWAY_SPREAD) + BIFF_AWAY_BASE;
  if (biff) biff.dayBecomesAvailable = days;
}

export function enterMercSite(ctx: LaptopContext): void {
  const merc = ctx.laptop.merc;
  setBookmark(ctx.laptop, Bookmark.MERC);
  if (merc.playerBeenToSiteStatus === MercSiteVisit.NEVER_VISITED) merc.playerBeenToSiteStatus = MercSiteVisit.FIRST_VISIT;
  else if (merc.playerBeenToSiteStatus === MercSiteVisit.FIRST_VISIT) merc.playerBeenToSiteStatus = MercSiteVisit.SECOND_VISIT;
  else merc.playerBeenToSiteStatus = MercSiteVisit.THIRD_OR_MORE_VISITS;
}

function businessOrRecruitingOpening(ctx: LaptopContext, roll: number): number | null {
  if (roll < BUSINESS_GOOD && areAnyOfTheNewMercsAvailable(ctx) && mercMercsOnTeam(ctx) > 1) return SpeckQuote.BUSINESS_GOOD;
  if (roll < TRYING_TO_RECRUIT && isSpeckTryingToRecruit(ctx)) return SpeckQuote.TRYING_TO_RECRUIT;
  return null;
}

function genericOpening(ctx: LaptopContext, quotes: number[]): void {
  const merc = ctx.laptop.merc;
  const quote = businessOrRecruitingOpening(ctx, ctx.rng.main.int(DAILY_DIE));
  if (quote !== null) {
    quotes.push(quote);
    return;
  }
  quotes.push(SpeckQuote.GENERIC_OPENING);
  if (merc.saidGenericOpening) return;
  merc.saidGenericOpening = true;
  quotes.push(SpeckQuote.TAG_FOR_GENERIC_OPENING);
}

function laterVisitOpening(ctx: LaptopContext, quotes: number[]): boolean {
  const merc = ctx.laptop.merc;
  const main = ctx.rng.main;
  if (mercMercsOnTeam(ctx) === 0 && mercDaysServed(ctx) === 0) {
    quotes.push(SpeckQuote.BUSINESS_BAD);
    return true;
  }
  let canUseIdleTag = true;
  let canSayLackOfPayment = true;
  if (merc.firstVisitSinceServerWentDown === FIRST_VISIT_SINCE_DOWN) {
    merc.firstVisitSinceServerWentDown = SPOKEN_SINCE_DOWN;
    quotes.push(SpeckQuote.FIRST_VISIT_SINCE_SERVER_WENT_DOWN);
  } else if (deadMercMercs(ctx) >= 2 && merc.speckCanSayPlayersLostQuote) {
    merc.speckCanSayPlayersLostQuote = 0;
    quotes.push(SpeckQuote.PLAYERS_LOST_MERCS);
    canUseIdleTag = false;
  } else if (merc.accountStatus === MercAccountStatus.SUSPENDED) {
    quotes.push(SpeckQuote.ACCOUNT_SUSPENDED);
    canSayLackOfPayment = false;
    canUseIdleTag = false;
  } else if (owedToSpeck(ctx) > OWES_A_LOT) {
    quotes.push(SpeckQuote.ALMOST_BANKRUPT_1, SpeckQuote.ALMOST_BANKRUPT_2);
    canSayLackOfPayment = false;
    canUseIdleTag = false;
  } else genericOpening(ctx, quotes);
  if (canUseIdleTag && main.int(DAILY_DIE) < DAILY_DIE / 2) quotes.push(SpeckQuote.FIRST_IDLE_TAG + main.int(IDLE_TAGS));
  return canSayLackOfPayment;
}

function deadMercQuotes(ctx: LaptopContext, quotes: number[]): void {
  const merc = ctx.laptop.merc;
  const named = ctx.content.namedProfiles;
  if (deadMercMercs(ctx) === 0) return;
  if (!merc.hasAMercDiedAtSite) {
    merc.hasAMercDiedAtSite = true;
    quotes.push(SpeckQuote.FIRST_MERC_DIES);
  }
  for (const { listing, profile, p } of listed(ctx)) {
    if (!isMercDead(p) || p.miscFlags3 & ProfileMiscFlag3.MERC_MERC_IS_DEAD_AND_QUOTE_SAID) continue;
    p.miscFlags3 |= ProfileMiscFlag3.MERC_MERC_IS_DEAD_AND_QUOTE_SAID;
    if (profile === named.FLO) {
      const biff = ctx.profile(named.BIFF ?? -1);
      if (biff && !isMercDead(biff)) {
        quotes.push(SpeckQuote.FLO_IS_DEAD_BIFF_ALIVE);
        makeBiffAwayForCoupleOfDays(ctx);
      } else quotes.push(SpeckQuote.FLO_IS_DEAD_BIFF_IS_DEAD);
      continue;
    }
    const dead = listing.quotes.find((q) => q.type === 'MERC_DEAD');
    if (dead) quotes.push(dead.quote);
  }
}

function openingTail(ctx: LaptopContext, canSayLackOfPayment: boolean, quotes: number[]): void {
  const merc = ctx.laptop.merc;
  if (canSayLackOfPayment && merc.speckQuoteFlags & SpeckQuoteFlag.SENT_EMAIL_ABOUT_LACK_OF_PAYMENT) {
    merc.speckQuoteFlags &= ~SpeckQuoteFlag.SENT_EMAIL_ABOUT_LACK_OF_PAYMENT;
    quotes.push(SpeckQuote.TAG_PLAYER_OWES_MONEY);
  }
  if (merc.newMercsAvailable) {
    merc.newMercsAvailable = false;
    quotes.push(SpeckQuote.NEW_MERCS_AVAILABLE);
  }
  deadMercQuotes(ctx, quotes);
  const biff = ctx.profile(ctx.content.namedProfiles.BIFF ?? -1);
  if (fact(ctx.state.narrative, Fact.PC_MARRYING_DARYL_IS_FLO) && !merc.speckSaidFloMarriedCousinQuote && biff && !isMercDead(biff)) {
    merc.speckSaidFloMarriedCousinQuote = true;
    quotes.push(SpeckQuote.FLO_MARRIED_A_COUSIN_BIFF_IS_ALIVE);
    makeBiffAwayForCoupleOfDays(ctx);
  }
  if (larryRelapsed(ctx) && !(merc.speckQuoteFlags & SpeckQuoteFlag.ALREADY_TOLD_PLAYER_THAT_LARRY_RELAPSED)) {
    merc.speckQuoteFlags |= SpeckQuoteFlag.ALREADY_TOLD_PLAYER_THAT_LARRY_RELAPSED;
    quotes.push(SpeckQuote.LARRY_RELAPSED);
  }
}

export function speckOpening(ctx: LaptopContext): number[] {
  const status = ctx.laptop.merc.playerBeenToSiteStatus;
  const quotes: number[] = [];
  let canSayLackOfPayment = true;
  if (status === MercSiteVisit.FIRST_VISIT) quotes.push(SpeckQuote.FIRST_TIME_IN);
  else if (status === MercSiteVisit.SECOND_VISIT) quotes.push(SpeckQuote.TOUGH_START);
  else canSayLackOfPayment = laterVisitOpening(ctx, quotes);
  openingTail(ctx, canSayLackOfPayment, quotes);
  if (status === MercSiteVisit.FIRST_VISIT) quotes.push(...range(SpeckQuote.FIRST_TIME_IN + 1, SpeckQuote.LAST_FIRST_TIME_IN));
  return quotes;
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function openMercAccount(ctx: LaptopContext): void {
  const merc = ctx.laptop.merc;
  merc.accountStatus = MercAccountStatus.VALID;
  merc.accountNumber = ctx.rng.main.int(ACCOUNT_NUMBERS);
}

export function mercHireRefusal(ctx: LaptopContext, profile: number): MercHireRefusal | null {
  const site = mercCommandRefusal(ctx);
  if (site) return site;
  const merc = ctx.laptop.merc;
  const entry = listed(ctx).find((e) => e.profile === profile);
  if (!entry || !isMercListed(ctx, entry.listing)) return 'notListed';
  if (merc.accountStatus === MercAccountStatus.NO_ACCOUNT) return 'noAccount';
  if (merc.accountStatus === MercAccountStatus.INVALID) return 'accountInvalid';
  if (isMercDead(entry.p)) return 'unavailable';
  if (merc.accountStatus === MercAccountStatus.SUSPENDED) return 'accountSuspended';
  if (!isMercHireable(entry.p)) return 'unavailable';
  return null;
}

export type MercHireResult =
  | { readonly ok: true; readonly merc: RosterMerc; readonly arrival: number }
  | { readonly ok: false; readonly reason: MercHireRefusal };

export function mercHire(ctx: LaptopContext, profile: number, hooks: HireHooks): MercHireResult {
  const refusal = mercHireRefusal(ctx, profile);
  if (refusal) return { ok: false, reason: refusal };
  return hireMercMerc(ctx, profile, hooks);
}

export function hireMercMerc(ctx: LaptopContext, profile: number, hooks: HireHooks): MercHireResult {
  const outcome = hireMercCore(
    ctx,
    { profile, kind: MercKind.MERC, length: 1, copyItems: true, insertion: InsertionCode.NORTH, useLandingZone: true },
    hooks,
  );
  if (outcome === 'failed') return { ok: false, reason: 'cannotHire' };
  if (outcome === 'teamFull') return { ok: false, reason: 'teamFull' };
  return { ok: true, merc: outcome.merc, arrival: outcome.arrival };
}

export interface MercDebt {
  readonly profile: number;
  readonly days: number;
  readonly salary: number;
  readonly owed: number;
}

export function mercDebts(ctx: LaptopContext): MercDebt[] {
  return listed(ctx)
    .filter(({ profile, p }) => isMercOnTeam(ctx.team(), profile) || p.mercMercContractLength !== 0)
    .map(({ profile, p }) => ({ profile, days: p.mercMercContractLength, salary: p.salary, owed: p.salary * p.mercMercContractLength }));
}

export type MercPayResult =
  | { readonly ok: true; readonly paid: number; readonly full: boolean }
  | { readonly ok: false; readonly reason: 'nothingOwed' | 'funds' | MercCommandRefusal };

export function settleMercAccounts(ctx: LaptopContext): MercPayResult {
  const site = mercCommandRefusal(ctx);
  if (site) return { ok: false, reason: site };
  return payMercAccounts(ctx);
}

export function payMercAccounts(ctx: LaptopContext): MercPayResult {
  const debts = mercDebts(ctx);
  const total = debts.reduce((sum, d) => sum + d.owed, 0);
  if (total === 0) return { ok: false, reason: 'nothingOwed' };
  const f = ctx.state.finances;
  let paid = 0;
  let firstPaid: number | null = null;
  for (const { profile, p } of listed(ctx)) {
    if (!isMercOnTeam(ctx.team(), profile) && p.mercMercContractLength === 0) continue;
    const charge = i32(p.salary * p.mercMercContractLength);
    if (f.balance < paid + charge) continue;
    p.mercMercContractLength = 0;
    paid += charge;
    f.profileCostToDate.set(profile, u32((f.profileCostToDate.get(profile) ?? 0) + charge));
    firstPaid ??= profile;
  }
  if (paid === 0) return { ok: false, reason: 'funds' };
  const who = firstPaid ?? 0;
  ctx.emitMoney(addTransaction(f, FinanceCode.PAY_SPECK_FOR_MERC, who, ctx.now(), -paid));
  ctx.history(History.SETTLED_ACCOUNTS_AT_MERC, who, null);
  const merc = ctx.laptop.merc;
  merc.totalMoneyPaidToSpeck = u32(merc.totalMoneyPaidToSpeck + paid);
  const full = paid === total;
  if (full) {
    merc.accountStatus = MercAccountStatus.VALID;
    merc.speckQuoteFlags &= ~SpeckQuoteFlag.SENT_EMAIL_ABOUT_LACK_OF_PAYMENT;
  }
  return { ok: true, paid, full };
}
