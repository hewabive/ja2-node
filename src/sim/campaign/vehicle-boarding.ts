// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Vehicles.cc PutSoldierInVehicle, AddSoldierToVehicle (ChangeSoldierTeam, SelectSoldier and
// @src SetCurrentSquad on the game screen, the enter sound at the vehicle), ExitVehicle (its tactical part, the
// @src selections and the enter sound), OKUseVehicle; Strategic/Assignments.cc SetSoldierAssignmentRepair from
// @src Soldier_Control.cc EVENT_SoldierBeginRepair (2026-11-05).

import { setSoldierAssignmentRepair } from '../strategic/economy/set-assignment.ts';
import { addSoldierToVehicle, Boarding } from '../strategic/economy/vehicle-assignment.ts';
import { okUseVehicleType } from '../strategic/forces/helicopter.ts';
import type { LoadedSectorVehicles } from '../strategic/forces/ports.ts';
import { exitVehicle } from '../strategic/forces/vehicles.ts';
import type { Refusal } from '../tactical/refusal.ts';
import { SelectFlags, selectSoldier, setCurrentSquad } from '../tactical/selection.ts';
import { NOWHERE, type Soldier } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { placeOutOfVehicle, vehicleExitSpot } from '../tactical/vehicle-boarding.ts';
import type { VehicleBoarding } from '../tactical/vehicle-soldiers.ts';
import { NO_VEHICLE_SOLDIER, validVehicle, vehicleTypeOfBody } from '../vehicles/vehicle-list.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { registeredInTactical } from './roster.ts';

const BOARDING_REFUSALS: Readonly<Record<Exclude<Boarding, typeof Boarding.BOARDED>, Refusal>> = {
  vehicleFull: { token: 'vehicleFull', reason: 'no free seat' },
  noVehicleSlot: { token: 'noVehicleSlot', reason: 'two vehicles of ours already take soldier ids 18 and 19' },
};
const CANNOT_BOARD: Refusal = { token: 'cannotAct', reason: 'the merc cannot board here' };

function loadedTactical(campaign: CampaignSim): TacticalState | null {
  return campaign.tactical?.state ?? null;
}

function soldierOnTheMap(campaign: CampaignSim, id: number): Soldier | null {
  const t = loadedTactical(campaign);
  const s = t?.soldiers[id];
  return s?.placed ? s : null;
}

function ourSoldierOnTheMap(campaign: CampaignSim, id: number): Soldier | null {
  const t = loadedTactical(campaign);
  const merc = campaign.battle?.roster.get(id);
  return t && merc && registeredInTactical(t, merc) && merc.soldier.placed ? merc.soldier : null;
}

export function vehicleTileOnTheMap(campaign: CampaignSim, vehicleSoldierId: number): number | null {
  return soldierOnTheMap(campaign, vehicleSoldierId)?.gridNo ?? null;
}

function withGridNo(gridNo: number | null): { readonly gridNo?: number } {
  return gridNo === null ? {} : { gridNo };
}

function putSoldierInVehicle(campaign: CampaignSim, s: Soldier, vehicle: Soldier): Refusal | null {
  const economy = campaign.economy;
  const merc = campaign.battle?.roster.get(s.id);
  const vid = vehicle.vehicleId;
  const v = validVehicle(campaign.state.forces.vehicles, vid);
  if (!economy || !merc || !v) return CANNOT_BOARD;
  const boarding = addSoldierToVehicle(economy, merc, v);
  if (boarding !== Boarding.BOARDED) return BOARDING_REFUSALS[boarding];
  const gridNo = vehicleTileOnTheMap(campaign, v.soldierId);
  campaign.helicopter.emit({ type: 'vehicleBoarded', soldier: s.id, vehicle: vid, ...withGridNo(gridNo) });
  return null;
}

function exitVehicleOnTheMap(campaign: CampaignSim, s: Soldier): void {
  const economy = campaign.economy;
  const merc = campaign.battle?.roster.get(s.id);
  if (!economy || !merc) return;
  const vid = merc.vehicleId;
  const vehicleSoldierId = validVehicle(campaign.state.forces.vehicles, vid)?.soldierId ?? NO_VEHICLE_SOLDIER;
  exitVehicle(economy, s.id);
  const gridNo = vehicleTileOnTheMap(campaign, vehicleSoldierId);
  campaign.helicopter.emit({ type: 'vehicleLeft', soldier: s.id, vehicle: vid, ...withGridNo(gridNo) });
}

const NOT_A_ROBOT = false;

function setAssignmentRepair(campaign: CampaignSim, s: Soldier, vehicleUnderRepair: number): void {
  const economy = campaign.economy;
  const merc = campaign.battle?.roster.get(s.id);
  if (economy && merc) setSoldierAssignmentRepair(economy, merc, NOT_A_ROBOT, vehicleUnderRepair);
}

export function campaignVehicleBoarding(campaign: CampaignSim): VehicleBoarding {
  return {
    okUseVehicle: (vehicle) => {
      const ctx = campaign.strategic;
      return ctx !== null && okUseVehicleType(ctx, vehicleTypeOfBody(vehicle.bodyType));
    },
    putSoldierInVehicle: (s, vehicle) => putSoldierInVehicle(campaign, s, vehicle),
    exitVehicle: (s) => exitVehicleOnTheMap(campaign, s),
    setAssignmentRepair: (s, vehicleUnderRepair) => setAssignmentRepair(campaign, s, vehicleUnderRepair),
  };
}

function onTheGameScreen(campaign: CampaignSim): TacticalState | null {
  const t = loadedTactical(campaign);
  return t?.narrative.inTacticalScreen() ? t : null;
}

export function loadedSectorVehicles(campaignOf: () => CampaignSim | null): LoadedSectorVehicles {
  return {
    takeOver: (vehicleSoldierId) => {
      const campaign = campaignOf();
      const old = campaign ? soldierOnTheMap(campaign, vehicleSoldierId) : null;
      if (!campaign || !old) return null;
      return campaign.talk?.npcActions.recruitFlow.takeOverVehicle(old)?.id ?? null;
    },
    selectOnGameScreen: (id) => {
      const campaign = campaignOf();
      const t = campaign ? onTheGameScreen(campaign) : null;
      const s = campaign ? ourSoldierOnTheMap(campaign, id) : null;
      if (t && s) selectSoldier(t, s, SelectFlags.FORCE_RESELECT);
    },
    setCurrentSquadOnGameScreen: (squad) => {
      const campaign = campaignOf();
      const t = campaign ? loadedTactical(campaign) : null;
      if (t) setCurrentSquad(t, squad, true);
    },
    exitSpot: (id, vehicleSoldierId) => {
      const campaign = campaignOf();
      const t = campaign ? loadedTactical(campaign) : null;
      const s = campaign ? ourSoldierOnTheMap(campaign, id) : null;
      const vehicle = campaign ? soldierOnTheMap(campaign, vehicleSoldierId) : null;
      return t && s && vehicle ? vehicleExitSpot(t, s, vehicle) : NOWHERE;
    },
    placeOutOfVehicle: (id, vehicleSoldierId, gridNo) => {
      const campaign = campaignOf();
      const t = campaign ? loadedTactical(campaign) : null;
      const s = campaign ? ourSoldierOnTheMap(campaign, id) : null;
      const vehicle = campaign ? soldierOnTheMap(campaign, vehicleSoldierId) : null;
      if (t && s && vehicle) placeOutOfVehicle(t, s, vehicle, gridNo);
    },
  };
}
