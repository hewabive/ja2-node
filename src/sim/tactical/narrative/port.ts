// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc CheckFact (fact), SetFactTrue, SetFactFalse, gubQuest; Tactical/Interface_Dialogue.cc
// @src HandleNPCDoAction (npcAction); TacticalAI/NPC.cc TriggerNPCWithGivenApproach; Tactical/Soldier_Control.cc
// @src CanRobotBeControlled, ControllingRobot, robot_remote_holder; Tactical/Items.cc PlaceObject (the remote control);
// @src Tactical/Soldier_Profile.cc ChangeSoldierTeam (side changes of Overhead.cc).
// @src See docs/25 §1, §2.1, §3, §6, §9.4.

import { QuestStatus } from '../../strategic/narrative/facts.ts';
import type { Soldier } from '../soldier.ts';
import type { SectorRef } from '../state.ts';

export interface NarrativePort {
  fact(id: number, profile?: number): boolean;
  setFactTrue(id: number): void;
  setFactFalse(id: number): void;
  questStatus(quest: number): number;
  setNpcData(profile: number, value: number): void;
  triggerNpcRecord(profile: number, record: number): void;
  triggerNpcWithGivenApproach(profile: number, approach: number): void;
  npcAction(profile: number, code: number, record: number): void;
  hasUnusedHostileRecord(profile: number): boolean;
  sayHostileQuote(s: Soldier): void;
  inMeanwhile(): boolean;
  isEpc(s: Soldier): boolean;
  civGroupWillBecomeHostile(group: number): void;
  rebelsBetrayed(): void;
  townLoyaltyChange(town: number, amount: number): void;
  addFutureDayEvent(kind: number, minuteOfDay: number, param: number, days: number): void;
  terroristKilled(): void;
  assassinKilled(): void;
  firstSightingRecord(profile: number, record: number): boolean;
  profileDied(profile: number, killer: Soldier | null): void;
  setUpHelicopterForPlayer(sector: SectorRef): void;
  dialogueBusy(): boolean;
  startTalking(s: Soldier, target: number): void;
  npcReachedDestination(s: Soldier): void;
  replaceLocationInNpcData(profile: number, oldGridNo: number, newGridNo: number): void;
  robotCanBeControlled(robot: Soldier): boolean;
  robotController(robot: Soldier): Soldier | null;
  controllingRobot(s: Soldier): boolean;
  robotRemotePlaced(s: Soldier): void;
  changeSoldierTeam(s: Soldier, team: number): Soldier | null;
}

export const NO_NARRATIVE_PORT: NarrativePort = {
  fact: () => false,
  setFactTrue: () => {},
  setFactFalse: () => {},
  questStatus: () => QuestStatus.NOT_STARTED,
  setNpcData: () => {},
  triggerNpcRecord: () => {},
  triggerNpcWithGivenApproach: () => {},
  npcAction: () => {},
  hasUnusedHostileRecord: () => false,
  sayHostileQuote: () => {},
  inMeanwhile: () => false,
  isEpc: () => false,
  civGroupWillBecomeHostile: () => {},
  rebelsBetrayed: () => {},
  townLoyaltyChange: () => {},
  addFutureDayEvent: () => {},
  terroristKilled: () => {},
  assassinKilled: () => {},
  firstSightingRecord: () => false,
  profileDied: () => {},
  setUpHelicopterForPlayer: () => {},
  dialogueBusy: () => false,
  startTalking: () => {},
  npcReachedDestination: () => {},
  replaceLocationInNpcData: () => {},
  robotCanBeControlled: () => true,
  robotController: () => null,
  controllingRobot: () => false,
  robotRemotePlaced: () => {},
  changeSoldierTeam: () => null,
};
