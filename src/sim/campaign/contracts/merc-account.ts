// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Mercs.cc DailyUpdateOfMercSite (the account part), GetProfileIDFromMERCListing; Laptop/Mercs.h
// @src MERC_NUM_DAYS_TILL_*; Strategic/Strategic_Merc_Handler.cc MercsContractIsFinished, MercDailyUpdate (the invalid
// @src account loop).

import { MercType } from '../../../content/strategic/economy-content.ts';
import { i32 } from '../../../core/int.ts';
import { Assignment, CONSCIOUSNESS } from '../../strategic/economy/constants.ts';
import { interruptTime, pauseGame, worldDay } from '../../strategic/time/world-clock.ts';
import { isProfileDead } from '../../tactical/profiles.ts';
import { MercAccountStatus } from '../laptop/laptop-state.ts';
import { NUM_PROFILES } from '../profiles.ts';
import { isMercOnTeam } from '../relations/relations.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { ContractContext } from './context.ts';
import type { MailKind } from './events.ts';
import { HistoryCode, type QuoteName } from './quotes.ts';

const DAYS_TILL_FIRST_WARNING = 7;
const DAYS_TILL_ACCOUNT_SUSPENDED = 9;
const DAYS_TILL_ACCOUNT_INVALID = 12;

const STATUS_NAMES: Readonly<Record<number, string>> = {
  [MercAccountStatus.NO_ACCOUNT]: 'noAccount',
  [MercAccountStatus.SUSPENDED]: 'suspended',
  [MercAccountStatus.INVALID]: 'invalid',
  [MercAccountStatus.VALID_FIRST_WARNING]: 'firstWarning',
  [MercAccountStatus.VALID]: 'valid',
};

const STATUS_MAILS: Readonly<Record<number, MailKind>> = {
  [MercAccountStatus.INVALID]: 'mercAccountInvalid',
  [MercAccountStatus.SUSPENDED]: 'mercAccountSuspended',
  [MercAccountStatus.VALID_FIRST_WARNING]: 'mercAccountFirstWarning',
};

export function mercAccountStatusName(status: number): string {
  return STATUS_NAMES[status] ?? 'noAccount';
}

function longestUnpaidMercContract(ctx: ContractContext): number {
  let longest = 0;
  for (let id = 0; id < NUM_PROFILES; id++) {
    if (ctx.mercType(id) !== MercType.MERC || !isMercOnTeam(ctx.team(), id)) continue;
    const p = ctx.profile(id);
    if (!p) continue;
    if (!isProfileDead(p)) p.mercMercContractLength = i32(p.mercMercContractLength + 1);
    longest = Math.max(longest, p.mercMercContractLength);
  }
  return longest;
}

function accountStatusFor(days: number): number | null {
  if (days > DAYS_TILL_ACCOUNT_INVALID) return MercAccountStatus.INVALID;
  if (days > DAYS_TILL_ACCOUNT_SUSPENDED) return MercAccountStatus.SUSPENDED;
  if (days > DAYS_TILL_FIRST_WARNING) return MercAccountStatus.VALID_FIRST_WARNING;
  return null;
}

export function dailyUpdateOfMercSite(ctx: ContractContext): void {
  if (worldDay(ctx.state.clock) === 1) return;
  const status = accountStatusFor(longestUnpaidMercContract(ctx));
  const merc = ctx.state.laptop.merc;
  if (status !== null && merc.accountStatus !== status) {
    merc.accountStatus = status;
    ctx.emit({ type: 'mercAccountStatus', status: mercAccountStatusName(status) });
    const mail = STATUS_MAILS[status];
    if (mail) ctx.emit({ type: 'mailDue', mail });
  }
  ctx.hooks.mercSiteDailyUpdate();
}

function quitQuote(m: RosterMerc, accountStatus: number): QuoteName | null {
  if (m.kind === MercKind.MERC) return accountStatus === MercAccountStatus.INVALID ? 'NOT_GETTING_PAID' : null;
  if (m.kind === MercKind.NPC) return 'AIM_SEEN_MIKE';
  return null;
}

export function mercsContractIsFinished(ctx: ContractContext, m: RosterMerc): void {
  if (ctx.roster.get(m.id) !== m) return;
  ctx.contracts.pendingEndings.push({ kind: 'enterMapScreen', soldier: m.id });
  const quote = quitQuote(m, ctx.state.laptop.merc.accountStatus);
  if (!quote) return;
  interruptTime(ctx.state.clock);
  pauseGame(ctx.state.clock);
  ctx.say(m, quote);
  ctx.contracts.pendingEndings.push({ kind: 'withoutEquipment', soldier: m.id });
  m.contract.leaveHistoryCode = HistoryCode.MERC_QUIT;
}

export function mercsLeaveOverInvalidAccount(ctx: ContractContext): void {
  if (ctx.state.laptop.merc.accountStatus !== MercAccountStatus.INVALID) return;
  for (const m of ctx.team()) {
    if (m.assignment === Assignment.ASSIGNMENT_POW || m.assignment === Assignment.IN_TRANSIT) continue;
    if (m.kind !== MercKind.MERC || m.life < CONSCIOUSNESS) continue;
    mercsContractIsFinished(ctx, m);
  }
}
