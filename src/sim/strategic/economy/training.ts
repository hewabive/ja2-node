// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc HandleTrainingInSector, TownTrainerQsortCompare, TrainSoldierWithPts,
// @src ReportTrainersTraineesWithoutPartners. See docs/18 §1.4, §5.8.

import { type Sector, sameSector } from '../../../content/strategic/sector-ids.ts';
import { assignmentDone } from './assignment-done.ts';
import { enoughTimeOnAssignment, validTrainingPartnerInSameSectorOnAssignmentFound } from './conditions.ts';
import { Assignment, GUN_RANGE_SECTOR, NUM_TRAINABLE_STATS, StatAmt, StatCause, TrainStat } from './constants.ts';
import { trainTownInSector } from './militia.ts';
import { canSectorContainMilitia } from './militia-rules.ts';
import { getBonusTrainingPtsDueToInstructor, getSoldierTrainingPts, getTownTrainPtsForCharacter } from './points.ts';
import type { CrewMember, EconomyContext } from './ports.ts';
import { sectorOursAndPeaceful } from './towns.ts';

const TRAIN_STAT_AMT: Readonly<Record<number, number>> = {
  [TrainStat.STRENGTH]: StatAmt.STRENGTH,
  [TrainStat.DEXTERITY]: StatAmt.DEXTERITY,
  [TrainStat.AGILITY]: StatAmt.AGILITY,
  [TrainStat.HEALTH]: StatAmt.HEALTH,
  [TrainStat.LEADERSHIP]: StatAmt.LEADERSHIP,
  [TrainStat.MARKSMANSHIP]: StatAmt.MARKSMANSHIP,
  [TrainStat.EXPLOSIVE]: StatAmt.EXPLOSIVES,
  [TrainStat.MEDICAL]: StatAmt.MEDICAL,
  [TrainStat.MECHANICAL]: StatAmt.MECHANICAL,
};

export function trainSoldierWithPts(ctx: EconomyContext, s: CrewMember, points: number): void {
  if (points <= 0) return;
  const stat = TRAIN_STAT_AMT[s.trainStat];
  if (stat === undefined) return;
  ctx.crew.statChange(s.id, stat, points, StatCause.TRAINING);
}

function isActiveThisHour(ctx: EconomyContext, s: CrewMember, sleptPastHour: ReadonlySet<number>): boolean {
  return enoughTimeOnAssignment(ctx, s) && !sleptPastHour.has(s.id);
}

export function bestInstructors(
  ctx: EconomyContext,
  sector: Sector,
  gunRange: boolean,
  sleptPastHour: ReadonlySet<number>,
): (CrewMember | null)[] {
  const best: (CrewMember | null)[] = new Array<CrewMember | null>(NUM_TRAINABLE_STATS).fill(null);
  for (let stat = 0; stat < NUM_TRAINABLE_STATS; stat++) {
    let bestPoints = -1;
    for (const t of ctx.crew.all()) {
      if (!sameSector(t.sector, sector) || t.assignment !== Assignment.TRAIN_TEAMMATE || t.trainStat !== stat) continue;
      if (!isActiveThisHour(ctx, t, sleptPastHour)) continue;
      const points = getBonusTrainingPtsDueToInstructor(ctx, t, null, stat, gunRange).points;
      if (points > bestPoints) {
        best[stat] = t;
        bestPoints = points;
      }
    }
  }
  return best;
}

function trainStudents(ctx: EconomyContext, sector: Sector, gunRange: boolean, sleptPastHour: ReadonlySet<number>): void {
  const instructors = bestInstructors(ctx, sector, gunRange, sleptPastHour);
  for (const s of ctx.crew.all()) {
    if (!sameSector(s.sector, sector)) continue;
    if (s.assignment !== Assignment.TRAIN_SELF && s.assignment !== Assignment.TRAIN_BY_OTHER) continue;
    if (!isActiveThisHour(ctx, s, sleptPastHour) || s.nothingToDo) continue;
    let points = getSoldierTrainingPts(s, s.trainStat, gunRange).points;
    const instructor = s.assignment === Assignment.TRAIN_BY_OTHER ? instructors[s.trainStat] : null;
    if (instructor) points += getBonusTrainingPtsDueToInstructor(ctx, instructor, s, s.trainStat, gunRange).points;
    trainSoldierWithPts(ctx, s, points);
  }
}

interface TownTrainer {
  readonly soldier: CrewMember;
  readonly points: number;
}

export function sortTownTrainers(trainers: readonly TownTrainer[]): TownTrainer[] {
  return [...trainers].sort((a, b) => b.points - a.points);
}

function trainMilitia(ctx: EconomyContext, sector: Sector, sleptPastHour: ReadonlySet<number>): void {
  const trainers: TownTrainer[] = [];
  for (const t of ctx.crew.all()) {
    if (!sameSector(t.sector, sector) || t.assignment !== Assignment.TRAIN_TOWN || !isActiveThisHour(ctx, t, sleptPastHour)) continue;
    const points = getTownTrainPtsForCharacter(ctx, t).points;
    if (points > 0) trainers.push({ soldier: t, points });
  }
  for (const t of sortTownTrainers(trainers)) if (t.points > 0 && trainTownInSector(ctx, t.soldier, sector, t.points)) break;
}

export function handleTrainingInSector(ctx: EconomyContext, sector: Sector, sleptPastHour: ReadonlySet<number>): void {
  if (sector.z !== 0 || !sectorOursAndPeaceful(ctx, sector)) return;
  const gunRange = sameSector(sector, GUN_RANGE_SECTOR);
  trainStudents(ctx, sector, gunRange, sleptPastHour);
  if (canSectorContainMilitia(ctx, sector)) trainMilitia(ctx, sector, sleptPastHour);
}

export function reportTrainersTraineesWithoutPartners(ctx: EconomyContext): void {
  for (const s of ctx.crew.all())
    if (
      s.assignment === Assignment.TRAIN_TEAMMATE &&
      s.life > 0 &&
      !validTrainingPartnerInSameSectorOnAssignmentFound(ctx, s, Assignment.TRAIN_BY_OTHER, s.trainStat)
    )
      assignmentDone(ctx, s, true, true);
  for (const s of ctx.crew.all())
    if (
      s.assignment === Assignment.TRAIN_BY_OTHER &&
      s.life > 0 &&
      !validTrainingPartnerInSameSectorOnAssignmentFound(ctx, s, Assignment.TRAIN_TEAMMATE, s.trainStat)
    )
      assignmentDone(ctx, s, true, true);
}
