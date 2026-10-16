// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc AreAssignmentConditionsMet, BasicCanCharacterDoctor, CanCharacterDoctor,
// @src CanStatsBeHealed, CanCharacterPatient, BasicCanCharacterTrainMilitia, CanCharacterTrainMilitia,
// @src CountMilitiaTrainersInSoldiersSector, CanCharacterTrainStat, CanCharacterOnDuty, CanCharacterPractise,
// @src CanCharacterTrainTeammates, CanCharacterBeTrainedByOther, CanCharacterSleep, CanCharacterBeAwakened, CanCharacterSquad,
// @src IsCharacterInTransit, EnoughTimeOnAssignment, GetMinHealingSkillNeeded, CanSoldierBeHealedByDoctor,
// @src GetNumberThatCanBeDoctored, AnyDoctorWhoCanHealThisPatient, ValidTrainingPartnerInSameSectorOnAssignmentFound,
// @src PlayerSoldierTooTiredToTravel; MapScreen.cc CanChangeSleepStatusForSoldier. See docs/18 §5.1, §5.2, §5.4, §5.6, §5.8.

import { sameSector, sectorId } from '../../../content/strategic/sector-ids.ts';
import { numEnemiesInAnySector, numEnemiesInSector, playerMercsInSector } from '../forces/groups.ts';
import { soldierAboardAirborneHeli } from '../forces/helicopter.ts';
import { doesVehicleExistInSquad, isThisSquadOnTheMove, numberOfPeopleInSquad, sectorSquadIsIn } from '../forces/squads.ts';
import { inHelicopter } from '../forces/vehicles.ts';
import { sectorIsPassable } from '../map/sectors.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import {
  Assignment,
  BREATHMAX_ABSOLUTE_MINIMUM,
  BREATHMAX_FULLY_RESTED,
  BREATHMAX_GOTTA_STOP_MOVING,
  GUN_RANGE_SECTOR,
  MAX_MILITIA_TRAINERS_PER_SECTOR,
  MINUTES_FOR_ASSIGNMENT_TO_COUNT,
  OKLIFE,
  TRAINING_RATING_CAP,
} from './constants.ts';
import { findObj, hasMedicalKitInPockets, kitItems } from './kits.ts';
import {
  canSectorContainMilitia,
  isAreaFullOfMilitia,
  militiaTrainingAllowedInSector,
  sectorHasSufficientLoyaltyToTrainMilitia,
} from './militia-rules.ts';
import { getBonusTrainingPtsDueToInstructor, trainingStatValue } from './points.ts';
import type { CrewMember, EconomyContext } from './ports.ts';
import { isLoadedSector } from './towns.ts';
import { soldierMustDriveVehicle } from './vehicle-assignment.ts';

export const AC = {
  NONE: 0,
  IMPASSABLE: 1 << 0,
  UNCONSCIOUS: 1 << 1,
  COMBAT: 1 << 2,
  EPC: 1 << 3,
  IN_HELI_IN_HOSTILE_SECTOR: 1 << 4,
  MECHANICAL: 1 << 5,
  MOVING: 1 << 6,
  UNDERGROUND: 1 << 7,
} as const;

const MIN_RATING_TO_TEACH = 25;
const BASE_MEDICAL_SKILL_TO_DEAL_WITH_EMERGENCY = 20;
const MULTIPLIER_FOR_DIFFERENCE_IN_LIFE_VALUE_FOR_EMERGENCY = 4;

export const JoinSquad = {
  ALREADY_IN_IT: -6,
  SQUAD_MOVING: -5,
  MOVING: -4,
  VEHICLE: -3,
  TOO_FAR: -2,
  FULL: -1,
  CANT: 0,
  CAN: 1,
} as const;

export function isMechanical(s: CrewMember): boolean {
  return s.isVehicle || s.isRobot;
}

export function isOnSquad(s: CrewMember): boolean {
  return s.assignment < Assignment.ON_DUTY;
}

export function isCharacterInTransit(s: CrewMember): boolean {
  return s.assignment === Assignment.IN_TRANSIT;
}

function inHelicopterInHostileSector(ctx: EconomyContext, s: CrewMember): boolean {
  return inHelicopter(ctx, s) && numEnemiesInSector(ctx, s.sector) > 0;
}

function inLoadedSectorWithEnemies(ctx: EconomyContext, s: CrewMember): boolean {
  return s.inSector && ctx.world.enemyInSector();
}

export function areAssignmentConditionsMet(ctx: EconomyContext, s: CrewMember, allowed: number): boolean {
  return ((allowed & AC.IMPASSABLE || sectorIsPassable(ctx.state.map, sectorId(s.sector))) &&
    (allowed & AC.UNCONSCIOUS || s.life >= OKLIFE) &&
    (allowed & AC.COMBAT || !inLoadedSectorWithEnemies(ctx, s)) &&
    (allowed & AC.EPC || !s.isEpc) &&
    (allowed & AC.IN_HELI_IN_HOSTILE_SECTOR || !inHelicopterInHostileSector(ctx, s)) &&
    (allowed & AC.MECHANICAL || !isMechanical(s)) &&
    (allowed & AC.MOVING || !s.betweenSectors) &&
    (allowed & AC.UNDERGROUND || s.sector.z === 0) &&
    !isCharacterInTransit(s) &&
    s.assignment !== Assignment.ASSIGNMENT_POW) as boolean;
}

export function enoughTimeOnAssignment(ctx: EconomyContext, s: CrewMember): boolean {
  return worldTotalMinutes(ctx.state.clock) - s.lastAssignmentChangeMin >= MINUTES_FOR_ASSIGNMENT_TO_COUNT;
}

export function canCharacterDoctor(ctx: EconomyContext, s: CrewMember): boolean {
  return s.stats.medical > 0 && areAssignmentConditionsMet(ctx, s, AC.UNDERGROUND) && hasMedicalKitInPockets(s.inv, kitItems(ctx.items));
}

export function canStatsBeHealed(ctx: EconomyContext, s: CrewMember): boolean {
  const d = s.statDamage;
  return ctx.economy.policy.enableStatHealing && (d.agility > 0 || d.dexterity > 0 || d.strength > 0 || d.wisdom > 0);
}

export function canCharacterPatient(ctx: EconomyContext, s: CrewMember): boolean {
  return (
    s.life > 0 &&
    (s.life !== s.lifeMax || canStatsBeHealed(ctx, s)) &&
    areAssignmentConditionsMet(ctx, s, AC.UNCONSCIOUS | AC.EPC | AC.UNDERGROUND)
  );
}

export function basicCanCharacterTrainMilitia(ctx: EconomyContext, s: CrewMember): boolean {
  return (
    s.stats.leadership > 0 &&
    canSectorContainMilitia(ctx, s.sector) &&
    numEnemiesInAnySector(ctx, s.sector) === 0 &&
    areAssignmentConditionsMet(ctx, s, AC.NONE)
  );
}

export function countMilitiaTrainersInSoldiersSector(ctx: EconomyContext, s: CrewMember): number {
  return ctx.crew
    .all()
    .filter((o) => o.id !== s.id && o.life >= OKLIFE && sameSector(o.sector, s.sector) && o.assignment === Assignment.TRAIN_TOWN).length;
}

export function canCharacterTrainMilitia(ctx: EconomyContext, s: CrewMember): boolean {
  return (
    basicCanCharacterTrainMilitia(ctx, s) &&
    militiaTrainingAllowedInSector(ctx, s.sector) &&
    sectorHasSufficientLoyaltyToTrainMilitia(ctx, s.sector) &&
    !isAreaFullOfMilitia(ctx, s.sector) &&
    countMilitiaTrainersInSoldiersSector(ctx, s) < MAX_MILITIA_TRAINERS_PER_SECTOR
  );
}

export function canCharacterTrainStat(
  ctx: EconomyContext,
  s: CrewMember,
  stat: number,
  trainSelf: boolean,
  trainTeammate: boolean,
): boolean {
  if (!areAssignmentConditionsMet(ctx, s, AC.NONE)) return false;
  const value = trainingStatValue(s, stat);
  return value !== 0 && (!trainTeammate || value >= MIN_RATING_TO_TEACH) && (!trainSelf || value < TRAINING_RATING_CAP);
}

export function canCharacterOnDuty(ctx: EconomyContext, s: CrewMember): boolean {
  return areAssignmentConditionsMet(ctx, s, AC.COMBAT | AC.EPC | AC.MECHANICAL | AC.UNDERGROUND);
}

export function canCharacterPractise(ctx: EconomyContext, s: CrewMember): boolean {
  return areAssignmentConditionsMet(ctx, s, AC.NONE);
}

export function canCharacterTrainTeammates(ctx: EconomyContext, s: CrewMember): boolean {
  return canCharacterPractise(ctx, s) && playerMercsInSector(ctx, s.sector) !== 0;
}

export type SleepRefusal = 'conditions' | 'walking' | 'driving' | 'sectorNotCleared' | 'notTired';

export function sleepRefusal(ctx: EconomyContext, s: CrewMember): SleepRefusal | null {
  const allowed = AC.IMPASSABLE | AC.COMBAT | AC.EPC | AC.IN_HELI_IN_HOSTILE_SECTOR | AC.MOVING | AC.UNDERGROUND;
  if (!areAssignmentConditionsMet(ctx, s, allowed)) return 'conditions';
  if (s.betweenSectors) {
    if (s.assignment !== Assignment.VEHICLE) return 'walking';
    if (soldierMustDriveVehicle(ctx, s, false)) return 'driving';
  } else if (!soldierAboardAirborneHeli(ctx, s)) {
    if (s.inSector && (ctx.clock.inCombat() || ctx.world.enemyInSector())) return 'sectorNotCleared';
    if (s.sector.z === 0 && numEnemiesInAnySector(ctx, s.sector) > 0) return 'sectorNotCleared';
  }
  if (s.breathMax >= BREATHMAX_FULLY_RESTED) return 'notTired';
  return null;
}

export function canCharacterSleep(ctx: EconomyContext, s: CrewMember): boolean {
  return sleepRefusal(ctx, s) === null;
}

export function canCharacterBeAwakened(s: CrewMember): boolean {
  if (s.breathMax <= BREATHMAX_ABSOLUTE_MINIMUM && !s.collapsed) s.collapsed = true;
  return !s.collapsed;
}

export function canChangeSleepStatusForSoldier(s: CrewMember): boolean {
  if (isMechanical(s) || isCharacterInTransit(s) || s.assignment === Assignment.ASSIGNMENT_POW) return false;
  return s.life > 0 && s.assignment !== Assignment.ASSIGNMENT_DEAD;
}

export function playerSoldierTooTiredToTravel(ctx: EconomyContext, s: CrewMember): boolean {
  if (!canChangeSleepStatusForSoldier(s)) return false;
  if (s.assignment === Assignment.VEHICLE && !soldierMustDriveVehicle(ctx, s, true)) return false;
  if (s.asleep) return !canCharacterBeAwakened(s);
  return s.breathMax < BREATHMAX_GOTTA_STOP_MOVING;
}

export function canCharacterSquad(ctx: EconomyContext, s: CrewMember, squad: number): number {
  if (s.assignment === squad) return JoinSquad.ALREADY_IN_IT;
  if (s.life < OKLIFE || isCharacterInTransit(s) || s.assignment === Assignment.ASSIGNMENT_POW) return JoinSquad.CANT;
  const at = sectorSquadIsIn(ctx, squad);
  if (at && !sameSector(at, s.sector)) return JoinSquad.TOO_FAR;
  if (isThisSquadOnTheMove(ctx, squad)) return JoinSquad.SQUAD_MOVING;
  if (doesVehicleExistInSquad(ctx, squad)) return JoinSquad.VEHICLE;
  if (numberOfPeopleInSquad(ctx, squad) >= ctx.content.policy.squadSize) return JoinSquad.FULL;
  return JoinSquad.CAN;
}

export function minHealingSkillNeeded(patient: CrewMember): number {
  if (patient.life < OKLIFE)
    return BASE_MEDICAL_SKILL_TO_DEAL_WITH_EMERGENCY + MULTIPLIER_FOR_DIFFERENCE_IN_LIFE_VALUE_FOR_EMERGENCY * (OKLIFE - patient.life);
  return 1;
}

export function canSoldierBeHealedByDoctor(
  ctx: EconomyContext,
  patient: CrewMember,
  doctor: CrewMember,
  thisHour: boolean,
  skipKitCheck: boolean,
  skipSkillCheck: boolean,
): boolean {
  if (patient.assignment !== Assignment.PATIENT && patient.assignment !== Assignment.DOCTOR) return false;
  if (patient.life === 0) return false;
  if (patient.life === patient.lifeMax && !canStatsBeHealed(ctx, patient)) return false;
  if (thisHour && !enoughTimeOnAssignment(ctx, patient)) return false;
  if (!sameSector(patient.sector, doctor.sector)) return false;
  if (patient.betweenSectors) return false;
  if (!skipSkillCheck && doctor.stats.medical < minHealingSkillNeeded(patient)) return false;
  if (!skipKitCheck && findObj(doctor.inv, kitItems(ctx.items).medicKit) === -1) return false;
  return true;
}

export function numberThatCanBeDoctored(
  ctx: EconomyContext,
  doctor: CrewMember,
  thisHour: boolean,
  skipKit: boolean,
  skipSkill: boolean,
): number {
  return ctx.crew.all().filter((p) => canSoldierBeHealedByDoctor(ctx, p, doctor, thisHour, skipKit, skipSkill)).length;
}

export function anyDoctorWhoCanHealThisPatient(ctx: EconomyContext, patient: CrewMember, thisHour: boolean): CrewMember | null {
  return (
    ctx.crew.all().find((d) => d.assignment === Assignment.DOCTOR && canSoldierBeHealedByDoctor(ctx, patient, d, thisHour, false, false)) ??
    null
  );
}

export function atGunRange(s: CrewMember): boolean {
  return sameSector(s.sector, GUN_RANGE_SECTOR);
}

export function validTrainingPartnerInSameSectorOnAssignmentFound(
  ctx: EconomyContext,
  target: CrewMember,
  wanted: number,
  stat: number,
): boolean {
  let gunRange = false;
  for (const o of ctx.crew.all()) {
    if (o.id === target.id || o.assignment !== wanted || !sameSector(o.sector, target.sector) || o.trainStat !== stat || o.life <= 0)
      continue;
    if (atGunRange(o)) gunRange = true;
    const points =
      o.assignment === Assignment.TRAIN_TEAMMATE
        ? getBonusTrainingPtsDueToInstructor(ctx, o, target, stat, gunRange)
        : getBonusTrainingPtsDueToInstructor(ctx, target, o, stat, gunRange);
    if (points.points > 0) return true;
  }
  return false;
}

export function isInLoadedSector(ctx: EconomyContext, s: CrewMember): boolean {
  return isLoadedSector(ctx, s.sector);
}
