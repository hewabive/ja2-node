// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Merc_Handler.cc MercDailyUpdate, SoldierHasWorseEquipmentThanUsedTo,
// @src MercComplainAboutEquipment; Strategic/Merc_Contract.cc CheckIfMercGetsAnotherContract; Tactical/Morale.cc
// @src DailyMoraleUpdate; Tactical/Campaign.cc HandleUnhiredMercImprovement, HandleUnhiredMercDeaths.

import { ItemClass } from '../../../content/items/items.ts';
import { MercType } from '../../../content/strategic/economy-content.ts';
import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { i8, i16, i32, idiv, u8, u16, u32, udiv } from '../../../core/int.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { EventKind, NUM_MIN_IN_DAY } from '../../strategic/time/constants.ts';
import { addSameDayStrategicEvent } from '../../strategic/time/event-queue.ts';
import { worldDay, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import type { CombatContext, RandomStream } from '../../tactical/combat/context.ts';
import { profileStatChange, profileUpdateStats, StatCause } from '../../tactical/combat/experience.ts';
import { QuoteSaidFlag } from '../../tactical/narrative/merc-quotes.ts';
import { isProfileDead, MercStatus, type ProfileProgress, StatKind } from '../../tactical/profiles.ts';
import { NO_PROFILE, OKLIFE, Personality, SkillTrait } from '../../tactical/soldier.ts';
import { handleMoraleEvent, MoraleEvent } from '../morale.ts';
import { isAimOrMercType, MAX_NUMBER_MERCS, NUM_PROFILES, ProfileMiscFlag3 } from '../profiles.ts';
import { isMercOnTeam } from '../relations/relations.ts';
import { calcDeathRate, mercThinksDeathRateTooHigh, mercThinksHisMoraleIsTooLow } from '../relations/reputation.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { ContractContext } from './context.ts';
import { MERC_ARRIVE_TIME_SLOTS } from './contract-times.ts';
import { mercsLeaveOverInvalidAccount } from './merc-account.ts';
import { SpecialProfile } from './quotes.ts';
import { rpcDailyPay } from './rpc-pay.ts';

const NOWHERE_SECTOR: Sector = { x: -1, y: -1, z: -1 };
const LOW_DEATH_RATE = 5;
const WARNING_MINUTES_BEFORE_SLOT = 2 * 60;
const EQUIPMENT_COMPLAINT_FROM = 360;
const EQUIPMENT_COMPLAINT_SPREAD = 1080;
const GREAT_MORALE = 75;
const NO_EQUIPMENT_RATING = -1;
const MORALE_RATING_BASE = 50;
const PERCENT = 100;
const ANOTHER_CONTRACT_WINDOW_DAYS = 3;
const IDLE_IMPROVEMENT_CHANCE = 20;
const WORKING_CHANCES_DIVISOR = 10;
const TRAINING_CHANCES_DIVISOR = 2;
const LAZY_LEVEL_DIE = 10;
const CHANGEABLE_STATS = StatKind.LEADERSHIP - StatKind.HEALTH + 1;
const UNHIRED_DEATH_BASE = 10;
const TROUBLED_PERSONALITY_BONUS = 2;
const UNHIRED_DEATH_DIE = 1000;
const AWAY_DAYS_BASE = 6;
const DAILY_DIE = 100;
const AIM_AWAY_CHANCE_PER_LEVEL = 2;
const MERC_AWAY_CHANCE_PER_LEVEL = 1;
const DAYS_TILL_MERC_SITE_HIRES = 3;
const PERSONALITY_QUOTE_RESETS: ReadonlySet<number> = new Set([
  Personality.HEAT_INTOLERANT,
  Personality.CLAUSTROPHOBIC,
  Personality.NONSWIMMER,
  Personality.FEAR_OF_INSECTS,
]);
const TROUBLED_PERSONALITIES: ReadonlySet<number> = new Set([Personality.FORGETFUL, Personality.NERVOUS, Personality.PSYCHO]);
const DAILY_QUOTE_RESETS = QuoteSaidFlag.ANNOYING_MERC | QuoteSaidFlag.LIKESGUN | QuoteSaidFlag.FOUND_SOMETHING_NICE;

export function soldierHasWorseEquipmentThanUsedTo(ctx: ContractContext, m: RosterMerc, p: ProfileProgress): boolean {
  let gun = NO_EQUIPMENT_RATING;
  let armour = NO_EQUIPMENT_RATING;
  for (const o of m.soldier.inv) {
    if (!o || o.item === 0) continue;
    const def = ctx.content.items.byIndex.get(o.item);
    if (!def) continue;
    if (def.itemClass === ItemClass.GUN && def.weapon && def.weapon.deadliness > gun) gun = i8(def.weapon.deadliness);
    if (def.itemClass === ItemClass.ARMOUR && def.armour && def.armour.protection > armour) armour = i8(def.armour.protection);
  }
  const scale = MORALE_RATING_BASE + m.soldier.morale;
  if (gun !== NO_EQUIPMENT_RATING) gun = i8(idiv(gun * scale, PERCENT));
  if (armour !== NO_EQUIPMENT_RATING) armour = i8(idiv(armour * scale, PERCENT));
  return (
    (gun !== NO_EQUIPMENT_RATING && gun < idiv(p.mainGunAttractiveness, 2)) ||
    (armour !== NO_EQUIPMENT_RATING && armour < idiv(p.armourAttractiveness, 2))
  );
}

export function mercComplainAboutEquipment(ctx: ContractContext, profile: number): void {
  let id = profile;
  if (id === SpecialProfile.LARRY_NORMAL && ctx.hooks.larryRelapsed()) id = SpecialProfile.LARRY_DRUNK;
  else if (id === SpecialProfile.LARRY_DRUNK && !ctx.hooks.larryRelapsed()) id = SpecialProfile.LARRY_NORMAL;
  const m = ctx.roster.byProfile(id);
  const p = ctx.profile(id);
  if (!m || !p || m.asleep || m.life < OKLIFE || m.assignment >= Assignment.ON_DUTY) return;
  if (soldierHasWorseEquipmentThanUsedTo(ctx, m, p)) ctx.say(m, 'WHINE_EQUIPMENT');
}

export function checkIfMercGetsAnotherContract(ctx: ContractContext, m: RosterMerc): void {
  if (m.kind !== MercKind.AIM_MERC) return;
  const c = m.contract;
  const now = worldTotalMinutes(ctx.state.clock);
  if (now <= u32(c.timeCanSignElsewhere) || c.signedAnotherContract) return;
  const fullDays = udiv(u32(c.contractEnd - now), NUM_MIN_IN_DAY);
  if (fullDays >= ANOTHER_CONTRACT_WINDOW_DAYS) return;
  const chance = (ANOTHER_CONTRACT_WINDOW_DAYS - fullDays) * m.soldier.stats.experience;
  if (ctx.rng.main.int(DAILY_DIE) < chance) c.signedAnotherContract = true;
}

export function dailyMoraleUpdate(ctx: ContractContext, m: RosterMerc, p: ProfileProgress): void {
  if (m.profile === NO_PROFILE) return;
  if (mercThinksDeathRateTooHigh(ctx.state.status, p)) handleMoraleEvent(ctx.moraleContext(), m, MoraleEvent.HIGH_DEATHRATE, m.sector);
  if (mercThinksHisMoraleIsTooLow(p, m.soldier.morale)) handleMoraleEvent(ctx.moraleContext(), m, MoraleEvent.POOR_MORALE, m.sector);
  else if (m.soldier.morale >= GREAT_MORALE) handleMoraleEvent(ctx.moraleContext(), m, MoraleEvent.GREAT_MORALE, m.sector);
}

function teamMemberDailyUpdate(ctx: ContractContext, m: RosterMerc): void {
  const s = ctx.state;
  if (m.assignment === Assignment.ASSIGNMENT_POW) m.contract.contractEnd = i32(m.contract.contractEnd + NUM_MIN_IN_DAY);
  else if (m.assignment !== Assignment.IN_TRANSIT) {
    m.quoteSaidFlags &= ~DAILY_QUOTE_RESETS;
    m.corpseQuoteTolerance = Math.max(0, i8(m.corpseQuoteTolerance - 1));
    const p = ctx.profile(m.profile);
    if (p) servedOneMoreDay(ctx, m, p);
  }
  if (m.assignment !== Assignment.ASSIGNMENT_DEAD && m.assignment !== Assignment.IN_TRANSIT)
    s.status.manDaysPlayed = u32(s.status.manDaysPlayed + 1);
}

function servedOneMoreDay(ctx: ContractContext, m: RosterMerc, p: ProfileProgress): void {
  const s = ctx.state;
  if (PERSONALITY_QUOTE_RESETS.has(p.personalityTrait)) m.quoteSaidFlags &= ~QuoteSaidFlag.PERSONALITY;
  if (soldierHasWorseEquipmentThanUsedTo(ctx, m, p)) {
    const minute = EQUIPMENT_COMPLAINT_FROM + ctx.rng.main.int(EQUIPMENT_COMPLAINT_SPREAD);
    addSameDayStrategicEvent(s.queue, s.clock, EventKind.MERC_COMPLAIN_EQUIPMENT, minute, m.profile);
  }
  p.totalDaysServed = u16(p.totalDaysServed + 1);
  p.miscFlags3 |= ProfileMiscFlag3.PLAYER_HAD_CHANCE_TO_HIRE;
  if (ctx.mercType(m.profile) === MercType.RPC) {
    m.contract.totalContractLength = i32(m.contract.totalContractLength + 1);
    rpcDailyPay(ctx, m, p);
  }
  dailyMoraleUpdate(ctx, m, p);
  checkIfMercGetsAnotherContract(ctx, m);
}

function profileStatContext(ctx: ContractContext): CombatContext {
  return {
    content: ctx.content,
    pre: ctx.rng.pre,
    rng: ctx.rng.main,
    profiles: ctx.state.profiles,
    inCombat: false,
    turn: { attackBusyCount: 0 },
    events: { push: () => 0 },
    experienceHooks: ctx.experienceHooks,
  };
}

function trainingStat(main: RandomStream): number {
  let stat: number;
  do stat = StatKind.HEALTH + main.int(CHANGEABLE_STATS);
  while (stat === StatKind.EXPERIENCE);
  return stat;
}

export function handleUnhiredMercImprovement(ctx: ContractContext, p: ProfileProgress): void {
  const main = ctx.rng.main;
  const t = profileStatContext(ctx);
  if (p.mercStatus === MercStatus.WORKING_ELSEWHERE) {
    if (main.int(DAILY_DIE) < IDLE_IMPROVEMENT_CHANCE) return;
    const chances = u16(idiv(p.stats.wisdom, WORKING_CHANCES_DIVISOR));
    for (let stat: number = StatKind.HEALTH; stat <= StatKind.LEADERSHIP; stat++) profileStatChange(t, p, stat, chances, StatCause.SUCCESS);
  } else {
    if (i8(main.int(LAZY_LEVEL_DIE)) < p.stats.experience || i8(main.int(DAILY_DIE)) > p.stats.wisdom) return;
    const stat = trainingStat(main);
    profileStatChange(t, p, stat, u16(idiv(p.stats.wisdom, TRAINING_CHANCES_DIVISOR)), StatCause.TRAINING);
  }
  profileUpdateStats(t, p);
}

export function handleUnhiredMercDeaths(ctx: ContractContext, id: number, p: ProfileProgress): void {
  if (!(p.miscFlags3 & ProfileMiscFlag3.PLAYER_HAD_CHANCE_TO_HIRE)) return;
  const s = ctx.state;
  const limit = ctx.economy.content.policy.unhiredMercDeaths[s.options.difficulty - 1] ?? 0;
  if (s.status.unhiredMercDeaths >= limit) return;
  let chance = UNHIRED_DEATH_BASE - p.stats.experience;
  if (TROUBLED_PERSONALITIES.has(p.personalityTrait)) chance += TROUBLED_PERSONALITY_BONUS;
  if (p.skillTrait === SkillTrait.STEALTHY) chance--;
  if (p.skillTrait2 === SkillTrait.STEALTHY) chance--;
  if (i16(ctx.rng.pre.int(UNHIRED_DEATH_DIE)) >= chance) return;
  p.mercStatus = MercStatus.IS_DEAD;
  p.dayBecomesAvailable = 0;
  s.status.unhiredMercDeaths = u8(s.status.unhiredMercDeaths + 1);
  if (ctx.mercType(id) === MercType.AIM) ctx.emit({ type: 'mailDue', mail: 'mercDiedOnOtherAssignment', profile: id });
}

function awayChance(ctx: ContractContext, id: number, p: ProfileProgress): number {
  if (id < MAX_NUMBER_MERCS) {
    p.miscFlags3 |= ProfileMiscFlag3.PLAYER_HAD_CHANCE_TO_HIRE;
    return AIM_AWAY_CHANCE_PER_LEVEL * p.stats.experience;
  }
  if (worldDay(ctx.state.clock) > DAYS_TILL_MERC_SITE_HIRES) p.miscFlags3 |= ProfileMiscFlag3.PLAYER_HAD_CHANCE_TO_HIRE;
  return MERC_AWAY_CHANCE_PER_LEVEL * p.stats.experience;
}

function countDownAvailability(ctx: ContractContext, id: number, p: ProfileProgress): void {
  p.dayBecomesAvailable = u32(p.dayBecomesAvailable - 1);
  if (p.dayBecomesAvailable !== 0 || p.mercStatus === MercStatus.FIRED_AS_A_POW) return;
  p.mercStatus = MercStatus.OK;
  if (!(p.miscFlags3 & ProfileMiscFlag3.PLAYER_LEFT_MSG_FOR_MERC_AT_AIM)) return;
  p.miscFlags3 &= ~ProfileMiscFlag3.PLAYER_LEFT_MSG_FOR_MERC_AT_AIM;
  ctx.emit({ type: 'mailDue', mail: 'mercBackFromAssignment', profile: id });
}

export function profileDailyUpdate(ctx: ContractContext, id: number): void {
  const p = ctx.profile(id);
  if (!p || isProfileDead(p)) return;
  p.precedentQuoteSaid = 0;
  if (isMercOnTeam(ctx.team(), id)) return;
  const aimOrMerc = isAimOrMercType(ctx.mercType(id));
  if (aimOrMerc && p.mercStatus !== MercStatus.RETURNING_HOME) {
    handleUnhiredMercImprovement(ctx, p);
    if (p.mercStatus === MercStatus.WORKING_ELSEWHERE) handleUnhiredMercDeaths(ctx, id, p);
  }
  if (p.dayBecomesAvailable > 0) countDownAvailability(ctx, id, p);
  else if (aimOrMerc && ctx.rng.main.int(DAILY_DIE) < awayChance(ctx, id, p)) {
    p.mercStatus = MercStatus.WORKING_ELSEWHERE;
    p.dayBecomesAvailable = 1 + ctx.rng.main.int(AWAY_DAYS_BASE + idiv(p.stats.experience, 2));
  }
  if (p.daysOfMoraleHangover > 0) p.daysOfMoraleHangover--;
}

export function mercDailyUpdate(ctx: ContractContext): void {
  const s = ctx.state;
  if (worldDay(s.clock) === 1) return;
  if (calcDeathRate(s.status) < LOW_DEATH_RATE) handleMoraleEvent(ctx.moraleContext(), null, MoraleEvent.LOW_DEATHRATE, NOWHERE_SECTOR);
  for (const slot of MERC_ARRIVE_TIME_SLOTS)
    addSameDayStrategicEvent(s.queue, s.clock, EventKind.MERC_ABOUT_TO_LEAVE, slot - WARNING_MINUTES_BEFORE_SLOT, 0);
  for (const slot of MERC_ARRIVE_TIME_SLOTS) addSameDayStrategicEvent(s.queue, s.clock, EventKind.BEGIN_CONTRACT_RENEWAL_SEQUENCE, slot, 0);
  for (const m of ctx.team()) teamMemberDailyUpdate(ctx, m);
  mercsLeaveOverInvalidAccount(ctx);
  for (let id = 0; id < NUM_PROFILES; id++) profileDailyUpdate(ctx, id);
  ctx.hooks.slayDailyEvent();
}
