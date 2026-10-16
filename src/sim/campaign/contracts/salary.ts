// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Campaign.cc ChangeStat (experience level gains), CalcNewSalary, RoundOffSalary;
// @src Campaign.h SALARY_CHANGE_PER_LEVEL, MAX_DAILY_SALARY, MAX_LARGE_SALARY. See docs/22 §3.7.

import { i16, idiv, u16, u32 } from '../../../core/int.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';

export const MAX_DAILY_SALARY = 30000;
export const MAX_LARGE_SALARY = 500000;
const MIN_SALARY = 5;
const SALARY_RAISE_NUMERATOR = 5;
const SALARY_RAISE_DENOMINATOR = 4;
const ROUNDING_STEPS: readonly (readonly [number, number])[] = [
  [250, 5],
  [500, 10],
  [1000, 25],
  [2000, 50],
  [5000, 100],
  [10000, 500],
  [25000, 1000],
  [50000, 2000],
];
const LARGEST_STEP = 5000;

export function roundOffSalary(salary: number): number {
  const multiple = ROUNDING_STEPS.find(([limit]) => salary <= limit)?.[1] ?? LARGEST_STEP;
  if (salary % multiple === 0) return salary;
  return u32(idiv(salary + idiv(multiple, 2), multiple) * multiple);
}

export function calcNewSalary(old: number, max: number): number {
  if (old === 0) return 0;
  let salary = roundOffSalary(u32(idiv(old * SALARY_RAISE_NUMERATOR, SALARY_RAISE_DENOMINATOR)));
  if (salary > max) salary = max;
  if (salary < MIN_SALARY) salary = MIN_SALARY;
  return salary;
}

export function raiseSalaries(p: ProfileProgress, levels: number): void {
  for (let level = 0; level < levels; level++) {
    p.salary = i16(calcNewSalary(u32(p.salary), MAX_DAILY_SALARY));
    p.weeklySalary = calcNewSalary(p.weeklySalary, MAX_LARGE_SALARY);
    p.biWeeklySalary = calcNewSalary(p.biWeeklySalary, MAX_LARGE_SALARY);
    p.medicalDepositAmount = u16(i16(calcNewSalary(p.medicalDepositAmount, MAX_DAILY_SALARY)));
  }
}
