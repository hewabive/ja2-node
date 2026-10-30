// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc CalcSoldierNeedForSleep, RestCharacter, FatigueCharacter, CharacterIsTakingItEasy,
// @src HandleRestFatigueAndSleepStatus, SetMercAsleep, PutMercInAsleepState, SetMercAwake, PutMercInAwakeState,
// @src HandleNaturalHealing, HandleHealingByNaturalCauses, UpDateSoldierLife, AnyMercInGroupCantContinueMoving.

import { clamp, i8, i16, idiv, u8 } from '../../../core/int.ts';
import { getGroup } from '../forces/groups.ts';
import {
  canCharacterBeAwakened,
  canCharacterSleep,
  enoughTimeOnAssignment,
  isCharacterInTransit,
  isMechanical,
  isOnSquad,
  playerSoldierTooTiredToTravel,
} from './conditions.ts';
import {
  Assignment,
  BREATHMAX_ABSOLUTE_MINIMUM,
  BREATHMAX_CANCEL_COLLAPSE,
  BREATHMAX_CANCEL_TIRED,
  BREATHMAX_FULLY_RESTED,
  BREATHMAX_PRETTY_TIRED,
  MAX_BREATH,
  SkillTrait,
} from './constants.ts';
import { countTraits } from './points.ts';
import type { CrewMember, EconomyContext } from './ports.ts';

const MIN_NEED_FOR_SLEEP = 4;
const MAX_NEED_FOR_SLEEP = 12;
const HEALTH_QUARTERS = 4;
const SLEEP_HEALTH_SHIFT_BASE = 4;
const REST_BASE = 50;
const HOURS_PER_DAY = 24;
const MIN_BREATH_LOSS = 2;
const ENCUMBRANCE_NORMAL = 100;
const MAX_BREATH_LOSS = 127;
const LOW_ACTIVITY_LEVEL = 1;
const MEDIUM_ACTIVITY_LEVEL = 4;
const HIGH_ACTIVITY_LEVEL = 12;
const HUNDREDTHS = 100;

export function calcSoldierNeedForSleep(s: CrewMember): number {
  let need = u8(s.needForSleep);
  const partHealth = u8(idiv(HEALTH_QUARTERS * s.life, s.lifeMax));
  need = u8(need + (SLEEP_HEALTH_SHIFT_BASE >>> partHealth));
  need = u8(need - countTraits(s.skillTraits, SkillTrait.NIGHTOPS));
  need = u8(need - countTraits(s.skillTraits, SkillTrait.MARTIALARTS));
  if (need < MIN_NEED_FOR_SLEEP) return MIN_NEED_FOR_SLEEP;
  if (need > MAX_NEED_FOR_SLEEP) return MAX_NEED_FOR_SLEEP;
  return need;
}

export function restCharacter(s: CrewMember): void {
  let regain = i8(idiv(REST_BASE, calcSoldierNeedForSleep(s)));
  if (s.breathMax < BREATHMAX_PRETTY_TIRED) regain = i8(idiv(regain * 3, 2));
  s.breathMax = clamp(i8(s.breathMax + regain), BREATHMAX_ABSOLUTE_MINIMUM, MAX_BREATH);
  s.breath = s.breathMax;
  if (s.breathMax >= BREATHMAX_CANCEL_TIRED) s.complainedThatTired = false;
}

export function fatigueCharacter(ctx: EconomyContext, s: CrewMember): void {
  if (isMechanical(s) || isCharacterInTransit(s) || s.assignment === Assignment.ASSIGNMENT_POW) return;
  const divisor = i8(HOURS_PER_DAY - calcSoldierNeedForSleep(s));
  let loss = i8(idiv(REST_BASE, divisor));
  if (loss < MIN_BREATH_LOSS) loss = MIN_BREATH_LOSS;
  if (s.betweenSectors && s.assignment !== Assignment.VEHICLE) {
    const encumbrance = ctx.crew.carriedWeightPercent(s.id);
    if (encumbrance > ENCUMBRANCE_NORMAL) loss = i8(Math.min(idiv(loss * encumbrance, 100), MAX_BREATH_LOSS));
  }
  if (s.breathMax < BREATHMAX_PRETTY_TIRED) loss = i8(idiv(loss * 3, 2));
  const breathMax = clamp(i8(s.breathMax - loss), BREATHMAX_ABSOLUTE_MINIMUM, MAX_BREATH);
  s.breathMax = breathMax;
  if (s.breath > breathMax) s.breath = breathMax;
}

export function characterIsTakingItEasy(ctx: EconomyContext, s: CrewMember): boolean {
  if (s.asleep) return true;
  if (!canCharacterSleep(ctx, s)) return false;
  if (isOnSquad(s) || s.assignment === Assignment.VEHICLE) return true;
  if (s.assignment === Assignment.PATIENT || s.assignment === Assignment.ASSIGNMENT_HOSPITAL) return true;
  if (s.nothingToDo) return true;
  return !enoughTimeOnAssignment(ctx, s);
}

export function putMercInAsleepState(s: CrewMember): void {
  if (s.asleep) return;
  s.asleep = true;
}

export function setMercAsleep(ctx: EconomyContext, s: CrewMember): boolean {
  if (!canCharacterSleep(ctx, s)) return false;
  putMercInAsleepState(s);
  return true;
}

export function putMercInAwakeState(s: CrewMember): void {
  if (!s.asleep) return;
  s.asleep = false;
  s.forcedToStayAwake = s.breathMax < BREATHMAX_PRETTY_TIRED;
}

export function setMercAwake(s: CrewMember, force: boolean): boolean {
  if (!force && !canCharacterBeAwakened(s)) return false;
  putMercInAwakeState(s);
  return true;
}

function skipsRest(s: CrewMember): boolean {
  return isMechanical(s) || s.assignment === Assignment.ASSIGNMENT_POW || s.assignment === Assignment.IN_TRANSIT;
}

function onSquadOrInVehicle(s: CrewMember): boolean {
  return isOnSquad(s) || s.assignment === Assignment.VEHICLE;
}

function restOrSleep(ctx: EconomyContext, s: CrewMember): void {
  if (characterIsTakingItEasy(ctx, s)) restCharacter(s);
  else fatigueCharacter(ctx, s);
  if (s.asleep) return;
  if (s.breathMax <= BREATHMAX_ABSOLUTE_MINIMUM) {
    if (s.betweenSectors || !setMercAsleep(ctx, s)) return;
    s.collapsed = true;
    ctx.events.push({ type: 'fellAsleep', soldier: s.id, collapsed: true });
  } else if (s.breathMax < BREATHMAX_PRETTY_TIRED && !s.forcedToStayAwake) {
    if (!onSquadOrInVehicle(s)) {
      if (setMercAsleep(ctx, s)) ctx.events.push({ type: 'fellAsleep', soldier: s.id, collapsed: false });
    } else if (!s.complainedThatTired) {
      s.complainedThatTired = true;
      ctx.events.push({ type: 'tiredComplaint', soldier: s.id });
    }
  }
}

function wakeIfRested(s: CrewMember, ctx: EconomyContext): void {
  if (s.breathMax >= BREATHMAX_CANCEL_COLLAPSE) s.collapsed = false;
  if (!s.asleep || s.breathMax < BREATHMAX_FULLY_RESTED) return;
  if (setMercAwake(s, false)) ctx.events.push({ type: 'wokeUp', soldier: s.id });
}

export function handleRestFatigueAndSleepStatus(ctx: EconomyContext): void {
  for (const s of ctx.crew.all()) if (!skipsRest(s)) restOrSleep(ctx, s);
  for (const s of ctx.crew.all()) if (!skipsRest(s)) wakeIfRested(s, ctx);
}

export function timeIsCompressedForHealing(ctx: EconomyContext): boolean {
  return ctx.state.flow === 'strategic';
}

function playerGroupInMotion(ctx: EconomyContext, groupId: number): boolean {
  return getGroup(ctx, groupId)?.betweenSectors === true;
}

export function naturalHealingDivisor(ctx: EconomyContext, s: CrewMember): number {
  if (s.assignment === Assignment.ASSIGNMENT_POW) return HIGH_ACTIVITY_LEVEL;
  if (s.asleep || s.assignment === Assignment.PATIENT || s.assignment === Assignment.ASSIGNMENT_HOSPITAL) return LOW_ACTIVITY_LEVEL;
  if (isOnSquad(s))
    return timeIsCompressedForHealing(ctx) && !playerGroupInMotion(ctx, s.groupId) ? LOW_ACTIVITY_LEVEL : HIGH_ACTIVITY_LEVEL;
  return MEDIUM_ACTIVITY_LEVEL;
}

export function updateSoldierLife(s: CrewMember): void {
  s.life = i8(s.life + idiv(s.fractLife, HUNDREDTHS));
  s.fractLife = i16(s.fractLife % HUNDREDTHS);
  if (s.life >= s.lifeMax) {
    s.life = s.lifeMax;
    s.fractLife = 0;
  }
}

export function handleHealingByNaturalCauses(ctx: EconomyContext, s: CrewMember): void {
  if (s.life === 0 || s.life === s.lifeMax || s.bleeding !== 0) return;
  const divisor = naturalHealingDivisor(ctx, s);
  const percentHealth = idiv(s.life * 100, s.lifeMax);
  s.fractLife = i16(s.fractLife + idiv(percentHealth, divisor));
  updateSoldierLife(s);
}

export function handleNaturalHealing(ctx: EconomyContext): void {
  for (const s of ctx.crew.all()) if (!isMechanical(s)) handleHealingByNaturalCauses(ctx, s);
}

export function anyMercInGroupCantContinueMoving(ctx: EconomyContext, members: readonly number[]): boolean {
  let mustStop = false;
  for (const id of members) {
    const s = ctx.crew.get(id);
    if (!s || !playerSoldierTooTiredToTravel(ctx, s)) continue;
    mustStop = true;
    putMercInAsleepState(s);
    s.collapsed = true;
  }
  return mustStop;
}
