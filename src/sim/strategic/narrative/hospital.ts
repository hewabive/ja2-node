// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HOSPITAL_UNSET…HOSPITAL_RANDOM_FREEBIE, CalcPatientMedicalCost, CalcMedicalCost;
// @src Interface_Dialogue.h HOSPITAL_PATIENT_DISTANCE; Strategic/Assignments.cc SetTimeOfAssignmentChangeForMerc (the refund);
// @src Strategic/Strategic_Event_Handler.cc CheckForMissingHospitalSupplies.

import { i32, idiv, u32 } from '../../../core/int.ts';
import { Fact } from './fact-ids.ts';
import type { HospitalAccount } from './facts.ts';

export const HospitalPrice = { UNSET: 0, NORMAL: 1, BREAK: 2, COST: 3, FREEBIE: 4, RANDOM_FREEBIE: 5 } as const;

export const HOSPITAL_PATIENT_DISTANCE = 9;
export const SUPPLIES_FULL_STATUS = 60;
export const MEDICAL_SUPPLY_ITEMS = ['FIRSTAIDKIT', 'MEDICKIT', 'REGEN_BOOSTER', 'ADRENALINE_BOOSTER'] as const;

const OKLIFE = 15;
const COST_PER_LIFE_POINT = 10;
const COST_PER_POINT_BELOW_OKLIFE = 25;
const COST_PER_BLEEDING_POINT = 2;
const BREAK_PERCENT = 85;
const COST_PERCENT = 70;
const PERCENT = 100;
const ROUNDING = 10;
const MINIMUM_CHARGE = 10;
const GIVE_UP_FRACTION = 5;

export interface HospitalPatient {
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
  readonly hospitalPriceModifier: number;
}

function isFree(modifier: number): boolean {
  return modifier === HospitalPrice.FREEBIE || modifier === HospitalPrice.RANDOM_FREEBIE;
}

function discounted(cost: number, modifier: number): number {
  if (modifier === HospitalPrice.BREAK) return idiv(u32(cost * BREAK_PERCENT), PERCENT);
  if (modifier === HospitalPrice.COST) return idiv(u32(cost * COST_PERCENT), PERCENT);
  return cost;
}

export function calcPatientMedicalCost(p: HospitalPatient | null, globalModifier: number): number {
  if (!p || isFree(p.hospitalPriceModifier)) return 0;
  let cost = u32(COST_PER_LIFE_POINT * (p.lifeMax - p.life));
  if (p.life < OKLIFE) cost = u32(cost + COST_PER_POINT_BELOW_OKLIFE * (OKLIFE - p.life));
  if (p.bleeding > 0) cost = u32(cost + COST_PER_BLEEDING_POINT * p.bleeding);
  if (p.hospitalPriceModifier === HospitalPrice.UNSET) return discounted(cost, globalModifier);
  return discounted(cost, p.hospitalPriceModifier);
}

export function roundMedicalCost(sum: number): number {
  return Math.max(MINIMUM_CHARGE, u32(idiv(u32(sum + ROUNDING - 1), ROUNDING) * ROUNDING));
}

export function calcMedicalCost(patients: readonly HospitalPatient[], globalModifier: number): number {
  let sum = 0;
  for (const p of patients) sum = u32(sum + calcPatientMedicalCost(p, globalModifier));
  return roundMedicalCost(sum);
}

export function medicalRequestShownCost(cost: number, refund: number): number {
  return refund > cost ? MINIMUM_CHARGE : cost - refund;
}

export interface HospitalLeaver {
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
  hospitalPriceModifier: number;
}

export function refundUnusedHospitalPayment(account: HospitalAccount, patient: HospitalLeaver): void {
  account.refund = i32(account.refund + calcPatientMedicalCost(patient, account.priceModifier));
  patient.hospitalPriceModifier = HospitalPrice.UNSET;
}

export interface SupplyFacts {
  checkFact(id: number): boolean;
  setFactTrue(id: number): void;
  setFactFalse(id: number): void;
}

export function checkForMissingHospitalSupplies(facts: SupplyFacts, expected: number, medicalObjects: number): void {
  if (facts.checkFact(Fact.PLAYER_STOLE_MEDICAL_SUPPLIES_AGAIN) && medicalObjects >= expected) {
    facts.setFactFalse(Fact.PLAYER_STOLE_MEDICAL_SUPPLIES_AGAIN);
    facts.setFactFalse(Fact.PLAYER_STOLE_MEDICAL_SUPPLIES);
    return;
  }
  if (medicalObjects >= expected) return;
  if (!facts.checkFact(Fact.PLAYER_STOLE_MEDICAL_SUPPLIES)) facts.setFactTrue(Fact.PLAYER_STOLE_MEDICAL_SUPPLIES);
  if (medicalObjects * GIVE_UP_FRACTION <= expected) facts.setFactTrue(Fact.PLAYER_STOLE_MEDICAL_SUPPLIES_AGAIN);
}
