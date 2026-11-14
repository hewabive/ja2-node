// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.cc TrashWorld (the empty world left when no sector is loaded, which the turn starts
// @src and the deaths off the map still run against); Tactical/Overhead.h FOR_EACH_IN_TEAM (our team wherever it is);
// @src Strategic/MapScreen.cc fInMapMode; Strategic/MapScreen.cc MapScreenHandle's HandleStrategicTurn (the map screen's
// @src poll of the real-time turn, against whatever world is loaded) and Strategic/Game_Clock.cc IsTimeBeingCompressed,
// @src giTimeCompressSpeeds (2026-11-05); TacticalAI/AIUtils.cc SoldierDifficultyLevel and Tactical/Morale.cc
// @src RefreshSoldierMorale (CalcDifficultyModifier and CurrentPlayerProgressPercentage asked at every use, 2026-11-14);
// @src Tactical/Campaign.cc HighestPlayerProgressPercentage (asked by soldier creation, 2026-11-14).

import { emptyTacticalWorld } from '../../content/world/empty-world.ts';
import type { SimEvent } from '../events.ts';
import { addVehicleToList, killAllInVehicle } from '../strategic/forces/vehicles.ts';
import { COMPRESS_SPEEDS } from '../strategic/time/constants.ts';
import { isTimeBeingCompressed } from '../strategic/time/world-clock.ts';
import type { TacticalContent } from '../tactical/content.ts';
import type { Soldier } from '../tactical/soldier.ts';
import { type CampaignPort, NO_CAMPAIGN_PORT, NO_SECTOR_HOOKS, type SectorHooks, type TacticalState } from '../tactical/state.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { handleForcedRealtimeTurn, handleTacticalEndTurn, type StrategicTurnPoll, strategicTurnDue } from '../tactical/turns/turns.ts';
import { PRIVATE_VEHICLE_LIST, type VehicleHooks } from '../tactical/vehicle-soldiers.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { profileVoice } from './laptop/laptop-state.ts';
import { handleRpcDescription } from './narrative/guide-description.ts';
import { campaignNarrativePort, campaignScheduleClock } from './narrative-port.ts';
import { campaignVehicleBoarding } from './vehicle-boarding.ts';

const NO_SOLDIERS: readonly Soldier[] = [];

export type CampaignTurnHooks = Pick<
  SectorHooks,
  'mercDiedOffTheMap' | 'inMapScreen' | 'profileVoice' | 'ourWholeTeam' | 'tacticalTurnEnded'
>;

export function campaignTurnHooks(campaign: CampaignSim): CampaignTurnHooks {
  return {
    mercDiedOffTheMap: (_t, dead) => campaign.battle?.mercDiedOffTheMap(dead),
    inMapScreen: () => campaign.state.flow === 'strategic',
    profileVoice: (_t, profile) => profileVoice(campaign.state.laptop.imp, profile),
    ourWholeTeam: () => campaign.battle?.roster.soldiers() ?? NO_SOLDIERS,
    tacticalTurnEnded: () => handleRpcDescription(campaign),
  };
}

function campaignVehicleHooks(campaign: CampaignSim): VehicleHooks {
  const ctx = campaign.strategic;
  if (!ctx) return PRIVATE_VEHICLE_LIST;
  return {
    addVehicleToList: (_list, sector, type) => addVehicleToList(ctx, sector, type),
    killAllInVehicle: (v) => killAllInVehicle(ctx, v),
    boarding: campaignVehicleBoarding(campaign),
  };
}

function campaignProgressPort(campaign: CampaignSim): CampaignPort {
  return {
    difficultyModifier: (soldierClass) =>
      campaign.sectors?.difficultyModifier(soldierClass) ?? NO_CAMPAIGN_PORT.difficultyModifier(soldierClass),
    playerProgress: () => campaign.sectors?.currentPlayerProgress() ?? NO_CAMPAIGN_PORT.playerProgress(),
    highestProgress: () => campaign.state.status.highestProgress,
  };
}

export function installCampaignPorts(campaign: CampaignSim, t: TacticalState): void {
  t.campaign = campaignProgressPort(campaign);
  t.experienceHooks = campaign.experienceHooks;
  t.narrative = campaignNarrativePort(campaign);
  t.scheduleClock = campaignScheduleClock(campaign);
  t.vehicleHooks = campaignVehicleHooks(campaign);
}

export function createUnloadedWorld(campaign: CampaignSim, content: TacticalContent): TacticalSim {
  const s = campaign.state;
  const sim = new TacticalSim(emptyTacticalWorld(), content, 0, {
    options: s.options,
    streams: { rng: s.rng, pre: s.pre },
    profiles: s.profiles,
    vehicles: s.forces.vehicles,
    keyTable: s.keyTable,
    civGroups: s.civGroups,
    boxing: s.narrative.boxing,
    startMs: s.realMs,
    realtimeClock: s.sectorFlow.realtimeClock,
    crows: s.sectorFlow.crows,
    autoBandage: s.sectorFlow.autoBandage,
    helicopterDrop: s.sectorFlow.helicopterDrop,
  });
  sim.attachWorldClock(s.clock);
  installCampaignPorts(campaign, sim.state);
  sim.state.sectorHooks = { ...NO_SECTOR_HOOKS, ...campaignTurnHooks(campaign), worldLoaded: () => false };
  return sim;
}

export function drainTurnWorldEvents(world: TacticalSim, tick: number): SimEvent[] {
  const events = world.state.events;
  if (events.length === 0) return [];
  return events.splice(0).map((e) => ({ ...e, tick }) as SimEvent);
}

function mapScreenPoll(campaign: CampaignSim): StrategicTurnPoll {
  const s = campaign.state;
  const clock = s.clock;
  return {
    nowMs: s.realMs,
    paused: clock.paused,
    mapScreen: true,
    compressing: isTimeBeingCompressed(clock),
    compressSpeed: COMPRESS_SPEEDS[clock.mode] ?? 0,
    inCombat: campaign.tactical?.state.inCombat === true,
  };
}

export function handleMapScreenRealtimeTurns(campaign: CampaignSim): void {
  const clock = campaign.state.sectorFlow.realtimeClock;
  const loaded = campaign.tactical?.state;
  if (loaded && handleForcedRealtimeTurn(loaded, clock, campaign.state.realMs)) return;
  if (!strategicTurnDue(clock, mapScreenPoll(campaign))) return;
  const world = campaign.turnWorld();
  if (world) handleTacticalEndTurn(world.state, clock);
}
