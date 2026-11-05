// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.cc TrashWorld (the empty world left when no sector is loaded, which the turn starts
// @src and the deaths off the map still run against); Tactical/Overhead.h FOR_EACH_IN_TEAM (our team wherever it is);
// @src Strategic/MapScreen.cc fInMapMode.

import { emptyTacticalWorld } from '../../content/world/empty-world.ts';
import type { SimEvent } from '../events.ts';
import { addVehicleToList, killAllInVehicle } from '../strategic/forces/vehicles.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { NO_SECTOR_HOOKS, type SectorHooks, type TacticalState } from '../tactical/state.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { PRIVATE_VEHICLE_LIST, type VehicleHooks } from '../tactical/vehicle-soldiers.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { handleRpcDescription } from './narrative/guide-description.ts';
import { campaignNarrativePort, campaignScheduleClock } from './narrative-port.ts';
import { campaignVehicleBoarding } from './vehicle-boarding.ts';

export type CampaignTurnHooks = Pick<SectorHooks, 'mercDiedOffTheMap' | 'inMapScreen' | 'ourWholeTeam' | 'tacticalTurnEnded'>;

export function campaignTurnHooks(campaign: CampaignSim): CampaignTurnHooks {
  return {
    mercDiedOffTheMap: (_t, dead) => campaign.battle?.mercDiedOffTheMap(dead),
    inMapScreen: () => campaign.state.flow === 'strategic',
    ourWholeTeam: () => campaign.battle?.roster.all().map((m) => m.soldier) ?? [],
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

export function installCampaignPorts(campaign: CampaignSim, t: TacticalState): void {
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
  });
  sim.attachWorldClock(s.clock);
  installCampaignPorts(campaign, sim.state);
  sim.state.sectorHooks = { ...NO_SECTOR_HOOKS, ...campaignTurnHooks(campaign) };
  return sim;
}

export function drainUnloadedWorldEvents(world: TacticalSim, tick: number): SimEvent[] {
  return world.state.events.splice(0).map((e) => ({ ...e, tick }) as SimEvent);
}
