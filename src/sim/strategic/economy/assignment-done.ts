// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc ChangeSoldiersAssignment, SetTimeOfAssignmentChangeForMerc, AssignmentDone,
// @src AssignmentAborted, ReEvaluateEveryonesNothingToDo; Town_Militia.cc AddSectorForSoldierToListOfSectorsThatCompletedMilitiaTraining.
// See docs/18 §5.2, §5.10.

import { sameSector } from '../../../content/strategic/sector-ids.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent } from '../time/event-queue.ts';
import { CompressionStop, stopTimeCompression, worldTotalMinutes } from '../time/world-clock.ts';
import {
  anyDoctorWhoCanHealThisPatient,
  canCharacterDoctor,
  canCharacterPatient,
  canCharacterTrainMilitia,
  canCharacterTrainStat,
  numberThatCanBeDoctored,
  validTrainingPartnerInSameSectorOnAssignmentFound,
} from './conditions.ts';
import { Assignment } from './constants.ts';
import type { AbortReason } from './events.ts';
import type { CrewMember, EconomyContext } from './ports.ts';
import { canCharacterRepair, hasCharacterFinishedRepairing } from './repair-rules.ts';

const DONE_QUOTE_ASSIGNMENTS: ReadonlySet<number> = new Set([
  Assignment.DOCTOR,
  Assignment.REPAIR,
  Assignment.PATIENT,
  Assignment.ASSIGNMENT_HOSPITAL,
]);
const BANDAGE_DELAY_MINUTES = 1;

export function changeSoldiersAssignment(ctx: EconomyContext, s: CrewMember, assignment: number): void {
  s.assignment = assignment;
  if (assignment === Assignment.ASSIGNMENT_DEAD) s.life = 0;
  if (assignment !== Assignment.REPAIR) {
    s.fixingRobot = false;
    s.vehicleUnderRepair = -1;
  }
  if (assignment === Assignment.DOCTOR || assignment === Assignment.PATIENT || assignment === Assignment.ASSIGNMENT_HOSPITAL)
    addStrategicEvent(ctx.state.queue, EventKind.BANDAGE_BLEEDING_MERCS, worldTotalMinutes(ctx.state.clock) + BANDAGE_DELAY_MINUTES, 0);
}

export function setTimeOfAssignmentChange(ctx: EconomyContext, s: CrewMember): void {
  s.lastAssignmentChangeMin = worldTotalMinutes(ctx.state.clock);
}

function addSectorThatCompletedMilitiaTraining(ctx: EconomyContext, s: CrewMember): void {
  const list = ctx.state.economy.militiaTrainingCompletedBy;
  const known = list.some((id) => {
    const other = ctx.crew.get(id);
    return other !== undefined && other.sector.x === s.sector.x && other.sector.y === s.sector.y;
  });
  if (!known) list.push(s.id);
}

export function assignmentDone(ctx: EconomyContext, s: CrewMember, sayQuote: boolean, meToo: boolean): void {
  if (sayQuote && !meToo && s.assignment === Assignment.TRAIN_TOWN) addSectorThatCompletedMilitiaTraining(ctx, s);
  if (s.doneQuoteSaid) return;
  s.doneQuoteSaid = true;
  ctx.events.push({ type: 'assignmentDone', soldier: s.id, sayQuote: sayQuote && DONE_QUOTE_ASSIGNMENTS.has(s.assignment) });
}

export function assignmentAborted(ctx: EconomyContext, s: CrewMember, reason: AbortReason): void {
  ctx.events.push({ type: 'assignmentAborted', soldier: s.id, reason });
  stopTimeCompression(ctx.clock, CompressionStop.ASSIGNMENT_DONE);
}

function nothingToDo(ctx: EconomyContext, s: CrewMember): boolean {
  switch (s.assignment) {
    case Assignment.DOCTOR:
      return !canCharacterDoctor(ctx, s) || numberThatCanBeDoctored(ctx, s, false, false, false) === 0;
    case Assignment.PATIENT:
      return !canCharacterPatient(ctx, s) || anyDoctorWhoCanHealThisPatient(ctx, s, false) === null;
    case Assignment.ASSIGNMENT_HOSPITAL:
      return !canCharacterPatient(ctx, s);
    case Assignment.REPAIR:
      return !canCharacterRepair(ctx, s) || hasCharacterFinishedRepairing(ctx, s);
    case Assignment.TRAIN_TOWN:
      return !canCharacterTrainMilitia(ctx, s);
    case Assignment.TRAIN_SELF:
      return !canCharacterTrainStat(ctx, s, s.trainStat, true, false);
    case Assignment.TRAIN_TEAMMATE:
      return (
        !canCharacterTrainStat(ctx, s, s.trainStat, false, true) ||
        !validTrainingPartnerInSameSectorOnAssignmentFound(ctx, s, Assignment.TRAIN_BY_OTHER, s.trainStat)
      );
    case Assignment.TRAIN_BY_OTHER:
      return (
        !canCharacterTrainStat(ctx, s, s.trainStat, true, false) ||
        !validTrainingPartnerInSameSectorOnAssignmentFound(ctx, s, Assignment.TRAIN_TEAMMATE, s.trainStat)
      );
    default:
      return false;
  }
}

export function reEvaluateEveryonesNothingToDo(ctx: EconomyContext): void {
  for (const s of ctx.crew.all()) {
    const idle = nothingToDo(ctx, s);
    s.nothingToDo = idle;
    if (!idle) s.doneQuoteSaid = false;
  }
}

export function trainersInSector(ctx: EconomyContext, s: CrewMember): CrewMember[] {
  return ctx.crew.all().filter((m) => m.assignment === Assignment.TRAIN_TOWN && sameSector(m.sector, s.sector));
}
