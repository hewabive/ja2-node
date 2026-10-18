// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc HandleItem (the medkit branch); Soldier_Control.cc EVENT_SoldierBeginFirstAid,
// @src SoldierDressWound, InternalReceivingSoldierCancelServices, InternalGivingSoldierCancelServices,
// @src SoldierGotoStationaryStance (the GIVING_AID branch); Overhead.cc HandleTeamServices, HandlePlayerServices;
// @src Points.cc GetAPsToBeginFirstAid; Soldier_Ani.cc code 768; externalized/Soldier.cc handlePendingAction
// @src (MERC_GIVEAID); Handle_UI.cc the medkit checks of the item cursor; RT_Time_Defines.h RT_FIRST_AID_GAIN_MODIFIER.
// @src See docs/12 §5, docs/04 §6.23.

import type { OpOutcome } from '../../content/anim/script.ts';
import { ItemClass } from '../../content/items/items.ts';
import { i8, i16, idiv, u8, u32 } from '../../core/int.ts';
import { swapObjects } from '../items/object.ts';
import { findObj, totalPoints, useKitPoints } from '../strategic/economy/kits.ts';
import { plotPathCost } from './ai/utils.ts';
import { anim } from './anim-states.ts';
import { AnimHeight, changeSoldierStance, initNewSoldierAnim, soldierGotoStationaryStance } from './animation.ts';
import { StatCause, statChange } from './combat/experience.ts';
import { findAdjacentGridEx } from './combat/melee-reach.ts';
import { InvSlot, itemIn, NO_SLOT } from './inventory.ts';
import { getNewSoldierPath } from './movement.ts';
import { AP, apsToChangeStance, BP_PER_AP, deductPoints, enoughPoints } from './points.ts';
import { StatKind } from './profiles.ts';
import { effectiveDexterity, effectiveExpLevel, effectiveMedical } from './skills.ts';
import { Body, isCreatureOrBloodcat, NO_PROFILE, NOBODY, OKLIFE, type Soldier, Team } from './soldier.ts';
import { type TacticalState, teamMembers, whoIsThere } from './state.ts';
import { numCapableEnemyInSector } from './turns/turns.ts';

const RT_FIRST_AID_GAIN_MODIFIER = 12;
const DRESS_SKILL_DIVISOR = 7;
const POSSIBLE_DIVISOR = 50;
const MAX_KIT_STATUS = 100;
const END_FIRST_AID_CODE = 768;

export const FirstAidRefusal = {
  NO_KIT: 'noKit',
  NO_TARGET: 'noTarget',
  MECHANICAL: 'mechanical',
  NO_MEDICAL_SKILL: 'noMedicalSkill',
  NOT_BLEEDING: 'notBleeding',
  NO_NEED: 'noNeed',
  CANNOT_GET_THERE: 'cannotGetThere',
  NOT_ENOUGH_APS: 'notEnoughAP',
} as const;

export type FirstAidRefusal = (typeof FirstAidRefusal)[keyof typeof FirstAidRefusal];

const isMedKit = (t: TacticalState, item: number) => t.content.items.byIndex.get(item)?.itemClass === ItemClass.MEDKIT;
const medicKitIndex = (t: TacticalState) => t.content.items.byName.get('MEDICKIT')?.index ?? -1;
const firstAidKitIndex = (t: TacticalState) => t.content.items.byName.get('FIRSTAIDKIT')?.index ?? -1;
const usesMedicKit = (t: TacticalState, s: Soldier) => itemIn(s.inv, InvSlot.HAND) === medicKitIndex(t);
const isMechanical = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON || (s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP);

export function apsToBeginFirstAid(t: TacticalState, s: Soldier): number {
  return apsToChangeStance(t.content, s, AnimHeight.CROUCH) + AP.START_FIRST_AID;
}

export function firstAidTargetRefusal(t: TacticalState, s: Soldier, target: Soldier | null): FirstAidRefusal | null {
  if (!isMedKit(t, itemIn(s.inv, InvSlot.HAND))) return FirstAidRefusal.NO_KIT;
  if (!target) return FirstAidRefusal.NO_TARGET;
  if (isMechanical(target)) return FirstAidRefusal.MECHANICAL;
  if (s.stats.medical === 0) return FirstAidRefusal.NO_MEDICAL_SKILL;
  if (target.bleeding === 0 && target.life !== target.lifeMax) return FirstAidRefusal.NOT_BLEEDING;
  if (target.bleeding === 0 && target.life >= OKLIFE) return FirstAidRefusal.NO_NEED;
  return null;
}

export function beginFirstAid(t: TacticalState, s: Soldier, targetGridNo: number): FirstAidRefusal | null {
  const approach = findAdjacentGridEx(t, s, targetGridNo, true);
  if (!approach) return FirstAidRefusal.CANNOT_GET_THERE;
  const path = s.gridNo === approach.actionGridNo ? 0 : plotPathCost(t, s, approach.actionGridNo, s.uiMovementMode);
  if (!enoughPoints(t.inCombat, s, apsToBeginFirstAid(t, s) + path)) return FirstAidRefusal.NOT_ENOUGH_APS;
  if (s.gridNo === approach.actionGridNo) {
    soldierBeginFirstAid(t, s, approach.targetGridNo, approach.direction);
    return null;
  }
  const patient = whoIsThere(t, targetGridNo, s.level);
  s.pendingAid = { targetGridNo: patient ? patient.gridNo : targetGridNo, direction: approach.direction };
  if (!getNewSoldierPath(t, s, approach.actionGridNo, s.uiMovementMode, 0, true)) {
    s.pendingAid = null;
    return FirstAidRefusal.CANNOT_GET_THERE;
  }
  return null;
}

export function handlePendingAidOnArrival(t: TacticalState, s: Soldier): boolean {
  const pending = s.pendingAid;
  if (!pending) return false;
  s.pendingAid = null;
  soldierBeginFirstAid(t, s, pending.targetGridNo, pending.direction);
  return true;
}

function refusesFirstAid(t: TacticalState, medic: Soldier, patient: Soldier): boolean {
  if (patient.team === Team.OUR) return false;
  if (patient.profile !== NO_PROFILE && t.narrative.isNpcOrRpcProfile(patient.profile) && t.narrative.pcDoesFirstAidOnNpc(patient.profile))
    return true;
  if (isCreatureOrBloodcat(patient)) return true;
  return !patient.neutral && patient.life >= OKLIFE && patient.side !== medic.side;
}

export function soldierBeginFirstAid(t: TacticalState, s: Soldier, gridNo: number, direction: number): void {
  const patient = whoIsThere(t, gridNo, s.level);
  if (!patient) return;
  if (refusesFirstAid(t, s, patient)) {
    t.events.push({ type: 'firstAidRefused', soldier: s.id, patient: patient.id });
    return;
  }
  givingSoldierCancelServices(t, s, false);
  s.desiredDirection = direction;
  s.direction = direction;
  initNewSoldierAnim(t, s, anim(t.content, 'START_AID'), 0, false);
  s.targetGridNo = gridNo;
  s.servicePartner = patient.id;
  patient.serviceCount++;
  if (patient !== s && !patient.collapsed) soldierGotoStationaryStance(t, patient);
  t.events.push({ type: 'firstAidStarted', soldier: s.id, patient: patient.id });
}

function dressSkill(medic: Soldier, kitStatus: number): number {
  return u32(
    idiv(3 * effectiveMedical(medic) + 2 * kitStatus + 10 * effectiveExpLevel(medic) + effectiveDexterity(medic), DRESS_SKILL_DIVISOR),
  );
}

function healBelowOkLife(victim: Soldier, points: number, belowOkLife: number): number {
  let left = points;
  if (left >= 2 * belowOkLife) {
    victim.life = OKLIFE;
    victim.bleeding = i8(victim.bleeding - belowOkLife);
    left = u8(left - 2 * belowOkLife);
  } else {
    victim.life = i8(victim.life + idiv(left, 2));
    victim.bleeding = i8(victim.bleeding - idiv(left, 2));
    left %= 2;
  }
  if (victim.bleeding < 0) victim.bleeding = 0;
  return left;
}

function stopBleeding(victim: Soldier, points: number): number {
  if (points >= victim.bleeding) {
    const left = u8(points - victim.bleeding);
    victim.bleeding = 0;
    return left;
  }
  victim.bleeding = i8(victim.bleeding - points);
  return 0;
}

interface DressCost {
  readonly actual: number;
  readonly cost: number;
}

function affordableDressing(medicKit: boolean, wanted: number, kitPoints: number): DressCost {
  if (medicKit) {
    const cost = idiv(wanted + 1, 2);
    return cost > kitPoints ? { actual: kitPoints * 2, cost: kitPoints } : { actual: wanted, cost };
  }
  return wanted > kitPoints ? { actual: kitPoints, cost: kitPoints } : { actual: wanted, cost: wanted };
}

export function soldierDressWound(t: TacticalState, medic: Soldier, victim: Soldier, kitPoints: number, kitStatus: number): number {
  if (victim.bleeding < 1 && victim.life >= OKLIFE) return 0;
  if (victim.life === 0) return 0;
  const skill = dressSkill(medic, Math.min(kitStatus, MAX_KIT_STATUS));
  const available = u32(t.inCombat ? medic.actionPoints : RT_FIRST_AID_GAIN_MODIFIER);
  let possible = u32(idiv(u32(Math.imul(available, skill)), POSSIBLE_DIVISOR));
  if (!possible) return 0;
  const medicKit = usesMedicKit(t, medic);
  if (medicKit) possible = u32(possible + idiv(possible, 2));
  const belowOkLife = victim.life >= OKLIFE ? 0 : u8(OKLIFE - victim.life);
  let deficiency = 2 * belowOkLife;
  if (victim.bleeding - belowOkLife > 0) deficiency += victim.bleeding - belowOkLife;
  const dressing = affordableDressing(medicKit, Math.min(possible, deficiency), kitPoints);
  let left = u8(dressing.actual);
  if (left && victim.life < OKLIFE) left = healBelowOkLife(victim, left, belowOkLife);
  if (left && victim.bleeding) left = stopBleeding(victim, left);
  const actual = u32(dressing.actual - left);
  let usedAPs = u32(idiv(u32(Math.imul(actual, available)), possible));
  if (medicKit) usedAPs = idiv(usedAPs * 2, 3);
  deductPoints(t.inCombat, medic, i16(usedAPs), i16(usedAPs * BP_PER_AP.LT_EFFORT));
  if (medic.team === Team.OUR) {
    statChange(t, medic, StatKind.MEDICAL, idiv(actual, 2), StatCause.SUCCESS);
    statChange(t, medic, StatKind.DEXTERITY, idiv(actual, 6), StatCause.SUCCESS);
  }
  return dressing.cost;
}

export function receivingSoldierCancelServices(t: TacticalState, s: Soldier, playEndAnim = true): void {
  if (s.serviceCount <= 0) return;
  for (const medic of t.soldiers) {
    if (!medic || medic.servicePartner !== s.id) continue;
    s.serviceCount--;
    medic.servicePartner = NOBODY;
    t.events.push({ type: 'firstAidEnded', soldier: medic.id, patient: s.id });
    if (medic.life >= OKLIFE && medic.breath > 0 && playEndAnim) initNewSoldierAnim(t, medic, anim(t.content, 'END_AID'), 0, false);
  }
}

export function givingSoldierCancelServices(t: TacticalState, s: Soldier, playEndAnim = true): void {
  if (s.servicePartner === NOBODY) return;
  const patient = t.soldiers[s.servicePartner];
  if (patient) patient.serviceCount--;
  t.events.push({ type: 'firstAidEnded', soldier: s.id, patient: s.servicePartner });
  s.servicePartner = NOBODY;
  if (s.life >= OKLIFE && s.breath > 0 && playEndAnim) initNewSoldierAnim(t, s, anim(t.content, 'END_AID'), 0, false);
}

export function cancelAllServices(t: TacticalState, s: Soldier, playEndAnim = true): void {
  receivingSoldierCancelServices(t, s, playEndAnim);
  givingSoldierCancelServices(t, s, playEndAnim);
}

function nextKitSlot(t: TacticalState, s: Soldier): number {
  const firstAid = findObj(s.inv, firstAidKitIndex(t));
  return firstAid !== NO_SLOT ? firstAid : findObj(s.inv, medicKitIndex(t));
}

export function handlePlayerServices(t: TacticalState, s: Soldier): void {
  if (s.life < OKLIFE) return;
  if (s.state !== anim(t.content, 'GIVING_AID')) return;
  const patient = whoIsThere(t, s.targetGridNo, s.level);
  if (!patient || patient.serviceCount === 0) return;
  const kit = s.inv[InvSlot.HAND];
  if (!kit) return;
  const kitPoints = totalPoints(kit);
  const used = soldierDressWound(t, s, patient, kitPoints, kitPoints);
  t.events.push({ type: 'bandaged', soldier: s.id, patient: patient.id, life: patient.life, bleeding: patient.bleeding });
  const done = patient.bleeding === 0 && patient.life >= OKLIFE;
  if (done) {
    t.events.push({ type: 'firstAidDone', soldier: s.id, patient: patient.id });
    receivingSoldierCancelServices(t, patient);
  }
  useKitPoints(kit, used);
  if (totalPoints(kit) > 0) return;
  const slot = done ? NO_SLOT : nextKitSlot(t, s);
  if (slot !== NO_SLOT) {
    swapObjects(kit, s.inv[slot] as typeof kit);
    return;
  }
  t.events.push({ type: 'outOfBandages', soldier: s.id });
  givingSoldierCancelServices(t, s);
}

export function handleTeamServices(t: TacticalState, team: number): void {
  for (const s of teamMembers(t, team)) if (s.placed) handlePlayerServices(t, s);
}

export function firstAidOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code !== END_FIRST_AID_CODE) return null;
  if (numCapableEnemyInSector(t) !== 0) return 'continue';
  changeSoldierStance(t, s, AnimHeight.STAND);
  return 'stop';
}
