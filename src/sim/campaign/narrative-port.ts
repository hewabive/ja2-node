// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Event_Hook.cc EVENT_MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE; Overhead.cc
// @src CivilianGroupMemberChangesSides (AddStrategicEvent + 300); Map_Screen_Helicopter.cc SetUpHelicopterForPlayer (from
// @src HandleAtNewGridNo). See docs/25 §6.2, §10.2.

import { decrementTownLoyalty, incrementTownLoyalty, reduceLoyaltyForRebelsBetrayed } from '../strategic/economy/loyalty.ts';
import { setUpHelicopterForPlayer } from '../strategic/forces/helicopter.ts';
import { makeCivGroupHostileOnNextSectorEntrance } from '../strategic/narrative/civ-groups.ts';
import { EventKind } from '../strategic/time/constants.ts';
import { addFutureDayStrategicEvent, addStrategicEvent } from '../strategic/time/event-queue.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { HOSTILITY_DELAY_MINUTES } from '../tactical/narrative/constants.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from '../tactical/narrative/port.ts';
import type { CampaignSim } from './campaign-sim.ts';

function rebelsBetrayed(campaign: CampaignSim): void {
  if (campaign.economy) reduceLoyaltyForRebelsBetrayed(campaign.economy);
}

export function campaignNarrativePort(campaign: CampaignSim): NarrativePort {
  const s = campaign.state;
  return {
    ...NO_NARRATIVE_PORT,
    ...campaign.talk?.narrativePortHooks(),
    fact: (id) => (campaign.strategic?.world.fact(id) ?? 0) !== 0,
    setFactTrue: (id) => campaign.economy?.hooks.setFact(id),
    isEpc: (soldier) => campaign.battle?.roster.get(soldier.id)?.isEpc ?? false,
    civGroupWillBecomeHostile: (group) => {
      addStrategicEvent(
        s.queue,
        EventKind.MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE,
        worldTotalMinutes(s.clock) + HOSTILITY_DELAY_MINUTES,
        group,
      );
    },
    rebelsBetrayed: () => rebelsBetrayed(campaign),
    townLoyaltyChange: (town, amount) => {
      const economy = campaign.economy;
      if (!economy) return;
      if (amount < 0) decrementTownLoyalty(economy, town, -amount);
      else incrementTownLoyalty(economy, town, amount);
    },
    addFutureDayEvent: (kind, minute, param, days) => {
      addFutureDayStrategicEvent(s.queue, s.clock, kind, minute, param, days);
    },
    setUpHelicopterForPlayer: (sector) => {
      if (campaign.strategic) setUpHelicopterForPlayer(campaign.strategic, sector);
    },
  };
}

export function registerNarrativeEvents(campaign: CampaignSim): void {
  campaign.dispatchTable.register(EventKind.MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE, (c, e) =>
    makeCivGroupHostileOnNextSectorEntrance(c.state.civGroups, e.param, () => rebelsBetrayed(c)),
  );
}
