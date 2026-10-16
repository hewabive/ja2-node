// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Profile.cc CalcCompetence, CalcMedicalDeposit; Tactical/Merc_Hiring.cc IsMercHireable,
// @src IsMercDead. See docs/21 §2.1, §2.4.

import { u16, u32 } from '../../../core/int.ts';
import { MercStatus, type ProfileProgress } from '../../tactical/profiles.ts';

const FIFTH_ROOTS: readonly number[] = [
  0, 1, 1.148698354997035, 1.2457309396155174, 1.3195079107728942, 1.379729661461215, 1.4309690811052556, 1.4757731615945522,
  1.5157165665103982, 1.5518455739153598, 1.5848931924611136,
];
const CUBE_SCALE = 10000;
const MARKSMANSHIP_WEIGHT = 2;
const MEDICAL_WEIGHT = 1.5;
const STATS_DIVISOR = 3;
const AP_BASE = 5;
const AP_ROUNDING = 20;
const AP_DIVISOR = 40;
const AP_OFFSET = 6;
const TRAIT_BONUS = 0.05;
const COMPETENCE_DIVISOR = 1000;
const DEPOSIT_PER_COMPETENCE = 5;
const DEPOSIT_ROUNDING = 50;
const DEPOSIT_STEP = 100;
const UNHIREABLE_STATUSES: ReadonlySet<number> = new Set([
  MercStatus.HAS_NO_TEXT_FILE,
  MercStatus.HIRED_BUT_NOT_ARRIVED_YET,
  MercStatus.IS_DEAD,
  MercStatus.RETURNING_HOME,
  MercStatus.WORKING_ELSEWHERE,
  MercStatus.FIRED_AS_A_POW,
]);

function cubeTerm(value: number): number {
  return (value * value * value) / CUBE_SCALE;
}

function fifthRoot(level: number): number {
  const root = FIFTH_ROOTS[level];
  if (root === undefined) throw new RangeError(`experience level ${level} outside the fifth-root table`);
  return root;
}

export function calcCompetence(p: ProfileProgress): number {
  const s = p.stats;
  const stats = Math.trunc(
    (2 * s.lifeMax + s.strength + s.agility + s.dexterity + Math.trunc((s.leadership + s.wisdom) / 2)) / STATS_DIVISOR,
  );
  const skills = u32(
    Math.trunc(
      MARKSMANSHIP_WEIGHT * cubeTerm(s.marksmanship) +
        MEDICAL_WEIGHT * cubeTerm(s.medical) +
        cubeTerm(s.mechanical) +
        cubeTerm(s.explosives),
    ),
  );
  const actionPoints =
    AP_BASE + Math.trunc((10 * s.experience + 3 * s.agility + 2 * s.lifeMax + 2 * s.dexterity + AP_ROUNDING) / AP_DIVISOR);
  const traits = (p.skillTrait !== 0 ? 1 : 0) + (p.skillTrait2 !== 0 ? 1 : 0);
  const competence =
    (fifthRoot(s.experience) * stats * skills * u32(actionPoints - AP_OFFSET) * (1 + TRAIT_BONUS * traits)) / COMPETENCE_DIVISOR;
  return u16(Math.trunc(competence));
}

export function calcMedicalDeposit(p: ProfileProgress): number {
  return u16(Math.trunc((DEPOSIT_PER_COMPETENCE * calcCompetence(p) + DEPOSIT_ROUNDING) / DEPOSIT_STEP) * DEPOSIT_STEP);
}

export function isMercHireable(p: Pick<ProfileProgress, 'mercStatus' | 'dayBecomesAvailable'>): boolean {
  return p.mercStatus <= 0 && !UNHIREABLE_STATUSES.has(p.mercStatus) && p.dayBecomesAvailable === 0;
}

export function isMercDead(p: Pick<ProfileProgress, 'mercStatus'>): boolean {
  return p.mercStatus === MercStatus.IS_DEAD;
}
