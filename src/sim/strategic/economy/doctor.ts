// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc HandleDoctorsInSector, HealCharacters, HealStat, HealPatient,
// @src CheckForAndHandleHospitalPatients, HealHospitalPatient, UpdatePatientsWhoAreDoneHealing,
// @src BandageBleedingDyingPatientsBeingTreated.

import { ItemClass } from '../../../content/items/items.ts';
import { MAP_WORLD_X, sameSector } from '../../../content/strategic/sector-ids.ts';
import { i8, i16, idiv, u16 } from '../../../core/int.ts';
import type { ItemObject } from '../../items/object.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent, deleteAllStrategicEventsOfType } from '../time/event-queue.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import { assignmentAborted, assignmentDone } from './assignment-done.ts';
import {
  anyDoctorWhoCanHealThisPatient,
  canCharacterDoctor,
  canSoldierBeHealedByDoctor,
  canStatsBeHealed,
  enoughTimeOnAssignment,
  numberThatCanBeDoctored,
} from './conditions.ts';
import { Assignment, HOSPITAL_SECTOR, OKLIFE, SECTORS_WITH_SOLDIERS_Z_LEVELS, StatAmt, StatCause } from './constants.ts';
import { findObjClass, kitItems, makeSureMedKitIsInHand, NO_SLOT, Slot, totalPoints, useKitPoints } from './kits.ts';
import { calculateHealingPointsForDoctor } from './points.ts';
import type { CrewMember, EconomyContext, StatDamage } from './ports.ts';

const POINT_COST_PER_HEALTH_BELOW_OKLIFE = 2;
const STAT_HEALING_RATE_DIVISOR = 3;
const HOSPITAL_HEALING_RATE = 5;
const HUNDREDTHS = 100;
const MAX_STAT_VALUE = 100;
const MEDICAL_CHANCE_DIVISOR = 100;
const SECONDARY_CHANCE_DIVISOR = 200;
const STAT_DAMAGE_KEYS: readonly (keyof StatDamage)[] = ['agility', 'dexterity', 'strength', 'wisdom'];

function medicalKits(ctx: EconomyContext, doctor: CrewMember): ItemObject[] {
  const medicKit = kitItems(ctx.items).medicKit;
  const kits: ItemObject[] = [];
  for (let slot = Slot.HAND; slot <= Slot.SMALLPOCK8; slot++) {
    const o = doctor.inv[slot];
    if (o?.item === medicKit) kits.push(o);
  }
  return kits;
}

function healCriticalLife(ctx: EconomyContext, patient: CrewMember, doctor: CrewMember, pointsLeft: number): number {
  let left = pointsLeft;
  let toUse = i8(POINT_COST_PER_HEALTH_BELOW_OKLIFE * (OKLIFE - patient.life));
  if (toUse > left) toUse = i8(left);
  for (const kit of medicalKits(ctx, doctor)) {
    const used = i8(useKitPoints(kit, toUse));
    toUse = i8(toUse - used);
    left = u16(left - used);
    patient.life = i8(patient.life + idiv(used, POINT_COST_PER_HEALTH_BELOW_OKLIFE));
    if (toUse <= 0 || patient.life >= OKLIFE) break;
  }
  return left;
}

function healNormalLife(ctx: EconomyContext, patient: CrewMember, doctor: CrewMember, pointsLeft: number): number {
  let left = pointsLeft;
  let toUse = i8(patient.lifeMax - patient.life);
  if (toUse > left) toUse = i8(left);
  for (const kit of medicalKits(ctx, doctor)) {
    const used = i8(useKitPoints(kit, toUse));
    toUse = i8(toUse - used);
    left = u16(left - used);
    patient.life = i8(patient.life + used);
    if (toUse <= 0 || patient.life === patient.lifeMax) break;
  }
  return left;
}

function healStat(ctx: EconomyContext, patient: CrewMember, key: keyof StatDamage, amount: number): void {
  const damage = patient.statDamage[key];
  const healed = Math.min(amount, damage);
  if (damage > MAX_STAT_VALUE) return;
  patient.statDamage[key] = i8(damage - healed);
  ctx.crew.healStat(patient.id, key, healed);
}

function healDamagedStats(ctx: EconomyContext, patient: CrewMember, doctor: CrewMember, pointsLeft: number): number {
  let left = pointsLeft;
  let worst = 0;
  STAT_DAMAGE_KEYS.forEach((key, k) => {
    if (patient.statDamage[key] > patient.statDamage[STAT_DAMAGE_KEYS[worst] ?? 'agility']) worst = k;
  });
  const key = STAT_DAMAGE_KEYS[worst] ?? 'agility';
  let toUse = i8(patient.statDamage[key]);
  if (toUse > left) toUse = i8(left);
  for (const kit of medicalKits(ctx, doctor)) {
    const used = i8(useKitPoints(kit, toUse * STAT_HEALING_RATE_DIVISOR));
    toUse = i8(toUse - used);
    left = u16(left - used);
    healStat(ctx, patient, key, i8(idiv(used, STAT_HEALING_RATE_DIVISOR)));
    if (toUse <= 0 || !canStatsBeHealed(ctx, patient)) break;
  }
  return left;
}

export function healPatient(ctx: EconomyContext, patient: CrewMember, doctor: CrewMember, hundredths: number): number {
  patient.fractLife = i16(patient.fractLife + hundredths);
  let used = u16(hundredths);
  let left = u16(idiv(patient.fractLife, HUNDREDTHS));
  patient.fractLife = i16(patient.fractLife % HUNDREDTHS);
  if (left === 0) return used;
  if (patient.life < OKLIFE) left = healCriticalLife(ctx, patient, doctor, left);
  if (patient.life < patient.lifeMax) left = healNormalLife(ctx, patient, doctor, left);
  if (canStatsBeHealed(ctx, patient)) left = healDamagedStats(ctx, patient, doctor, left);
  if (patient.life === patient.lifeMax && !canStatsBeHealed(ctx, patient)) {
    used = u16(used - HUNDREDTHS * left);
    used = u16(used - patient.fractLife);
    patient.fractLife = 0;
  }
  return used;
}

function healableThisHour(ctx: EconomyContext, doctor: CrewMember): CrewMember[] {
  return ctx.crew.all().filter((p) => canSoldierBeHealedByDoctor(ctx, p, doctor, true, false, false));
}

function worstHurtPatient(ctx: EconomyContext, doctor: CrewMember): CrewMember | null {
  let worst: CrewMember | null = null;
  for (const p of healableThisHour(ctx, doctor)) if (!worst || p.life < worst.life) worst = p;
  return worst;
}

export function healCharacters(ctx: EconomyContext, doctor: CrewMember): void {
  const patients = numberThatCanBeDoctored(ctx, doctor, true, false, false);
  if (patients > 0) {
    const available = calculateHealingPointsForDoctor(doctor, kitItems(ctx.items), true).points;
    let remaining = available;
    const even = idiv(remaining, patients);
    for (const p of ctx.crew.all()) {
      if (canSoldierBeHealedByDoctor(ctx, p, doctor, true, false, false)) remaining = u16(remaining - healPatient(ctx, p, doctor, even));
    }
    while (remaining > 0) {
      const worst = worstHurtPatient(ctx, doctor);
      if (!worst) break;
      const before = remaining;
      remaining = u16(remaining - healPatient(ctx, worst, doctor, remaining));
      if (remaining === before) remaining = 0;
    }
    const used = u16(available - remaining);
    ctx.crew.statChange(doctor.id, StatAmt.MEDICAL, idiv(used, MEDICAL_CHANCE_DIVISOR), StatCause.SUCCESS);
    ctx.crew.statChange(doctor.id, StatAmt.DEXTERITY, idiv(used, SECONDARY_CHANCE_DIVISOR), StatCause.SUCCESS);
    ctx.crew.statChange(doctor.id, StatAmt.WISDOM, idiv(used, SECONDARY_CHANCE_DIVISOR), StatCause.SUCCESS);
  }
  if (numberThatCanBeDoctored(ctx, doctor, false, false, false) !== 0) return;
  if (numberThatCanBeDoctored(ctx, doctor, false, true, false) > 0) assignmentAborted(ctx, doctor, 'noMedkits');
  else if (numberThatCanBeDoctored(ctx, doctor, false, false, true) > 0) assignmentAborted(ctx, doctor, 'insufficientDoctorSkill');
  else assignmentDone(ctx, doctor, true, true);
}

export function handleDoctorsInSector(
  ctx: EconomyContext,
  sector: { x: number; y: number; z: number },
  sleptPastHour: ReadonlySet<number>,
): void {
  const kits = kitItems(ctx.items);
  for (const s of ctx.crew.all()) {
    if (!sameSector(s.sector, sector) || s.assignment !== Assignment.DOCTOR || sleptPastHour.has(s.id)) continue;
    makeSureMedKitIsInHand(s.inv, kits);
    if (!canCharacterDoctor(ctx, s) || !enoughTimeOnAssignment(ctx, s)) continue;
    healCharacters(ctx, s);
  }
}

export function updatePatientsWhoAreDoneHealing(ctx: EconomyContext): void {
  for (const s of ctx.crew.all())
    if (s.assignment === Assignment.PATIENT && s.life === s.lifeMax && !canStatsBeHealed(ctx, s)) assignmentDone(ctx, s, true, true);
}

function healHospitalPatient(ctx: EconomyContext, patient: CrewMember, points: number): void {
  let left = points;
  if (left <= 0) return;
  if (patient.life < OKLIFE) {
    let toUse = i8(POINT_COST_PER_HEALTH_BELOW_OKLIFE * (OKLIFE - patient.life));
    if (toUse > left) toUse = i8(left);
    left -= toUse;
    patient.life = i8(patient.life + idiv(toUse, POINT_COST_PER_HEALTH_BELOW_OKLIFE));
  }
  if (patient.life < patient.lifeMax) {
    let toUse = i8(patient.lifeMax - patient.life);
    if (toUse > left) toUse = i8(left);
    left -= toUse;
    patient.life = i8(patient.life + toUse);
  }
  if (patient.life === patient.lifeMax) assignmentDone(ctx, patient, true, true);
}

export function checkForAndHandleHospitalPatients(ctx: EconomyContext, sectorsWithSoldiers: ReadonlySet<number>): void {
  if (!sectorsWithSoldiers.has(sectorsWithSoldiersKey(HOSPITAL_SECTOR))) return;
  for (const s of ctx.crew.all())
    if (s.assignment === Assignment.ASSIGNMENT_HOSPITAL && sameSector(s.sector, HOSPITAL_SECTOR))
      healHospitalPatient(ctx, s, HOSPITAL_HEALING_RATE);
}

export function sectorsWithSoldiersKey(s: { readonly x: number; readonly y: number; readonly z: number }): number {
  return (s.x + s.y * MAP_WORLD_X) * SECTORS_WITH_SOLDIERS_Z_LEVELS + s.z;
}

export function bandageBleedingDyingPatientsBeingTreated(ctx: EconomyContext): void {
  let someoneStillBleedingOrDying = false;
  for (const p of ctx.crew.all()) {
    if (!p.bleeding && p.life >= OKLIFE) continue;
    if (p.assignment !== Assignment.PATIENT && p.assignment !== Assignment.ASSIGNMENT_HOSPITAL && p.assignment !== Assignment.DOCTOR)
      continue;
    if (p.assignment === Assignment.ASSIGNMENT_HOSPITAL) {
      p.bleeding = 0;
      if (p.life < OKLIFE) p.life = OKLIFE;
      continue;
    }
    const doctor = anyDoctorWhoCanHealThisPatient(ctx, p, false);
    if (!doctor) continue;
    const slot = findObjClass(ctx.items, doctor.inv, ItemClass.MEDKIT);
    if (slot === NO_SLOT) continue;
    const kit = doctor.inv[slot] as ItemObject;
    const kitPoints = totalPoints(kit);
    if (!kitPoints) continue;
    const used = ctx.crew.dressWound(doctor.id, p.id, kit, kitPoints, kitPoints);
    useKitPoints(kit, u16(used));
    if (p.bleeding || p.life < OKLIFE) someoneStillBleedingOrDying = true;
  }
  deleteAllStrategicEventsOfType(ctx.state.queue, EventKind.BANDAGE_BLEEDING_MERCS);
  if (someoneStillBleedingOrDying)
    addStrategicEvent(ctx.state.queue, EventKind.BANDAGE_BLEEDING_MERCS, worldTotalMinutes(ctx.state.clock) + 1, 0);
}
