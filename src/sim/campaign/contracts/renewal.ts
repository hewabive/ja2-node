// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Merc_Contract.cc FindRefusalReason, WillMercRenew, FindOutIfAnyMercAboutToLeaveIsGonnaRenew,
// @src BeginContractRenewalSequence, HandleContractRenewalSequence, EndCurrentContractRenewal; Tactical/Dialogue_Control.cc
// @src GetMercPrecedentQuoteBitStatus, SetMercPrecedentQuoteBitStatus; Strategic/Map_Screen_Interface.cc
// @src CheckIfSalaryIncreasedAndSayQuote; Strategic/MapScreen.cc CanExtendContractForSoldier,
// @src HandleShadingOfLinesForContractMenu.

import { sameSector } from '../../../content/strategic/sector-ids.ts';
import { idiv, u32 } from '../../../core/int.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { OKLIFE, SoldierStatusFlags } from '../../tactical/soldier.ts';
import {
  BuddySlot,
  findMercByProfile,
  getFirstBuddyOnTeam,
  HatedSlot,
  isMercOnTeamAndArrivedAndAlive,
  NO_RELATION,
} from '../relations/relations.ts';
import { mercThinksDeathRateTooHigh, mercThinksHisMoraleIsTooLow } from '../relations/reputation.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { ContractContext } from './context.ts';
import { MAX_CONTRACT_RENEWALS, RenewalQuoteCode, type RenewalSequence } from './contract-state.ts';
import { clockReading, contractIsExpiring, contractIsGoingToExpireSoon } from './contract-times.ts';
import type { RefusalReason } from './events.ts';
import { precedentBitMask, Quote, type QuoteName } from './quotes.ts';

const MIN_BLEEDING_THRESHOLD = 12;

export interface Refusal {
  readonly quote: QuoteName;
  readonly subject?: number;
}

export const REFUSAL_REASONS: Readonly<Partial<Record<QuoteName, RefusalReason>>> = {
  WONT_RENEW_CONTRACT_LAME_REFUSAL: 'signedElsewhere',
  HATE_MERC_1_ON_TEAM_WONT_RENEW: 'hatedMerc',
  HATE_MERC_2_ON_TEAM_WONT_RENEW: 'hatedMerc',
  LEARNED_TO_HATE_MERC_1_ON_TEAM_WONT_RENEW: 'learnedToHate',
  DEATH_RATE_RENEWAL: 'deathRate',
  REFUSAL_RENEW_DUE_TO_MORALE: 'morale',
};

const HATED_REFUSALS: Readonly<Record<number, QuoteName>> = {
  [HatedSlot.SLOT1]: 'HATE_MERC_1_ON_TEAM_WONT_RENEW',
  [HatedSlot.SLOT2]: 'HATE_MERC_2_ON_TEAM_WONT_RENEW',
};

const BUDDY_RENEWALS: Readonly<Record<number, QuoteName>> = {
  [BuddySlot.SLOT1]: 'RENEWING_CAUSE_BUDDY_1_ON_TEAM',
  [BuddySlot.SLOT2]: 'RENEWING_CAUSE_BUDDY_2_ON_TEAM',
  [BuddySlot.LEARNED_TO_LIKE]: 'RENEWING_CAUSE_LEARNED_TO_LIKE_BUDDY_ON_TEAM',
};

function hatedInReach(ctx: ContractContext, m: RosterMerc, hated: number): boolean {
  const other = findMercByProfile(ctx.team(), hated);
  return other !== undefined && sameSector(other.sector, m.sector);
}

export function findRefusalReason(ctx: ContractContext, m: RosterMerc): Refusal | null {
  const p = ctx.profile(m.profile);
  if (!p) return null;
  const team = ctx.team();
  for (let slot = HatedSlot.SLOT1; slot <= HatedSlot.SLOT2; slot++) {
    const hated = p.hated[slot] ?? NO_RELATION;
    if (hated < 0 || !isMercOnTeamAndArrivedAndAlive(team, hated)) continue;
    if ((p.hatedCount[slot] ?? 0) !== 0 && !hatedInReach(ctx, m, hated)) continue;
    return { quote: HATED_REFUSALS[slot] ?? 'HATE_MERC_1_ON_TEAM_WONT_RENEW', subject: hated };
  }
  const learned = p.learnToHate;
  if (learned >= 0 && isMercOnTeamAndArrivedAndAlive(team, learned)) {
    if (p.learnToHateCount === 0) return { quote: 'LEARNED_TO_HATE_MERC_1_ON_TEAM_WONT_RENEW', subject: learned };
    if (p.learnToHateCount <= idiv(p.learnToHateTime, 2) && hatedInReach(ctx, m, learned))
      return { quote: 'LEARNED_TO_HATE_MERC_1_ON_TEAM_WONT_RENEW', subject: learned };
  }
  if (mercThinksDeathRateTooHigh(ctx.state.status, p)) return { quote: 'DEATH_RATE_RENEWAL' };
  if (mercThinksHisMoraleIsTooLow(p, m.soldier.morale)) return { quote: 'REFUSAL_RENEW_DUE_TO_MORALE' };
  return null;
}

export interface Willingness {
  readonly willing: boolean;
  readonly refusal: Refusal | null;
}

export function mercRenewalWillingness(ctx: ContractContext, m: RosterMerc, sayQuote: boolean): Willingness {
  if (m.kind !== MercKind.AIM_MERC) return { willing: false, refusal: null };
  if (m.contract.signedAnotherContract) {
    if (sayQuote) ctx.say(m, 'WONT_RENEW_CONTRACT_LAME_REFUSAL');
    return { willing: false, refusal: { quote: 'WONT_RENEW_CONTRACT_LAME_REFUSAL' } };
  }
  const refusal = findRefusalReason(ctx, m);
  const p = ctx.profile(m.profile);
  if (!refusal || !p) return { willing: true, refusal: null };
  const buddySlot = getFirstBuddyOnTeam({ team: ctx.team(), profiles: ctx.state.profiles }, p);
  const buddyQuote = BUDDY_RENEWALS[buddySlot] ?? null;
  if (sayQuote) {
    const quote = buddyQuote ?? refusal.quote;
    const mask = precedentBitMask(Quote[quote]);
    if ((p.precedentQuoteSaid & mask) !== 0) ctx.say(m, 'PRECEDENT_TO_REPEATING_ONESELF_RENEW');
    else p.precedentQuoteSaid = u32(p.precedentQuoteSaid | mask);
    const subject = buddyQuote ? p.buddies[buddySlot] : refusal.subject;
    ctx.say(m, quote, subject);
  }
  return buddyQuote ? { willing: true, refusal: null } : { willing: false, refusal };
}

export function willMercRenew(ctx: ContractContext, m: RosterMerc, sayQuote: boolean): boolean {
  return mercRenewalWillingness(ctx, m, sayQuote).willing;
}

export function contractClock(ctx: ContractContext) {
  return clockReading(worldTotalMinutes(ctx.state.clock));
}

export function mercContractIsExpiring(ctx: ContractContext, m: RosterMerc): boolean {
  return contractIsExpiring(m.contract, contractClock(ctx));
}

function awaitsRenewal(m: RosterMerc): boolean {
  return m.life !== 0 && m.assignment !== Assignment.IN_TRANSIT && m.assignment !== Assignment.ASSIGNMENT_POW;
}

export function findOutIfAnyMercAboutToLeaveIsGonnaRenew(ctx: ContractContext): void {
  const seq = ctx.contracts.renewal;
  const now = contractClock(ctx);
  const willing: RosterMerc[] = [];
  const listed: number[] = [];
  let quitter: RosterMerc | null = null;
  for (const m of ctx.team()) {
    if (!awaitsRenewal(m) || m.kind !== MercKind.AIM_MERC || !contractIsGoingToExpireSoon(m.contract, now)) continue;
    m.contract.renewalQuoteCode = RenewalQuoteCode.NOT_USED;
    if (seq.list.length < MAX_CONTRACT_RENEWALS) seq.list.push(m.profile);
    if (willMercRenew(ctx, m, false)) willing.push(m);
    else quitter = m;
    listed.push(m.id);
  }
  const chosen = willing.length > 0 ? willing[ctx.rng.main.int(willing.length)] : undefined;
  if (chosen) {
    ctx.say(chosen, 'CONTRACTS_OVER');
    chosen.contract.renewalQuoteCode = RenewalQuoteCode.CONTRACTS_OVER_USED;
  } else if (quitter) {
    ctx.say(quitter, 'MERC_LEAVING_ALSUCO_SOON');
    quitter.contract.renewalQuoteCode = RenewalQuoteCode.LEAVING_SOON_USED;
  } else return;
  ctx.emit({ type: 'contractsExpiringSoon', soldiers: listed });
}

export function renewalCandidateExpiring(ctx: ContractContext): boolean {
  const now = contractClock(ctx);
  return ctx.contracts.renewal.list.some((profile) => {
    const m = ctx.roster.byProfile(profile);
    return m !== undefined && awaitsRenewal(m) && contractIsExpiring(m.contract, now);
  });
}

export function endCurrentContractRenewal(seq: RenewalSequence): void {
  if (!seq.on) return;
  seq.inProgress = false;
  seq.fromSequence = false;
  seq.current++;
}

export function checkIfSalaryIncreasedAndSayQuote(ctx: ContractContext, m: RosterMerc): void {
  if (!m.contract.contractPriceIncreased) return;
  ctx.say(m, 'MERC_GONE_UP_IN_PRICE');
  m.contract.contractPriceIncreased = false;
}

export function startRenewalQuotes(ctx: ContractContext, m: RosterMerc): void {
  const willing = willMercRenew(ctx, m, false);
  const code = m.contract.renewalQuoteCode;
  if (!willing) ctx.say(m, 'MERC_LEAVING_ALSUCO_SOON');
  else if (code === RenewalQuoteCode.NOT_USED) ctx.say(m, 'CONTRACTS_OVER');
  else if (code === RenewalQuoteCode.CONTRACTS_OVER_USED) ctx.say(m, 'MERC_LEAVING_ALSUCO_SOON');
}

export function canExtendContractForSoldier(m: RosterMerc): boolean {
  return (
    !(m.statusFlags & SoldierStatusFlags.VEHICLE) &&
    m.kind !== MercKind.EPC &&
    m.assignment !== Assignment.IN_TRANSIT &&
    m.assignment !== Assignment.ASSIGNMENT_POW
  );
}

export type ExtensionChoice = 'day' | 'week' | 'twoWeeks';
export type ContractOptionReason = 'notAimMerc' | 'tooBadlyHurt' | 'notEnoughMoney' | 'inCombat' | 'bleeding';

export interface ContractOption {
  readonly choice: ExtensionChoice | 'dismiss' | 'letGo';
  readonly cost?: number;
  readonly enabled: boolean;
  readonly reason?: ContractOptionReason;
}

export const EXTENSION_CHOICES: readonly ExtensionChoice[] = ['day', 'week', 'twoWeeks'];

export function extensionPrice(ctx: ContractContext, m: RosterMerc, choice: ExtensionChoice): number {
  const p = ctx.profile(m.profile);
  if (!p) return 0;
  return choice === 'day' ? p.salary : choice === 'week' ? p.weeklySalary : p.biWeeklySalary;
}

function extensionOption(ctx: ContractContext, m: RosterMerc, choice: ExtensionChoice): ContractOption {
  const cost = extensionPrice(ctx, m, choice);
  if (m.kind !== MercKind.AIM_MERC) return { choice, cost, enabled: false, reason: 'notAimMerc' };
  if (m.life < OKLIFE) return { choice, cost, enabled: false, reason: 'tooBadlyHurt' };
  if (cost > ctx.state.finances.balance) return { choice, cost, enabled: false, reason: 'notEnoughMoney' };
  return { choice, cost, enabled: true };
}

export function dismissRefusal(m: RosterMerc, inCombat: boolean): ContractOptionReason | null {
  if (inCombat && m.inSector) return 'inCombat';
  if (m.bleeding > MIN_BLEEDING_THRESHOLD) return 'bleeding';
  return null;
}

export function contractOptions(ctx: ContractContext, m: RosterMerc, inCombat: boolean): ContractOption[] {
  const dismissReason = dismissRefusal(m, inCombat);
  return [
    ...EXTENSION_CHOICES.map((choice) => extensionOption(ctx, m, choice)),
    dismissReason ? { choice: 'dismiss', enabled: false, reason: dismissReason } : { choice: 'dismiss', enabled: true },
    { choice: 'letGo', enabled: true },
  ];
}
