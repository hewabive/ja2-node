// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc CalcPatientMedicalCost, CalcMedicalCost, the HOSPITAL_* price modifiers;
// @src Interface_Dialogue.h HOSPITAL_PATIENT_DISTANCE. See docs/25 §11.3.

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { u32 } from '../../../core/int.ts';
import { OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';

export const HospitalPrice = { UNSET: 0, NORMAL: 1, BREAK: 2, COST: 3, FREEBIE: 4, RANDOM_FREEBIE: 5 } as const;

export const HOSPITAL_PATIENT_DISTANCE = 9;
const COST_PER_LIFE_POINT = 10;
const COST_PER_POINT_BELOW_OKLIFE = 25;
const COST_PER_BLEEDING_POINT = 2;
const BREAK_PERCENT = 85;
const COST_PERCENT = 70;
const ROUND_TO = 10;
const MINIMUM_CHARGE = 10;

export interface HospitalPorts {
  readonly globalModifier: number;
  patientModifier(s: Soldier): number;
  inHospital(s: Soldier): boolean;
}

function discounted(cost: number, modifier: number): number {
  if (modifier === HospitalPrice.BREAK) return Math.trunc((cost * BREAK_PERCENT) / 100);
  if (modifier === HospitalPrice.COST) return Math.trunc((cost * COST_PERCENT) / 100);
  return cost;
}

export function calcPatientMedicalCost(s: Soldier, patientModifier: number, globalModifier: number): number {
  if (patientModifier === HospitalPrice.FREEBIE || patientModifier === HospitalPrice.RANDOM_FREEBIE) return 0;
  let cost = u32(COST_PER_LIFE_POINT * (s.lifeMax - s.life));
  if (s.life < OKLIFE) cost = u32(cost + COST_PER_POINT_BELOW_OKLIFE * (OKLIFE - s.life));
  if (s.bleeding > 0) cost = u32(cost + COST_PER_BLEEDING_POINT * s.bleeding);
  if (patientModifier === HospitalPrice.BREAK || patientModifier === HospitalPrice.COST) return discounted(cost, patientModifier);
  if (patientModifier === HospitalPrice.UNSET) return discounted(cost, globalModifier);
  return cost;
}

export function calcMedicalCost(t: TacticalState, doctor: Soldier | null, ports: HospitalPorts): number {
  if (!doctor) return 0;
  let total = 0;
  for (const s of teamMembers(t, Team.OUR)) {
    if (!s.placed || s.life <= 0 || s.life >= s.lifeMax || ports.inHospital(s)) continue;
    if (pythSpacesAway(doctor.gridNo, s.gridNo) > HOSPITAL_PATIENT_DISTANCE) continue;
    total = u32(total + calcPatientMedicalCost(s, ports.patientModifier(s), ports.globalModifier));
  }
  const rounded = Math.trunc((total + ROUND_TO - 1) / ROUND_TO) * ROUND_TO;
  return Math.max(MINIMUM_CHARGE, rounded);
}
