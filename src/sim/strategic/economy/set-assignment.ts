// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc PreChangeAssignment, PreSetAssignment, PostSetAssignment, SetSoldierAssignmentHospital,
// @src SetSoldierAssignmentPatient, SetSoldierAssignmentDoctor, SetSoldierAssignmentTrainTown, SetSoldierAssignmentTrainSelf,
// @src SetSoldierAssignmentTrainTeammate, SetSoldierAssignmentTrainByOther, SetSoldierAssignmentRepair, SetAssignmentForList,
// @src AssignMercToAMovementGroup, the TRAIN_MENU_TOWN branch of TrainingMenuBtnCallback, PutMercInAwakeState;
// @src Tactical/Squads.cc AddCharacterToSquad (soldier side). See docs/18 §1.3, §5.2, §6.

import { addCharacterToAnySquad, addCharacterToSquad, assignMercToAMovementGroup, removeCharacterFromSquads } from '../forces/squads.ts';
import { takeSoldierOutOfVehicle } from '../forces/vehicles.ts';
import { sectorInfo } from '../map/sectors.ts';
import { changeSoldiersAssignment, reEvaluateEveryonesNothingToDo, setTimeOfAssignmentChange } from './assignment-done.ts';
import {
  basicCanCharacterTrainMilitia,
  canCharacterDoctor,
  canCharacterPatient,
  canCharacterSquad,
  canCharacterTrainMilitia,
  canCharacterTrainStat,
  countMilitiaTrainersInSoldiersSector,
  JoinSquad,
  sleepRefusal,
} from './conditions.ts';
import { Assignment, MAX_MILITIA_TRAINERS_PER_SECTOR, Town } from './constants.ts';
import { kitItems, makeSureMedKitIsInHand, makeSureToolKitIsInHand } from './kits.ts';
import { answerMilitiaPayment, type MilitiaPaymentOutcome, startMilitiaPaymentFlow } from './militia.ts';
import { isAreaFullOfMilitia, militiaTrainingAllowedInSector, sectorHasSufficientLoyaltyToTrainMilitia } from './militia-rules.ts';
import type { CrewMember, EconomyContext } from './ports.ts';
import { canCharacterRepair, canCharacterRepairRobot, canCharacterRepairVehicle } from './repair-rules.ts';
import { putMercInAwakeState, setMercAsleep, setMercAwake } from './rest.ts';
import type { MilitiaPaymentPrompt } from './state.ts';
import { townOf } from './towns.ts';

export type AssignTarget =
  | { readonly kind: 'squad'; readonly squad?: number }
  | { readonly kind: 'doctor' }
  | { readonly kind: 'patient' }
  | { readonly kind: 'repair'; readonly robot?: boolean; readonly vehicle?: number }
  | { readonly kind: 'trainSelf' | 'trainTeammate' | 'trainByOther'; readonly stat: number }
  | { readonly kind: 'trainMilitia' };

export type AssignRefusal =
  | 'unknownSoldier'
  | 'notEligible'
  | 'noMilitiaHere'
  | 'loyaltyTooLow'
  | 'militiaFull'
  | 'tooManyTrainers'
  | 'squadFull'
  | 'squadElsewhere'
  | 'squadMoving'
  | 'squadHasVehicle';

export type AssignResult =
  | { readonly ok: true; readonly militia?: MilitiaPaymentOutcome }
  | { readonly ok: false; readonly reason: AssignRefusal };

function preChangeAssignment(ctx: EconomyContext, s: CrewMember): void {
  if (s.assignment === Assignment.VEHICLE) takeSoldierOutOfVehicle(ctx, s.id);
  removeCharacterFromSquads(ctx, s.id);
}

function postSetAssignment(ctx: EconomyContext, s: CrewMember, assignment: number): void {
  changeSoldiersAssignment(ctx, s, assignment);
  assignMercToAMovementGroup(ctx, s.id);
}

function stampIfChanged(ctx: EconomyContext, s: CrewMember, assignment: number): void {
  if (s.assignment !== assignment) setTimeOfAssignmentChange(ctx, s);
}

export function applySquadAssignment(ctx: EconomyContext, s: CrewMember, squad: number): void {
  if (s.assignment !== squad) {
    if (s.asleep) setMercAwake(s, false);
    setTimeOfAssignmentChange(ctx, s);
  }
  changeSoldiersAssignment(ctx, s, squad);
}

export function setSoldierAssignmentDoctor(ctx: EconomyContext, s: CrewMember): boolean {
  if (!canCharacterDoctor(ctx, s)) return false;
  preChangeAssignment(ctx, s);
  stampIfChanged(ctx, s, Assignment.DOCTOR);
  makeSureMedKitIsInHand(s.inv, kitItems(ctx.items));
  postSetAssignment(ctx, s, Assignment.DOCTOR);
  return true;
}

export function setSoldierAssignmentHospital(ctx: EconomyContext, s: CrewMember): boolean {
  if (!canCharacterPatient(ctx, s)) return false;
  preChangeAssignment(ctx, s);
  s.bleeding = 0;
  stampIfChanged(ctx, s, Assignment.ASSIGNMENT_HOSPITAL);
  postSetAssignment(ctx, s, Assignment.ASSIGNMENT_HOSPITAL);
  return true;
}

export function setSoldierAssignmentPatient(ctx: EconomyContext, s: CrewMember): boolean {
  if (!canCharacterPatient(ctx, s)) return false;
  preChangeAssignment(ctx, s);
  stampIfChanged(ctx, s, Assignment.PATIENT);
  postSetAssignment(ctx, s, Assignment.PATIENT);
  return true;
}

function setSoldierAssignmentTraining(ctx: EconomyContext, s: CrewMember, assignment: number, stat: number): boolean {
  const self = assignment !== Assignment.TRAIN_TEAMMATE;
  if (!canCharacterTrainStat(ctx, s, stat, self, !self)) return false;
  preChangeAssignment(ctx, s);
  stampIfChanged(ctx, s, assignment);
  s.trainStat = stat;
  postSetAssignment(ctx, s, assignment);
  return true;
}

export function setSoldierAssignmentRepair(ctx: EconomyContext, s: CrewMember, robot: boolean, vehicle: number): boolean {
  if (!canCharacterRepair(ctx, s)) return false;
  preChangeAssignment(ctx, s);
  if (s.assignment !== Assignment.REPAIR || s.fixingRobot !== robot || s.vehicleUnderRepair !== vehicle) setTimeOfAssignmentChange(ctx, s);
  makeSureToolKitIsInHand(s.inv, kitItems(ctx.items));
  s.fixingRobot = robot;
  s.vehicleUnderRepair = vehicle;
  postSetAssignment(ctx, s, Assignment.REPAIR);
  return true;
}

function setSoldierAssignmentTrainTown(ctx: EconomyContext, s: CrewMember): boolean {
  if (!canCharacterTrainMilitia(ctx, s)) return false;
  preChangeAssignment(ctx, s);
  stampIfChanged(ctx, s, Assignment.TRAIN_TOWN);
  postSetAssignment(ctx, s, Assignment.TRAIN_TOWN);
  return true;
}

function militiaRefusal(ctx: EconomyContext, s: CrewMember): AssignRefusal | null {
  if (!basicCanCharacterTrainMilitia(ctx, s)) return 'noMilitiaHere';
  if (townOf(ctx, s.sector) !== Town.BLANK) {
    if (!militiaTrainingAllowedInSector(ctx, s.sector)) return 'noMilitiaHere';
    if (!sectorHasSufficientLoyaltyToTrainMilitia(ctx, s.sector)) return 'loyaltyTooLow';
  }
  if (isAreaFullOfMilitia(ctx, s.sector)) return 'militiaFull';
  if (countMilitiaTrainersInSoldiersSector(ctx, s) >= MAX_MILITIA_TRAINERS_PER_SECTOR) return 'tooManyTrainers';
  return null;
}

function setForListMember(ctx: EconomyContext, s: CrewMember, leader: CrewMember, to: AssignTarget): boolean {
  switch (to.kind) {
    case 'doctor':
      return setSoldierAssignmentDoctor(ctx, s);
    case 'patient':
      return setSoldierAssignmentPatient(ctx, s);
    case 'repair': {
      if (!canCharacterRepair(ctx, s)) return false;
      const specific =
        leader.vehicleUnderRepair !== -1
          ? canCharacterRepairVehicle(ctx, s, leader.vehicleUnderRepair)
          : s.fixingRobot
            ? canCharacterRepairRobot(ctx, s)
            : true;
      return specific && setSoldierAssignmentRepair(ctx, s, leader.fixingRobot, leader.vehicleUnderRepair);
    }
    case 'trainSelf':
      return setSoldierAssignmentTraining(ctx, s, Assignment.TRAIN_SELF, to.stat);
    case 'trainTeammate':
      return setSoldierAssignmentTraining(ctx, s, Assignment.TRAIN_TEAMMATE, to.stat);
    case 'trainByOther':
      return setSoldierAssignmentTraining(ctx, s, Assignment.TRAIN_BY_OTHER, to.stat);
    case 'trainMilitia':
      return setSoldierAssignmentTrainTown(ctx, s);
    case 'squad':
      return joinSquad(ctx, s, to.squad) === null;
  }
}

function squadRefusal(code: number): AssignRefusal | null {
  switch (code) {
    case JoinSquad.CAN:
    case JoinSquad.ALREADY_IN_IT:
      return null;
    case JoinSquad.FULL:
      return 'squadFull';
    case JoinSquad.TOO_FAR:
      return 'squadElsewhere';
    case JoinSquad.SQUAD_MOVING:
      return 'squadMoving';
    case JoinSquad.VEHICLE:
      return 'squadHasVehicle';
    default:
      return 'notEligible';
  }
}

function joinSquad(ctx: EconomyContext, s: CrewMember, squad: number | undefined): AssignRefusal | null {
  if (squad === undefined) {
    if (s.assignment === Assignment.VEHICLE) takeSoldierOutOfVehicle(ctx, s.id);
    addCharacterToAnySquad(ctx, s.id);
    return null;
  }
  const code = canCharacterSquad(ctx, s, squad);
  const refusal = squadRefusal(code);
  if (refusal || code === JoinSquad.ALREADY_IN_IT) return refusal;
  preChangeAssignment(ctx, s);
  addCharacterToSquad(ctx, s.id, squad);
  return null;
}

function setForListPromptingOnce(
  ctx: EconomyContext,
  leader: CrewMember,
  others: readonly CrewMember[],
  setForList: () => void,
): MilitiaPaymentOutcome | null {
  const to: AssignTarget = { kind: 'trainMilitia' };
  let firstUnpaid: CrewMember | null = null;
  for (const o of others) {
    if (!setForListMember(ctx, o, leader, to)) continue;
    if (!firstUnpaid && !sectorInfo(ctx.state.map, o.sector).militiaTrainingPaid) firstUnpaid = o;
  }
  return firstUnpaid ? startMilitiaPaymentFlow(ctx, firstUnpaid, others, { leader: leader.id, setAssignmentForList: setForList }) : null;
}

function assignLeader(ctx: EconomyContext, s: CrewMember, others: readonly CrewMember[], to: AssignTarget): AssignResult {
  if (to.kind === 'trainMilitia') {
    const refusal = militiaRefusal(ctx, s);
    if (refusal) return { ok: false, reason: refusal };
    preChangeAssignment(ctx, s);
    stampIfChanged(ctx, s, Assignment.TRAIN_TOWN);
    changeSoldiersAssignment(ctx, s, Assignment.TRAIN_TOWN);
    assignMercToAMovementGroup(ctx, s.id);
    const setForList = () => {
      for (const o of others) setForListMember(ctx, o, s, to);
    };
    if (sectorInfo(ctx.state.map, s.sector).militiaTrainingPaid) {
      const nested = setForListPromptingOnce(ctx, s, others, setForList);
      return { ok: true, militia: nested ?? 'alreadyPaid' };
    }
    return { ok: true, militia: startMilitiaPaymentFlow(ctx, s, others, { leader: s.id, setAssignmentForList: setForList }) };
  }
  if (to.kind === 'repair') {
    const ok = setSoldierAssignmentRepair(ctx, s, to.robot === true, to.vehicle ?? -1);
    return ok ? { ok: true } : { ok: false, reason: 'notEligible' };
  }
  if (to.kind === 'squad') {
    const refusal = joinSquad(ctx, s, to.squad);
    return refusal ? { ok: false, reason: refusal } : { ok: true };
  }
  return setForListMember(ctx, s, s, to) ? { ok: true } : { ok: false, reason: 'notEligible' };
}

export function assignSoldiers(ctx: EconomyContext, ids: readonly number[], to: AssignTarget): AssignResult[] {
  const soldiers = ids.map((id) => ctx.crew.get(id));
  const [leader, ...rest] = soldiers;
  const results: AssignResult[] = [];
  if (!leader) results.push({ ok: false, reason: 'unknownSoldier' });
  else {
    const others = rest.filter((m): m is CrewMember => m !== undefined && !m.isVehicle);
    results.push(assignLeader(ctx, leader, others, to));
    if (to.kind !== 'trainMilitia' || !results[0]?.ok) {
      for (const o of rest) {
        if (!o) results.push({ ok: false, reason: 'unknownSoldier' });
        else if (o.isVehicle) results.push({ ok: false, reason: 'notEligible' });
        else results.push(setForListMember(ctx, o, leader, to) ? { ok: true } : { ok: false, reason: 'notEligible' });
      }
    } else
      for (const o of rest) results.push(o && o.assignment === Assignment.TRAIN_TOWN ? { ok: true } : { ok: false, reason: 'notEligible' });
  }
  reEvaluateEveryonesNothingToDo(ctx);
  return results;
}

export type SleepResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export function sleepSoldier(ctx: EconomyContext, id: number): SleepResult {
  const s = ctx.crew.get(id);
  if (!s) return { ok: false, reason: 'unknownSoldier' };
  const refusal = sleepRefusal(ctx, s);
  if (refusal) return { ok: false, reason: refusal };
  setMercAsleep(ctx, s);
  return { ok: true };
}

export function wakeSoldier(ctx: EconomyContext, id: number): SleepResult {
  const s = ctx.crew.get(id);
  if (!s) return { ok: false, reason: 'unknownSoldier' };
  if (!setMercAwake(s, false)) return { ok: false, reason: 'collapsed' };
  return { ok: true };
}

export function forceAwake(s: CrewMember): void {
  putMercInAwakeState(s);
}

export function resumeMilitiaPayment(ctx: EconomyContext, prompt: MilitiaPaymentPrompt, yes: boolean): MilitiaPaymentOutcome {
  const leader = ctx.crew.get(prompt.leader);
  const others = prompt.soldiers.flatMap((id) => ctx.crew.get(id) ?? []);
  const to: AssignTarget = { kind: 'trainMilitia' };
  const setAssignmentForList = () => {
    if (leader) for (const o of others) setForListMember(ctx, o, leader, to);
  };
  return answerMilitiaPayment(ctx, prompt, yes, { leader: prompt.leader, setAssignmentForList });
}
