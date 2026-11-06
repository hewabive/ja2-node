// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-06. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/Medical.cc FindAutobandageClimbPoint, FullPatientCheck, CanAutoBandage,
// @src CanCharacterAutoBandageTeammate, CanCharacterBeAutoBandagedByTeammate, FindBestPatient, DecideAutoBandage.

import { ItemClass } from '../../../content/items/items.ts';
import { cardinalSpacesAway, DIRECTION_COUNT, DIRECTION_INCREMENT } from '../../../content/world/grid.ts';
import { type ItemObject, swapObjects } from '../../items/object.ts';
import { isVehicleBody } from '../../vehicles/vehicle-list.ts';
import { anim } from '../anim-states.ts';
import { AnimHeight, endHeight } from '../animation.ts';
import { climbingNecessary, findBuilding } from '../buildings.ts';
import { findAdjacentGridEx } from '../combat/melee-reach.ts';
import { findObjClass } from '../combat/reload.ts';
import { InvSlot, NO_SLOT } from '../inventory.ts';
import { findBestPath, MoveMode, NOWHERE, PathCopy, PathFlags } from '../pathfinding.ts';
import { inSector, inVehicle, NOBODY, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { AiAction } from './actions.ts';
import { estimatePathCostToLocation, plotPathCost } from './utils.ts';

const GROUND = 0;
const ROOF = 1;
const PRIORITY_DYING = 3;
const PRIORITY_BADLY_WOUNDED = 2;
const PRIORITY_WOUNDED = 1;
const NO_PRIORITY = 0;
const NO_PATH_YET = 1000;
const STANDING_BESIDE_COST = 1;
const NO_PATH = 0;
const BESIDE = 1;

function ourTeam(t: TacticalState): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => s?.team === Team.OUR);
}

function aboardOrVehicle(s: Soldier): boolean {
  return isVehicleBody(s.bodyType) || inVehicle(s);
}

function carriesMedKit(t: TacticalState, s: Soldier): boolean {
  return findObjClass(t.content.items, s, ItemClass.MEDKIT) !== NO_SLOT;
}

export function canCharacterAutoBandageTeammate(t: TacticalState, s: Soldier): boolean {
  if (!inSector(s) || aboardOrVehicle(s)) return false;
  return s.life >= OKLIFE && !s.collapsed && s.stats.medical > 0 && carriesMedKit(t, s);
}

export function canCharacterBeAutoBandagedByTeammate(s: Soldier): boolean {
  if (!inSector(s) || aboardOrVehicle(s)) return false;
  return s.life > 0 && s.bleeding > 0;
}

function medicOrNobody(t: TacticalState, s: Soldier | null): boolean {
  return s === null || canCharacterAutoBandageTeammate(t, s);
}

export function findAutobandageClimbPoint(t: TacticalState, g: number): boolean {
  const building = findBuilding(t, g);
  if (!building) return false;
  for (let k = 0; k < building.upClimbSpots.length; k++) {
    if (!medicOrNobody(t, whoIsThere(t, building.upClimbSpots[k] ?? NOWHERE, ROOF))) continue;
    if (!medicOrNobody(t, whoIsThere(t, building.downClimbSpots[k] ?? NOWHERE, GROUND))) continue;
    return true;
  }
  return false;
}

function walksTo(t: TacticalState, medic: Soldier, g: number): boolean {
  const route = findBestPath(t.pathEnv, medic, g, GROUND, { mode: MoveMode.WALKING, copy: PathCopy.NONE, flags: PathFlags.THROUGH_PEOPLE });
  return route.length !== 0;
}

export function fullPatientCheck(t: TacticalState, patient: Soldier): boolean {
  if (canCharacterAutoBandageTeammate(t, patient)) return true;
  if (patient.level !== GROUND) return findAutobandageClimbPoint(t, patient.gridNo);
  for (const medic of ourTeam(t)) {
    if (!canCharacterAutoBandageTeammate(t, medic)) continue;
    if (medic.level !== GROUND || walksTo(t, medic, patient.gridNo)) return true;
  }
  return false;
}

function passesFullCheckInTurn(t: TacticalState, patient: Soldier): boolean {
  const state = t.autoBandage;
  if (state.fullCheckSoldier === NOBODY) {
    state.fullCheckSoldier = patient.id;
    return true;
  }
  if (state.fullCheckSoldier !== patient.id) return true;
  if (!fullPatientCheck(t, patient)) return false;
  state.fullCheckSoldier = NOBODY;
  return true;
}

export function canAutoBandage(t: TacticalState, fullCheck: boolean): boolean {
  const team = ourTeam(t);
  if (!team.some((s) => canCharacterAutoBandageTeammate(t, s))) return false;
  let patients = 0;
  for (const s of team) {
    if (!canCharacterBeAutoBandagedByTeammate(s)) continue;
    patients++;
    if (fullCheck && !passesFullCheckInTurn(t, s)) {
      t.autoBandage.failed = true;
      return false;
    }
  }
  return patients > 0;
}

interface PatientSearch {
  bestPriority: number;
  shortestPath: number;
  best: Soldier | null;
  bestPatientGridNo: number;
  bestAdjacentGridNo: number;
  bestClimbGridNo: number;
  shortestClimbPath: number;
}

interface PatientReach {
  readonly patientGridNo: number;
  readonly adjacentGridNo: number;
}

function newSearch(): PatientSearch {
  return {
    bestPriority: NO_PRIORITY,
    shortestPath: NO_PATH_YET,
    best: null,
    bestPatientGridNo: NOWHERE,
    bestAdjacentGridNo: NOWHERE,
    bestClimbGridNo: NOWHERE,
    shortestClimbPath: NO_PATH_YET,
  };
}

function awaitsAid(p: Soldier): boolean {
  return inSector(p) && p.life > 0 && p.bleeding !== 0 && p.serviceCount === 0;
}

function patientPriority(p: Soldier): number {
  if (p.life < OKLIFE) return PRIORITY_DYING;
  return p.life < OKLIFE * 2 ? PRIORITY_BADLY_WOUNDED : PRIORITY_WOUNDED;
}

function besidePatientAt(t: TacticalState, medic: Soldier, patientGridNo: number): PatientReach | null {
  const approach = findAdjacentGridEx(t, medic, patientGridNo, false);
  return approach ? { patientGridNo, adjacentGridNo: approach.actionGridNo } : null;
}

function besidePatient(t: TacticalState, medic: Soldier, patient: Soldier): PatientReach | null {
  const reach = besidePatientAt(t, medic, patient.gridNo);
  if (reach || endHeight(t.content, patient.state) !== AnimHeight.PRONE) return reach;
  for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
    const bodyTile = patient.gridNo + (DIRECTION_INCREMENT[dir] ?? 0);
    if (whoIsThere(t, bodyTile, patient.level) !== patient) continue;
    const besideBody = besidePatientAt(t, medic, bodyTile);
    if (besideBody) return besideBody;
  }
  return null;
}

function costToReach(t: TacticalState, medic: Soldier, adjacentGridNo: number): number {
  if (adjacentGridNo === medic.gridNo) return STANDING_BESIDE_COST;
  return plotPathCost(t, medic, adjacentGridNo, anim(t.content, 'RUNNING'));
}

function soldierOrNull(t: TacticalState, id: number): Soldier | null {
  return id === NOBODY ? null : (t.soldiers[id] ?? null);
}

function assignedMedicIsAsClose(t: TacticalState, medic: Soldier, patient: Soldier, patientGridNo: number, cost: number): boolean {
  const other = soldierOrNull(t, patient.autoBandagingMedic);
  if (!other || other === medic) return false;
  const approach = findAdjacentGridEx(t, other, patientGridNo, false);
  return approach !== null && cost >= costToReach(t, other, approach.actionGridNo);
}

function considerPatient(t: TacticalState, medic: Soldier, patient: Soldier, priority: number, search: PatientSearch): void {
  const reach = besidePatient(t, medic, patient);
  if (!reach) return;
  const cost = costToReach(t, medic, reach.adjacentGridNo);
  if (cost === NO_PATH) return;
  if (assignedMedicIsAsClose(t, medic, patient, reach.patientGridNo, cost)) return;
  if (priority === search.bestPriority && cost > search.shortestPath) return;
  search.shortestPath = cost;
  search.best = patient;
  search.bestPatientGridNo = reach.patientGridNo;
  search.bestPriority = priority;
  search.bestAdjacentGridNo = reach.adjacentGridNo;
}

function considerClimbTo(t: TacticalState, medic: Soldier, patient: Soldier, search: PatientSearch): void {
  const estimate = estimatePathCostToLocation(t, medic, patient.gridNo, patient.level, false);
  if (estimate.cost === NO_PATH || !estimate.climb || estimate.cost >= search.shortestClimbPath) return;
  search.bestClimbGridNo = estimate.climbGridNo;
  search.shortestClimbPath = estimate.cost;
}

function searchThroughPeople(t: TacticalState, medic: Soldier): PatientSearch {
  const search = newSearch();
  t.pathEnv.globalFlags = PathFlags.THROUGH_PEOPLE;
  for (const patient of ourTeam(t)) {
    if (!awaitsAid(patient)) continue;
    const priority = patientPriority(patient);
    if (priority < search.bestPriority) continue;
    if (climbingNecessary(t, medic, patient.gridNo, patient.level)) considerClimbTo(t, medic, patient, search);
    else considerPatient(t, medic, patient, priority, search);
  }
  t.pathEnv.globalFlags = 0;
  return search;
}

function takePatient(t: TacticalState, medic: Soldier, patient: Soldier, search: PatientSearch): number {
  const previous = soldierOrNull(t, patient.autoBandagingMedic);
  if (previous) t.turnHooks.cancelAIAction(t, previous);
  patient.autoBandagingMedic = medic.id;
  if (cardinalSpacesAway(medic.gridNo, search.bestPatientGridNo) === BESIDE) {
    medic.ai.actionData = search.bestPatientGridNo;
    return AiAction.GIVE_AID;
  }
  medic.ai.actionData = search.bestAdjacentGridNo;
  return AiAction.GET_CLOSER;
}

export function findBestPatient(t: TacticalState, medic: Soldier): number {
  const search = searchThroughPeople(t, medic);
  if (search.best) return takePatient(t, medic, search.best, search);
  if (search.bestClimbGridNo === NOWHERE) return AiAction.NONE;
  medic.ai.actionData = search.bestClimbGridNo;
  return AiAction.MOVE_TO_CLIMB;
}

function takeKitInHand(s: Soldier, slot: number): void {
  if (slot === InvSlot.HAND) return;
  s.slotItemTakenFrom = slot;
  swapObjects(s.inv[InvSlot.HAND] as ItemObject, s.inv[slot] as ItemObject);
}

export function decideAutoBandage(t: TacticalState, s: Soldier): number {
  if (s.stats.medical === 0 || s.servicePartner !== NOBODY) return AiAction.NONE;
  const kit = findObjClass(t.content.items, s, ItemClass.MEDKIT);
  if (kit === NO_SLOT) return AiAction.NONE;
  if (s.bleeding !== 0) {
    s.ai.actionData = s.gridNo;
    takeKitInHand(s, kit);
    return AiAction.GIVE_AID;
  }
  s.ai.action = findBestPatient(t, s);
  if (s.ai.action === AiAction.NONE) return AiAction.NONE;
  s.uiMovementMode = anim(t.content, 'RUNNING');
  takeKitInHand(s, kit);
  return s.ai.action;
}
