// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMMembers.cc WillMercAcceptCall, CanMercBeHired (via relations/hiring-check.ts),
// @src DisplayMercChargeAmount, DisplayMercsFace, BtnAnsweringMachineButtonCallback, AimMemberHireMerc, AIM_VIDEO_INIT_MODE
// @src (default contract and kit); Tactical/Soldier_Profile.cc StartSomeMercsOnAssignment, DecideActiveTerrorists. See
// @src docs/21 §2.1–§2.5, §8.1.

import { MercType } from '../../../content/strategic/economy-content.ts';
import { sectorFromId } from '../../../content/strategic/sector-ids.ts';
import { i8 } from '../../../core/int.ts';
import { createItem } from '../../items/object.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { InsertionCode } from '../../strategic/forces/constants.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { setProfileSector } from '../../strategic/narrative/presence.ts';
import { InvSlot } from '../../tactical/inventory.ts';
import { MercStatus, type ProfileProgress } from '../../tactical/profiles.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { ProfileMiscFlag, ProfileMiscFlag3 } from '../profiles.ts';
import { canMercBeHired, type HireRefusal } from '../relations/hiring-check.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { LaptopContext } from './context.ts';
import { type HireHooks, hireMercCore } from './hire.ts';
import { isMercDead, isMercHireable } from './profile-state.ts';
import { History } from './records.ts';

export const AIM_CONTRACT_LENGTHS = [1, 7, 14] as const;
export type AimContractLength = (typeof AIM_CONTRACT_LENGTHS)[number];
export const DEFAULT_AIM_CONTRACT: AimContractLength = 7;
const LEATHER_JACKET = 'LEATHER_JACKET';
const FULL_STATUS = 100;
const DAILY_DIE = 100;
const ASSIGNMENT_CHANCE_PER_LEVEL = 5;
const AWAY_DAYS_BASE = 6;
const EASY = 1;
const HARD = 3;
const TERRORIST_CHANCE = { easy: 70, medium: 50, hard: 30 } as const;
const MIN_ADDITIONAL_TERRORISTS = 2;
const MAX_ADDITIONAL_TERRORISTS = 4;
const TERRORIST_PLACEMENT_CHANCE = 40;

export type AimContact = 'unavailable' | 'answeringMachine' | 'firstContact';
export type AimFace = 'available' | 'hired' | 'dead' | 'pow' | 'onAssignment';

export interface AimCharge {
  readonly salary: number;
  readonly medicalDeposit: number;
  readonly gear: number;
  readonly total: number;
}

export type AimHireRefusal =
  | 'notAimMerc'
  | 'badContract'
  | 'noKit'
  | 'unavailable'
  | 'away'
  | HireRefusal
  | 'funds'
  | 'cannotHire'
  | 'teamFull';

export interface AimHireRequest {
  readonly profile: number;
  readonly contract: number;
  readonly gear?: boolean | undefined;
}

export type AimHireResult =
  | { readonly ok: true; readonly merc: RosterMerc; readonly charge: AimCharge; readonly arrival: number; readonly quote: string | null }
  | { readonly ok: false; readonly reason: AimHireRefusal; readonly hated?: number; readonly charge?: AimCharge };

export function isAimMerc(ctx: LaptopContext, profile: number): boolean {
  return ctx.mercType(profile) === MercType.AIM && ctx.profile(profile) !== null;
}

export function aimContact(p: ProfileProgress): AimContact {
  if (p.mercStatus === MercStatus.ANNOYED_WONT_CONTACT) return 'unavailable';
  return isMercHireable(p) ? 'firstContact' : 'answeringMachine';
}

export function aimFace(ctx: LaptopContext, profile: number, p: ProfileProgress): AimFace {
  const m = ctx.roster.byProfile(profile);
  if (isMercDead(p)) return 'dead';
  if (p.mercStatus === MercStatus.FIRED_AS_A_POW || m?.assignment === Assignment.ASSIGNMENT_POW) return 'pow';
  if (m) return 'hired';
  return isMercHireable(p) ? 'available' : 'onAssignment';
}

export function contractSalary(p: ProfileProgress, contract: number): number {
  if (contract === 1) return p.salary;
  if (contract === 7) return p.weeklySalary;
  if (contract === 14) return p.biWeeklySalary;
  return 0;
}

export function defaultGear(p: ProfileProgress): boolean {
  return p.optionalGearCost !== 0;
}

export function aimCharge(p: ProfileProgress, contract: number, gear: boolean): AimCharge {
  const salary = contractSalary(p, contract);
  const medicalDeposit = p.medicalDeposit ? p.medicalDepositAmount : 0;
  const gearCost = gear ? p.optionalGearCost : 0;
  return { salary, medicalDeposit, gear: gearCost, total: salary + medicalDeposit + gearCost };
}

function validContract(contract: number): contract is AimContractLength {
  return (AIM_CONTRACT_LENGTHS as readonly number[]).includes(contract);
}

export function aimHireRefusal(ctx: LaptopContext, request: AimHireRequest): AimHireResult | null {
  const p = ctx.profile(request.profile);
  if (!p || !isAimMerc(ctx, request.profile)) return { ok: false, reason: 'notAimMerc' };
  if (!validContract(request.contract)) return { ok: false, reason: 'badContract' };
  const gear = request.gear ?? defaultGear(p);
  if (gear && p.optionalGearCost === 0) return { ok: false, reason: 'noKit' };
  const contact = aimContact(p);
  if (contact === 'unavailable') return { ok: false, reason: 'unavailable' };
  if (contact === 'answeringMachine') return { ok: false, reason: 'away' };
  const check = canMercBeHired({ team: ctx.team(), profiles: ctx.state.profiles }, ctx.state.status, p);
  if (!check.accepted)
    return { ok: false, reason: check.refusal ?? 'cannotHire', ...(check.hated !== undefined ? { hated: check.hated } : {}) };
  const charge = aimCharge(p, request.contract, gear);
  if (ctx.state.finances.balance < charge.total) return { ok: false, reason: 'funds', charge };
  return null;
}

function giveLeatherJacket(ctx: LaptopContext, m: RosterMerc): void {
  const def = ctx.tactical.items.byName.get(LEATHER_JACKET);
  if (def) m.soldier.inv[InvSlot.VEST] = createItem(ctx.tactical.items, def.index, FULL_STATUS);
}

export function aimHire(ctx: LaptopContext, request: AimHireRequest, hooks: HireHooks): AimHireResult {
  const refusal = aimHireRefusal(ctx, request);
  if (refusal) return refusal;
  const p = ctx.profile(request.profile) as ProfileProgress;
  const gear = request.gear ?? defaultGear(p);
  const charge = aimCharge(p, request.contract, gear);
  const check = canMercBeHired({ team: ctx.team(), profiles: ctx.state.profiles }, ctx.state.status, p);
  const outcome = hireMercCore(
    ctx,
    {
      profile: request.profile,
      kind: MercKind.AIM_MERC,
      length: request.contract,
      copyItems: gear,
      insertion: InsertionCode.ARRIVING_GAME,
      useLandingZone: true,
    },
    hooks,
  );
  if (outcome === 'failed') return { ok: false, reason: 'cannotHire' };
  if (outcome === 'teamFull') return { ok: false, reason: 'teamFull' };
  const { merc, arrival } = outcome;
  if (!gear && request.profile === ctx.content.namedProfiles.NAILS) giveLeatherJacket(ctx, merc);
  if (gear) p.miscFlags |= ProfileMiscFlag.ALREADY_USED_ITEMS;
  const now = ctx.now();
  const f = ctx.state.finances;
  ctx.emitMoney(addTransaction(f, FinanceCode.HIRED_MERC, request.profile, now, -charge.total + p.medicalDepositAmount));
  if (p.medicalDeposit) ctx.emitMoney(addTransaction(f, FinanceCode.MEDICAL_DEPOSIT, request.profile, now, -p.medicalDepositAmount));
  ctx.history(History.HIRED_MERC_FROM_AIM, request.profile, null);
  return { ok: true, merc, charge, arrival, quote: check.quote };
}

export function aimLeaveMessageRefusal(p: ProfileProgress): 'notAway' | 'alreadyLeft' | null {
  if (aimContact(p) !== 'answeringMachine') return 'notAway';
  return p.miscFlags3 & ProfileMiscFlag3.PLAYER_LEFT_MSG_FOR_MERC_AT_AIM ? 'alreadyLeft' : null;
}

function aimOrMercProfiles(ctx: LaptopContext): number[] {
  const ids: number[] = [];
  for (const [id, type] of [...ctx.state.profiles.keys()].map((id) => [id, ctx.mercType(id)] as const))
    if (type === MercType.AIM || type === MercType.MERC) ids.push(id);
  return ids.sort((a, b) => a - b);
}

export function startSomeMercsOnAssignment(ctx: LaptopContext): void {
  const main = ctx.rng.main;
  for (const id of aimOrMercProfiles(ctx)) {
    const p = ctx.profile(id);
    if (!p) continue;
    const level = p.stats.experience;
    if (main.int(DAILY_DIE) < ASSIGNMENT_CHANCE_PER_LEVEL * level) {
      p.mercStatus = MercStatus.WORKING_ELSEWHERE;
      p.dayBecomesAvailable = 1 + main.int(AWAY_DAYS_BASE + Math.trunc(level / 2));
    } else {
      p.mercStatus = MercStatus.OK;
      p.dayBecomesAvailable = 0;
    }
    p.precedentQuoteSaid = 0;
    p.daysOfMoraleHangover = 0;
  }
}

function terroristChance(difficulty: number): number {
  if (difficulty === EASY) return TERRORIST_CHANCE.easy;
  if (difficulty === HARD) return TERRORIST_CHANCE.hard;
  return TERRORIST_CHANCE.medium;
}

export function decideActiveTerrorists(ctx: LaptopContext): void {
  const main = ctx.rng.main;
  const chance = terroristChance(ctx.state.options.difficulty);
  let additional = MIN_ADDITIONAL_TERRORISTS;
  for (let n = MAX_ADDITIONAL_TERRORISTS - MIN_ADDITIONAL_TERRORISTS; n !== 0; n--) if (main.int(DAILY_DIE) < chance) additional++;
  const placements: number[] = [];
  const placedWithoutProfile = new Set<number>();
  const placed = (profile: number, sectors: readonly (number | null)[]): boolean => {
    const p = ctx.profile(profile);
    if (p) return p.sectorX !== 0;
    return placedWithoutProfile.has(profile) || sectors.includes(null);
  };
  while (placements.length !== additional) {
    for (const t of ctx.content.terrorists) {
      if (placements.length === additional) break;
      if (placed(t.profile, t.sectors)) continue;
      if (main.int(DAILY_DIE) >= TERRORIST_PLACEMENT_CHANCE) continue;
      let sector: number;
      do sector = t.sectors[main.int(t.sectors.length)] ?? 0;
      while (placements.includes(sector));
      const p = ctx.profile(t.profile);
      if (p) setProfileSector(p, sectorFromId(sector));
      else placedWithoutProfile.add(t.profile);
      placements.push(sector);
    }
  }
  const carmen = ctx.profile(Npc.CARMEN);
  if (carmen) carmen.npcData = i8(1 + additional);
  ctx.state.terrorists.count = 1 + additional;
}
