// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Insurance_Contract.cc DailyUpdateOfInsuredMercs, CalculateInsuranceContractCost, DiffFromNormRatio,
// @src AddLifeInsurancePayout, StartInsuranceInvestigation, EndInsuranceInvestigation,
// @src InsuranceContractPayLifeInsuranceForDeadMerc, MercIsInsurable, GetTimeRemainingOnSoldiersInsuranceContract,
// @src GetTimeRemainingOnSoldiersContract, PurchaseOrExtendInsuranceForSoldier, CanSoldierExtendInsuranceContract,
// @src CalculateSoldiersInsuranceContractLength, CalcStartDayOfInsurance, HandleAcceptButton; INSURANCE_PREMIUM_RATE,
// @src INS_CTRCT_*_BASE.

import { i32, idiv, u8, u32 } from '../../../core/int.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { EventKind, NUM_MIN_IN_DAY, NUM_MIN_IN_HOUR } from '../../strategic/time/constants.ts';
import { addStrategicEvent } from '../../strategic/time/event-queue.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import { midnightOfFutureDay } from '../contracts/contract-times.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { calcDeathRate } from '../relations/reputation.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { LaptopContext } from './context.ts';
import type { LifeInsurancePayout } from './laptop-state.ts';
import { mailSpec, sender } from './mail.ts';
import { isMercDead } from './profile-state.ts';
import { History } from './records.ts';

const INSURANCE_PREMIUM_RATE = 5;
const SKILL_BASE = 42;
const FITNESS_BASE = 85;
const EXP_LEVEL_BASE = 3;
const SURVIVAL_BASE = 90;
const MIN_RATIO = Math.fround(0.1);
const MAX_RATIO = Math.fround(10);
const PERCENT = 100;
const SKILL_COUNT = 5;
const PAYOUT_HOUR = 16 * NUM_MIN_IN_HOUR;
const INVESTIGATION_THRESHOLD = 2;
const INVESTIGATION_BASE_DAYS = 2;
const INVESTIGATION_SPREAD = 3;
const VERY_SUSPICIOUS_DEATH = 2;
const WEEK_DAYS = 7;
const TWO_WEEK_DAYS = 14;

function clampRatio(r: number): number {
  return r < MIN_RATIO ? MIN_RATIO : r > MAX_RATIO ? MAX_RATIO : r;
}

function diffFromNormRatio(value: number, normal: number): number {
  return value > 0 ? clampRatio(Math.fround(normal / value)) : MAX_RATIO;
}

export function contractDaysLeft(ctx: LaptopContext, m: RosterMerc): number {
  const end = m.contract.contractEnd;
  let day = idiv(end, NUM_MIN_IN_DAY) - 1;
  if (end % NUM_MIN_IN_DAY) day++;
  day -= ctx.day();
  return u32(Math.min(day, m.contract.totalContractLength));
}

export function insuranceDaysLeft(ctx: LaptopContext, m: RosterMerc): number {
  const c = m.contract;
  if (!c.lifeInsurance) return 0;
  const today = ctx.day();
  if (today < c.startOfInsuranceContract) return u32(c.totalLengthOfInsuranceContract);
  return u32(c.totalLengthOfInsuranceContract - (today - c.startOfInsuranceContract));
}

export function insuranceLength(ctx: LaptopContext, m: RosterMerc): number {
  const p = ctx.profile(m.profile);
  if (!p || isMercDead(p)) return 0;
  const c = m.contract;
  const left = contractDaysLeft(ctx, m);
  if (left < 2 && !(c.lifeInsurance !== 0 && left >= 1)) return 0;
  const insured = insuranceDaysLeft(ctx, m);
  let length = i32(c.lifeInsurance || ctx.state.didGameJustStart ? left - insured : left - insured - 1);
  if (u32(insured + length) > left) length = i32(left - insured);
  if (length < 0) length = 0;
  if (c.lifeInsurance && c.startOfInsuranceContract >= ctx.day() && length < 2) length = 0;
  return length;
}

export function insurancePremium(ctx: LaptopContext, length: number, m: RosterMerc, p: ProfileProgress): number {
  const left = contractDaysLeft(ctx, m);
  if (left < 2 && !(m.contract.lifeInsurance !== 0 && left >= 1)) return 0;
  if (m.assignment === Assignment.ASSIGNMENT_POW) return 0;
  const s = p.stats;
  const skill = idiv(s.marksmanship + s.medical + s.mechanical + s.explosives + s.leadership, SKILL_COUNT);
  const survival = 100 - calcDeathRate(ctx.state.status);
  let risk = Math.fround(diffFromNormRatio(skill, SKILL_BASE) * diffFromNormRatio(p.life, FITNESS_BASE));
  risk = Math.fround(risk * diffFromNormRatio(s.experience, EXP_LEVEL_BASE));
  risk = clampRatio(Math.fround(risk * diffFromNormRatio(survival, SURVIVAL_BASE)));
  const daily = u32(Math.trunc(Math.fround(Math.fround(p.salary * INSURANCE_PREMIUM_RATE * risk) / PERCENT) + 0.5));
  return i32(daily * length);
}

export function isInsurable(ctx: LaptopContext, m: RosterMerc): boolean {
  if (m.kind !== MercKind.AIM_MERC || m.assignment === Assignment.ASSIGNMENT_POW) return false;
  return insuranceLength(ctx, m) !== 0 || m.contract.lifeInsurance !== 0;
}

function startDayOfInsurance(ctx: LaptopContext, m: RosterMerc): number {
  if (m.assignment === Assignment.IN_TRANSIT && !ctx.state.didGameJustStart) return ctx.day();
  return idiv(midnightOfFutureDay(ctx.now(), 1), NUM_MIN_IN_DAY);
}

export type InsurancePurchase = { readonly bought: boolean; readonly cost: number; readonly extended: boolean };

export function purchaseOrExtendInsurance(ctx: LaptopContext, m: RosterMerc, length: number): InsurancePurchase {
  const c = m.contract;
  const p = ctx.profile(m.profile);
  if (!p) return { bought: false, cost: 0, extended: false };
  const now = ctx.now();
  if (!c.lifeInsurance) {
    c.startOfInsuranceContract = startDayOfInsurance(ctx, m);
    c.startTimeOfInsuranceContract = u32(now);
  }
  const cost = insurancePremium(ctx, length, m, p);
  const f = ctx.state.finances;
  let bought = false;
  const extended = c.lifeInsurance !== 0;
  if (extended) {
    c.startOfInsuranceContract = startDayOfInsurance(ctx, m);
    if (cost > 0) ctx.emitMoney(addTransaction(f, FinanceCode.EXTENDED_INSURANCE, m.profile, now, -cost));
    bought = cost > 0;
  } else if (f.balance >= cost) {
    ctx.emitMoney(addTransaction(f, FinanceCode.PURCHASED_INSURANCE, m.profile, now, -cost));
    ctx.history(History.PURCHASED_INSURANCE, m.profile, null);
    c.lifeInsurance = 1;
    bought = true;
  }
  c.totalLengthOfInsuranceContract = i32(c.totalLengthOfInsuranceContract + length);
  const insured = insuranceDaysLeft(ctx, m);
  const left = contractDaysLeft(ctx, m);
  if (insured > left) c.totalLengthOfInsuranceContract = i32(c.totalLengthOfInsuranceContract - (insured - left));
  return { bought, cost, extended };
}

export function dailyUpdateOfInsuredMercs(ctx: LaptopContext): void {
  for (const m of ctx.team()) {
    const c = m.contract;
    if (!c.lifeInsurance || ctx.day() === c.startOfInsuranceContract || insuranceDaysLeft(ctx, m) > 0) continue;
    const p = ctx.profile(m.profile);
    if (p && isMercDead(p)) continue;
    c.lifeInsurance = 0;
    c.totalLengthOfInsuranceContract = 0;
    c.startOfInsuranceContract = 0;
  }
}

function costPerDay(p: ProfileProgress): number {
  let cost = p.salary;
  if (idiv(p.weeklySalary, WEEK_DAYS) < cost) cost = idiv(p.weeklySalary, WEEK_DAYS);
  if (idiv(p.biWeeklySalary, TWO_WEEK_DAYS) < cost) cost = idiv(p.biWeeklySalary, TWO_WEEK_DAYS);
  return cost;
}

export function addLifeInsurancePayout(ctx: LaptopContext, m: RosterMerc): void {
  const p = ctx.profile(m.profile);
  if (!p) return;
  const insurance = ctx.laptop.insurance;
  if (insurance.payouts.length <= insurance.used) insurance.payouts.push({ active: false, soldier: 0, profile: 0, payout: 0 });
  let slot = 0;
  while (slot < insurance.used && insurance.payouts[slot]?.active) slot++;
  const payout = insurance.payouts[slot] as LifeInsurancePayout;
  payout.soldier = m.id;
  payout.profile = m.profile;
  payout.active = true;
  const days = u32(m.contract.totalLengthOfInsuranceContract - (ctx.day() + 1 - m.contract.startOfInsuranceContract));
  payout.payout = i32(days * costPerDay(p));
  const minute = midnightOfFutureDay(ctx.now(), 1) + PAYOUT_HOUR;
  const investigate = p.suspiciousDeath !== 0 || ctx.state.status.insuranceInvestigations >= INVESTIGATION_THRESHOLD;
  addStrategicEvent(
    ctx.state.queue,
    investigate ? EventKind.INSURANCE_INVESTIGATION_STARTED : EventKind.PAY_LIFE_INSURANCE_FOR_DEAD_MERC,
    minute,
    slot,
  );
  insurance.used = u8(insurance.used + 1);
}

function insuranceMail(ctx: LaptopContext, name: string, payout: LifeInsurancePayout): void {
  ctx.mail(mailSpec(ctx.content, name), sender(ctx.content, 'INSURANCE_COMPANY'), {
    firstData: payout.payout,
    secondData: payout.profile,
  });
}

export function startInsuranceInvestigation(ctx: LaptopContext, slot: number): void {
  const payout = ctx.laptop.insurance.payouts[slot];
  if (!payout) return;
  const status = ctx.state.status;
  insuranceMail(ctx, status.insuranceInvestigations === 0 ? 'INSUR_SUSPIC' : 'INSUR_SUSPIC_2', payout);
  const verySuspicious = ctx.profile(payout.profile)?.suspiciousDeath === VERY_SUSPICIOUS_DEATH;
  const days = verySuspicious ? 1 : INVESTIGATION_BASE_DAYS + status.insuranceInvestigations + ctx.rng.main.int(INVESTIGATION_SPREAD);
  addStrategicEvent(ctx.state.queue, EventKind.INSURANCE_INVESTIGATION_OVER, midnightOfFutureDay(ctx.now(), days) + PAYOUT_HOUR, slot);
  status.insuranceInvestigations++;
}

export function endInsuranceInvestigation(ctx: LaptopContext, slot: number): void {
  const payout = ctx.laptop.insurance.payouts[slot];
  if (!payout) return;
  if (ctx.profile(payout.profile)?.suspiciousDeath === VERY_SUSPICIOUS_DEATH) {
    insuranceMail(ctx, 'INSUR_1HOUR_FRAUD', payout);
    return;
  }
  insuranceMail(ctx, 'INSUR_INVEST_OVER', payout);
  payLifeInsuranceForDeadMerc(ctx, slot);
}

export function payLifeInsuranceForDeadMerc(ctx: LaptopContext, slot: number): void {
  const insurance = ctx.laptop.insurance;
  const payout = insurance.payouts[slot];
  if (!payout) return;
  const m = ctx.roster.get(payout.soldier);
  if (m) m.contract.lifeInsurance = 0;
  ctx.emitMoney(addTransaction(ctx.state.finances, FinanceCode.INSURANCE_PAYOUT, payout.profile, ctx.now(), payout.payout));
  ctx.history(History.INSURANCE_CLAIM_PAYOUT, payout.profile, null);
  if (ctx.profile(payout.profile)?.suspiciousDeath === 0) insuranceMail(ctx, 'INSUR_PAYMENT', payout);
  ctx.emit({ type: 'insurancePaid', profile: payout.profile, amount: payout.payout });
  insurance.used = u8(insurance.used - 1);
  payout.active = false;
}
