// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Event_Hook.cc EVENT_MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE; Overhead.cc
// @src CivilianGroupMemberChangesSides (AddStrategicEvent + 300); Strategic/Quests.cc CheckFact, SetFactTrue, SetFactFalse;
// @src Tactical/Overhead.cc HandleNPCTeamMemberDeath (terrorists and assassins); Map_Screen_Helicopter.cc
// @src SetUpHelicopterForPlayer (from HandleAtNewGridNo); Game_Event_Hook.cc EVENT_PROCESS_TACTICAL_SCHEDULE; Scheduling.cc
// @src (the strategic event calls of the schedules). See docs/25 §1, §5, §6.2, §10.2.

import { i8 } from '../../core/int.ts';
import { decrementTownLoyalty, incrementTownLoyalty, reduceLoyaltyForRebelsBetrayed } from '../strategic/economy/loyalty.ts';
import { setUpHelicopterForPlayer } from '../strategic/forces/helicopter.ts';
import { makeCivGroupHostileOnNextSectorEntrance } from '../strategic/narrative/civ-groups.ts';
import { questStatus } from '../strategic/narrative/facts.ts';
import { EventKind } from '../strategic/time/constants.ts';
import {
  addFutureDayStrategicEvent,
  addStrategicEvent,
  deleteAllStrategicEventsOfType,
  deleteStrategicEvent,
} from '../strategic/time/event-queue.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { HOSTILITY_DELAY_MINUTES } from '../tactical/narrative/constants.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from '../tactical/narrative/port.ts';
import type { ScheduleClock } from '../tactical/narrative/schedule-state.ts';
import { processTacticalSchedule } from '../tactical/narrative/schedules.ts';
import type { CampaignSim } from './campaign-sim.ts';

function rebelsBetrayed(campaign: CampaignSim): void {
  if (campaign.economy) reduceLoyaltyForRebelsBetrayed(campaign.economy);
}

export function campaignNarrativePort(campaign: CampaignSim): NarrativePort {
  const s = campaign.state;
  return {
    ...NO_NARRATIVE_PORT,
    ...campaign.talk?.narrativePortHooks(),
    fact: (id, profile) => campaign.narrative.checkFact(id, profile ?? 0),
    setFactTrue: (id) => campaign.narrative.setFactTrue(id),
    setFactFalse: (id) => campaign.narrative.setFactFalse(id),
    questStatus: (quest) => questStatus(s.narrative, quest),
    setNpcData: (profile, value) => {
      const p = campaign.narrative.profile(profile);
      if (p) p.npcData = i8(value);
    },
    terroristKilled: () => campaign.narrative.terroristKilled(),
    profileDied: (profile) => campaign.narrative.profileDied(profile),
    assassinKilled: () => campaign.narrative.assassinKilled(),
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

const SECONDS_PER_MINUTE = 60;

export function campaignScheduleClock(campaign: CampaignSim): ScheduleClock {
  const s = campaign.state;
  return {
    worldMinutes: () => worldTotalMinutes(s.clock),
    lastEventQueryMinutes: () => Math.trunc(s.clock.lastEventQuerySeconds / SECONDS_PER_MINUTE),
    addEvent: (minute, id) => {
      addStrategicEvent(s.queue, EventKind.PROCESS_TACTICAL_SCHEDULE, minute, id);
    },
    deleteEvent: (id) => {
      deleteStrategicEvent(s.queue, EventKind.PROCESS_TACTICAL_SCHEDULE, id);
    },
    deleteAllEvents: () => deleteAllStrategicEventsOfType(s.queue, EventKind.PROCESS_TACTICAL_SCHEDULE),
  };
}

export function registerNarrativeEvents(campaign: CampaignSim): void {
  campaign.dispatchTable.register(EventKind.PROCESS_TACTICAL_SCHEDULE, (c, e) => {
    const t = c.tactical?.state;
    if (t) processTacticalSchedule(t, e.param, c.state.flow === 'tactical');
  });
  campaign.dispatchTable.register(EventKind.MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE, (c, e) =>
    makeCivGroupHostileOnNextSectorEntrance(c.state.civGroups, e.param, () => rebelsBetrayed(c)),
  );
}
