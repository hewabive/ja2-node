// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Event_Hook.cc EVENT_MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE; Overhead.cc
// @src CivilianGroupMemberChangesSides (AddStrategicEvent + 300); Strategic/Quests.cc CheckFact, SetFactTrue, SetFactFalse;
// @src Tactical/Overhead.cc HandleNPCTeamMemberDeath (terrorists and assassins); Map_Screen_Helicopter.cc
// @src SetUpHelicopterForPlayer (from HandleAtNewGridNo); Game_Event_Hook.cc EVENT_PROCESS_TACTICAL_SCHEDULE; Scheduling.cc
// @src (the strategic event calls of the schedules); Tactical/Soldier_Control.cc CanRobotBeControlled, GetRobotController;
// @src Tactical/Items.cc PlaceObject (UpdateRobotControllerGivenController); Tactical/Boxing.cc (PauseGame, UnPauseGame,
// @src AddHistoryToPlayersLog, DeleteTalkingMenu); Tactical/Overhead.cc SetSoldierNeutral; TacticalAI/AIMain.cc EndAIGuysTurn
// @src (TriggerFriendWithHostileQuote); Tactical/Soldier_Control.cc EVENT_SoldierGotHit (our merc on another assignment
// @src wakes and joins a squad, 2026-10-31).

import { i8, idiv } from '../../core/int.ts';
import { deleteTalkingMenu } from '../narrative/converse.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { decrementTownLoyalty, incrementTownLoyalty, reduceLoyaltyForRebelsBetrayed } from '../strategic/economy/loyalty.ts';
import { setUpHelicopterForPlayer } from '../strategic/forces/helicopter.ts';
import { addCharacterToAnySquad } from '../strategic/forces/squads.ts';
import { findUndergroundSector } from '../strategic/map/sectors.ts';
import { makeCivGroupHostileOnNextSectorEntrance } from '../strategic/narrative/civ-groups.ts';
import { questStatus } from '../strategic/narrative/facts.ts';
import { EventKind } from '../strategic/time/constants.ts';
import {
  addFutureDayStrategicEvent,
  addStrategicEvent,
  deleteAllStrategicEventsOfType,
  deleteStrategicEvent,
} from '../strategic/time/event-queue.ts';
import { pauseGame, unPauseGame, worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { HOSTILITY_DELAY_MINUTES } from '../tactical/narrative/constants.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from '../tactical/narrative/port.ts';
import type { ScheduleClock } from '../tactical/narrative/schedule-state.ts';
import { processTacticalSchedule } from '../tactical/narrative/schedules.ts';
import type { Soldier } from '../tactical/soldier.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { MercKind } from './roster.ts';

function putOnSquadWhenHit(campaign: CampaignSim, soldier: Soldier): void {
  const strategic = campaign.strategic;
  const merc = campaign.battle?.roster.get(soldier.id);
  if (!strategic || !merc || merc.soldier !== soldier) return;
  if (merc.assignment < Assignment.ON_DUTY || merc.assignment === Assignment.ASSIGNMENT_POW) return;
  if (merc.asleep) {
    merc.asleep = false;
    merc.forcedToStayAwake = false;
  }
  addCharacterToAnySquad(strategic, merc.id);
}

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
    assignment: (soldier) => campaign.battle?.roster.get(soldier.id)?.assignment ?? null,
    mercAsleep: (soldier) => campaign.battle?.roster.get(soldier.id)?.asleep ?? false,
    putOnSquadWhenHit: (soldier) => putOnSquadWhenHit(campaign, soldier),
    isAimMerc: (soldier) => campaign.battle?.roster.get(soldier.id)?.kind === MercKind.AIM_MERC,
    quoteSaidFlags: (soldier) => campaign.battle?.roster.get(soldier.id) ?? null,
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
    npcAction: (profile, code, record) => campaign.talk?.npcActions.handle(profile, code, record),
    robotCanBeControlled: (robot) => robotCanBeControlled(campaign, robot),
    robotController: (robot) => robotController(campaign, robot),
    controllingRobot: (soldier) => campaign.battle?.roster.controllingRobot(soldier.id) ?? false,
    robotRemotePlaced: (soldier) => campaign.battle?.roster.updateRobotControllerGivenController(soldier.id),
    changeSoldierTeam: (soldier, team) => campaign.talk?.npcActions.recruitFlow.changeTeam(soldier, team) ?? null,
    inMeanwhile: () => campaign.strategic?.world.inMeanwhile() ?? false,
    meanwhileId: () => s.meanwhile.current.id,
    deidrannaDied: (killer, gridNo, level) => campaign.endgame.deidrannaDied(killer, gridNo, level),
    creatureQueenDied: (killer, gridNo, level) => campaign.endgame.creatureQueenDied(killer, gridNo, level),
    powPathChecks: () => campaign.pows.doPowPathChecks(),
    queenCanFlee: () => !s.queen.useAlternateQueenPosition,
    palaceBasementSecured: () => palaceBasementSecured(s),
    pauseGame: () => pauseGame(s.clock),
    unPauseGame: () => {
      unPauseGame(s.clock);
    },
    addHistory: (code, secondCode) => campaign.narrative.history(code, secondCode, s.worldSector),
    deleteTalkingMenu: () => {
      const host = campaign.talk?.host;
      if (host) deleteTalkingMenu(host, 'script');
    },
    setSoldierNeutral: (soldier) => {
      const env = campaign.talk?.npcActions.env;
      if (env) env.setSoldierNeutral(soldier);
      else soldier.neutral = true;
    },
  };
}

const SECONDS_PER_MINUTE = 60;
const PALACE_BASEMENT = { x: 3, y: 16, z: 1 } as const;
const PALACE_BASEMENT_ENEMY_LIMIT = 5;

function palaceBasementSecured(s: CampaignSim['state']): boolean {
  const basement = findUndergroundSector(s.map, PALACE_BASEMENT);
  if (!basement || basement.timeLastLoaded === 0) return false;
  return basement.numAdmins + basement.numTroops + basement.numElites < PALACE_BASEMENT_ENEMY_LIMIT;
}

export function campaignScheduleClock(campaign: CampaignSim): ScheduleClock {
  const s = campaign.state;
  return {
    worldMinutes: () => worldTotalMinutes(s.clock),
    lastEventQueryMinutes: () => idiv(s.clock.lastEventQuerySeconds, SECONDS_PER_MINUTE),
    addEvent: (minute, id) => {
      addStrategicEvent(s.queue, EventKind.PROCESS_TACTICAL_SCHEDULE, minute, id);
    },
    deleteEvent: (id) => {
      deleteStrategicEvent(s.queue, EventKind.PROCESS_TACTICAL_SCHEDULE, id);
    },
    deleteAllEvents: () => deleteAllStrategicEventsOfType(s.queue, EventKind.PROCESS_TACTICAL_SCHEDULE),
  };
}

function robotCanBeControlled(campaign: CampaignSim, robot: Soldier): boolean {
  const roster = campaign.battle?.roster;
  if (!roster?.get(robot.id)) return true;
  return roster.canRobotBeControlled(robot.id);
}

function robotController(campaign: CampaignSim, robot: Soldier): Soldier | null {
  const roster = campaign.battle?.roster;
  const merc = roster?.get(robot.id);
  if (!roster || !merc || merc.remoteHolder === null || !roster.canRobotBeControlled(robot.id)) return null;
  return roster.get(merc.remoteHolder)?.soldier ?? null;
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
