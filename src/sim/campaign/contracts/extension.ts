// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Merc_Contract.cc MercContractHandling.

import { i8, i32 } from '../../../core/int.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { NUM_MIN_IN_DAY } from '../../strategic/time/constants.ts';
import { worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { ContractContext } from './context.ts';
import { ContractLength } from './contract-state.ts';
import { hourWhenContractDone } from './contract-times.ts';
import type { ContractTime, RefusalReason } from './events.ts';
import { HistoryCode } from './quotes.ts';
import { type ExtensionChoice, extensionPrice, mercContractIsExpiring, mercRenewalWillingness, REFUSAL_REASONS } from './renewal.ts';

interface ExtensionTerms {
  readonly days: number;
  readonly type: number;
  readonly history: number;
  readonly finance: number;
}

const TERMS: Readonly<Record<ExtensionChoice, ExtensionTerms>> = {
  day: {
    days: 1,
    type: ContractLength.EXTEND_1_DAY,
    history: HistoryCode.EXTENDED_CONTRACT_1_DAY,
    finance: FinanceCode.EXTENDED_CONTRACT_BY_1_DAY,
  },
  week: {
    days: 7,
    type: ContractLength.EXTEND_1_WEEK,
    history: HistoryCode.EXTENDED_CONTRACT_1_WEEK,
    finance: FinanceCode.EXTENDED_CONTRACT_BY_1_WEEK,
  },
  twoWeeks: {
    days: 14,
    type: ContractLength.EXTEND_2_WEEK,
    history: HistoryCode.EXTENDED_CONTRACT_2_WEEK,
    finance: FinanceCode.EXTENDED_CONTRACT_BY_2_WEEKS,
  },
};

export type InsuranceFollowUp =
  | { readonly kind: 'none' }
  | { readonly kind: 'unaffordable'; readonly cost: number }
  | { readonly kind: 'offer'; readonly cost: number };

export type ExtensionResult =
  | {
      readonly extended: true;
      readonly days: number;
      readonly cost: number;
      readonly endsAt: ContractTime;
      readonly insurance: InsuranceFollowUp;
    }
  | { readonly extended: false; readonly reason: 'notAimMerc' | 'notEnoughMoney' | RefusalReason; readonly departs: boolean };

export function contractEndTime(m: RosterMerc): ContractTime {
  return { day: Math.trunc(m.contract.contractEnd / NUM_MIN_IN_DAY), hour: hourWhenContractDone(m.contract.timeWillArrive) };
}

function insuranceFollowUp(ctx: ContractContext, m: RosterMerc, days: number, charge: number): InsuranceFollowUp {
  if (!m.contract.lifeInsurance || m.assignment === Assignment.ASSIGNMENT_POW) return { kind: 'none' };
  const cost = ctx.hooks.insuranceExtensionCost(m, days);
  if (cost === null) return { kind: 'none' };
  return cost > ctx.state.finances.balance - charge ? { kind: 'unaffordable', cost } : { kind: 'offer', cost };
}

export function mercContractHandling(ctx: ContractContext, m: RosterMerc, choice: ExtensionChoice): ExtensionResult {
  if (m.kind !== MercKind.AIM_MERC) return { extended: false, reason: 'notAimMerc', departs: false };
  const terms = TERMS[choice];
  const charge = extensionPrice(ctx, m, choice);
  if (ctx.state.finances.balance < charge) return { extended: false, reason: 'notEnoughMoney', departs: false };
  const willingness = mercRenewalWillingness(ctx, m, true);
  if (!willingness.willing) {
    const departs = mercContractIsExpiring(ctx, m);
    if (departs) ctx.contracts.pendingEndings.push({ kind: 'departure', soldier: m.id, rehire: true });
    const reason = (willingness.refusal && REFUSAL_REASONS[willingness.refusal.quote]) ?? 'morale';
    ctx.emit({ type: 'contractRefused', soldier: m.id, reason });
    return { extended: false, reason, departs };
  }
  const c = m.contract;
  c.totalContractLength = i32(c.totalContractLength + terms.days);
  c.typeOfLastContract = i8(terms.type);
  c.contractEnd = i32(c.contractEnd + terms.days * NUM_MIN_IN_DAY);
  const insurance = insuranceFollowUp(ctx, m, terms.days, charge);
  ctx.say(m, 'ACCEPT_CONTRACT_RENEWAL');
  if (choice === 'twoWeeks') c.timeCanSignElsewhere = c.contractEnd;
  const now = worldTotalMinutes(ctx.state.clock);
  addTransaction(ctx.state.finances, terms.finance, m.profile, now, -charge);
  ctx.history(terms.history, m.profile, m.sector);
  const endsAt = contractEndTime(m);
  ctx.emit({ type: 'contractExtended', soldier: m.id, days: terms.days, cost: charge, endsAt });
  return { extended: true, days: terms.days, cost: charge, endsAt, insurance };
}
