// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc CalculateHealingPointsForDoctor, CalculateRepairPointsForRepairman,
// @src GetTrainingStatValue, GetSoldierTrainingPts, GetSoldierStudentPts, GetBonusTrainingPtsDueToInstructor,
// @src GetTownTrainPtsForCharacter; Tactical/SkillCheck.cc GetPenaltyForFatigue, ReducePointsForFatigue. See docs/18 §1.4, §5.6–§5.8.

import { MercType } from '../../../content/strategic/economy-content.ts';
import { sameSector } from '../../../content/strategic/sector-ids.ts';
import { i8, i16, idiv, u8, u16 } from '../../../core/int.ts';
import { Assignment, SkillTrait, TRAINING_RATING_CAP, TrainStat } from './constants.ts';
import { type KitItems, makeSureMedKitIsInHand, makeSureToolKitIsInHand, Slot, toolKitPoints, totalMedicalKitPoints } from './kits.ts';
import type { CrewMember, EconomyContext, MercStats } from './ports.ts';

const DOCTORING_RATE_DIVISOR = 2400;
const REPAIR_RATE_DIVISOR = 2500;
const ASSIGNMENT_UNITS_PER_DAY = 24;
const EXP_LEVEL_PERCENT = 5;
const KIT_POINTS_PER_HEALING_POINT = 100;
const BAD_KIT_POINTS = 25;
const POOR_KIT_POINTS = 50;
const BAD_KIT_EFFECTIVENESS = 50;
const POOR_KIT_EFFECTIVENESS = 75;
const FULL_KIT_EFFECTIVENESS = 100;
const SELF_TRAINING_DIVISOR = 1000;
const INSTRUCTED_TRAINING_DIVISOR = 3000;
const GUN_RANGE_TRAINING_BONUS = 25;
const TEACH_BONUS_TO_TRAIN = 30;
const RPC_BONUS_TO_TRAIN = 10;
const TOWN_TRAINING_RATE = 4;
const EXP_LEVEL_TOWN_WEIGHT = 10;
const MIN_INSTRUCTOR_ADVANTAGE = 10;
const DEFAULT_STUDENT_WISDOM = 100;

export interface Points {
  readonly points: number;
  readonly max: number;
}

const NONE: Points = { points: 0, max: 0 };

export function fatiguePenaltyPercent(breathMax: number): number {
  if (breathMax >= 85) return 0;
  if (breathMax >= 70) return 10;
  if (breathMax >= 50) return 25;
  if (breathMax >= 30) return 50;
  if (breathMax >= 15) return 75;
  if (breathMax > 0) return 90;
  return 100;
}

export function reducePointsForFatigue(breathMax: number, points: number): number {
  return u16(points - idiv(points * fatiguePenaltyPercent(breathMax), 100));
}

export function calculateHealingPointsForDoctor(d: CrewMember, kits: KitItems, makeSureKitIsInHand: boolean): Points {
  if (makeSureKitIsInHand && !makeSureMedKitIsInHand(d.inv, kits)) return NONE;
  const e = d.effective;
  const n = d.stats;
  let points = u16(idiv(e.medical * idiv(e.dexterity + e.wisdom, 2) * (100 + EXP_LEVEL_PERCENT * e.expLevel), DOCTORING_RATE_DIVISOR));
  const max = u16(idiv(n.medical * idiv(n.dexterity + n.wisdom, 2) * (100 + EXP_LEVEL_PERCENT * n.expLevel), DOCTORING_RATE_DIVISOR));
  points = reducePointsForFatigue(d.breathMax, points);
  const kitPoints = u16(KIT_POINTS_PER_HEALING_POINT * totalMedicalKitPoints(d.inv, kits));
  if (kitPoints < points) points = kitPoints;
  return { points, max };
}

export function kitEffectiveness(points: number): number {
  if (points < BAD_KIT_POINTS) return BAD_KIT_EFFECTIVENESS;
  if (points < POOR_KIT_POINTS) return POOR_KIT_EFFECTIVENESS;
  return FULL_KIT_EFFECTIVENESS;
}

export function calculateRepairPointsForRepairman(r: CrewMember, kits: KitItems, makeSureKitIsInHand: boolean): Points {
  if (makeSureKitIsInHand) makeSureToolKitIsInHand(r.inv, kits);
  if (r.inv[Slot.HAND]?.item !== kits.toolKit) return NONE;
  const e = r.effective;
  const n = r.stats;
  const divisor = REPAIR_RATE_DIVISOR * ASSIGNMENT_UNITS_PER_DAY;
  let points = u16(idiv(e.mechanical * e.dexterity * (100 + EXP_LEVEL_PERCENT * e.expLevel), divisor));
  const max = u16(idiv(n.mechanical * n.dexterity * (100 + EXP_LEVEL_PERCENT * n.expLevel), divisor));
  points = reducePointsForFatigue(r.breathMax, points);
  points = u16(idiv(points * kitEffectiveness(toolKitPoints(r.inv, kits)), 100));
  return { points: u8(points), max };
}

function statOf(stats: MercStats, lifeMax: number, stat: number): number {
  switch (stat) {
    case TrainStat.STRENGTH:
      return stats.strength;
    case TrainStat.DEXTERITY:
      return stats.dexterity;
    case TrainStat.AGILITY:
      return stats.agility;
    case TrainStat.HEALTH:
      return lifeMax;
    case TrainStat.MARKSMANSHIP:
      return stats.marksmanship;
    case TrainStat.MEDICAL:
      return stats.medical;
    case TrainStat.MECHANICAL:
      return stats.mechanical;
    case TrainStat.LEADERSHIP:
      return stats.leadership;
    case TrainStat.EXPLOSIVE:
      return stats.explosives;
    default:
      return 0;
  }
}

export function trainingStatValue(s: CrewMember, stat: number): number {
  return statOf(s.stats, s.lifeMax, stat);
}

function effectiveTrainingStatValue(s: CrewMember, stat: number): number {
  return statOf(s.effective, s.lifeMax, stat);
}

export function countTraits(traits: readonly number[], trait: number): number {
  return traits.filter((t) => t === trait).length;
}

function teachingBonus(s: CrewMember): number {
  return TEACH_BONUS_TO_TRAIN * countTraits(s.profileTraits.slice(0, 2), SkillTrait.TEACHING);
}

export function getSoldierTrainingPts(s: CrewMember, stat: number, atGunRange: boolean): Points {
  const skill = trainingStatValue(s, stat);
  if (skill === 0 || skill >= TRAINING_RATING_CAP) return NONE;
  const max = u16(Math.max(idiv(s.stats.wisdom * (TRAINING_RATING_CAP - skill), SELF_TRAINING_DIVISOR), 1));
  let points = u16(Math.max(idiv(s.effective.wisdom * (TRAINING_RATING_CAP - skill), SELF_TRAINING_DIVISOR), 1));
  const bonus = stat === TrainStat.MARKSMANSHIP && atGunRange ? GUN_RANGE_TRAINING_BONUS : 0;
  points = u16(points + idiv(bonus * points, 100));
  points = reducePointsForFatigue(s.breathMax, points);
  return { points: i16(points), max };
}

export function getBonusTrainingPtsDueToInstructor(
  ctx: EconomyContext,
  t: CrewMember,
  student: CrewMember | null,
  stat: number,
  atGunRange: boolean,
): Points {
  const effT = effectiveTrainingStatValue(t, stat);
  const natT = trainingStatValue(t, stat);
  let wisdom = DEFAULT_STUDENT_WISDOM;
  let naturalWisdom = DEFAULT_STUDENT_WISDOM;
  let skill = 0;
  let opinion = 0;
  if (student) {
    wisdom = student.effective.wisdom;
    naturalWisdom = student.stats.wisdom;
    skill = trainingStatValue(student, stat);
    if (skill === 0 || skill >= TRAINING_RATING_CAP) return NONE;
    opinion = i8(i8(ctx.crew.opinion(student.profile, t.profile)) + idiv(ctx.crew.opinion(t.profile, student.profile), 2));
  }
  if (skill >= effT) return NONE;
  let points = u16(idiv((effT - skill) * (wisdom + idiv(t.effective.wisdom + t.effective.leadership, 2)), INSTRUCTED_TRAINING_DIVISOR));
  let max = u16(idiv((natT - skill) * (naturalWisdom + idiv(t.stats.wisdom + t.stats.leadership, 2)), INSTRUCTED_TRAINING_DIVISOR));
  if (max === 0 && effT > skill + MIN_INSTRUCTOR_ADVANTAGE) {
    points = 1;
    max = 1;
  }
  let bonus = teachingBonus(t);
  max = u16(max + idiv((bonus + opinion) * max, 100));
  if (stat === TrainStat.MARKSMANSHIP && atGunRange) bonus += GUN_RANGE_TRAINING_BONUS;
  points = u16(points + idiv((bonus + opinion) * points, 100));
  points = reducePointsForFatigue(t.breathMax, points);
  return { points: i16(points), max };
}

export function getSoldierStudentPts(ctx: EconomyContext, s: CrewMember, stat: number, atGunRange: boolean): Points {
  const own = getSoldierTrainingPts(s, stat, atGunRange);
  if (own.max === 0) return NONE;
  let best = -1;
  let bestMax = 0;
  for (const t of ctx.crew.all()) {
    if (!sameSector(t.sector, s.sector) || t.assignment !== Assignment.TRAIN_TEAMMATE || t.trainStat !== stat || t.asleep) continue;
    const bonus = getBonusTrainingPtsDueToInstructor(ctx, t, s, stat, atGunRange);
    if (bonus.points > best) {
      best = bonus.points;
      bestMax = bonus.max;
    }
  }
  if (best === -1) return own;
  return { points: i16(own.points + best), max: u16(own.max + bestMax) };
}

export function isNpcOrRpc(ctx: EconomyContext, profile: number): boolean {
  const type = ctx.economy.mercTypes.get(profile);
  return type === MercType.NPC || type === MercType.RPC;
}

export function getTownTrainPtsForCharacter(ctx: EconomyContext, t: CrewMember): Points {
  const n = t.stats;
  const e = t.effective;
  let max = u16((n.wisdom + n.leadership + EXP_LEVEL_TOWN_WEIGHT * n.expLevel) * TOWN_TRAINING_RATE);
  let points = u16((e.wisdom + e.leadership + EXP_LEVEL_TOWN_WEIGHT * e.expLevel) * TOWN_TRAINING_RATE);
  let bonus = teachingBonus(t);
  if (isNpcOrRpc(ctx, t.profile)) bonus += RPC_BONUS_TO_TRAIN;
  points = u16(points + idiv(bonus * points, 100));
  max = u16(max + idiv(bonus * max, 100));
  points = reducePointsForFatigue(t.breathMax, points);
  return { points: i16(points), max };
}
