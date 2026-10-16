// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc CheckFact (fact), SetFactTrue, SetFactFalse, gubQuest; Tactical/Interface_Dialogue.cc
// @src HandleNPCDoAction (npcAction); TacticalAI/NPC.cc TriggerNPCWithGivenApproach; Tactical/Handle_Items.cc
// @src SoldierGiveItemFromAnimation (the dealer, team member and NPC branches); TileEngine/Explosion_Control.cc
// @src PerformItemAction (ACTION_ITEM_SEX: HandleMoraleEvent, FatigueCharacter); Strategic/Meanwhile.cc AreInMeanwhile,
// @src GetMeanwhileID; Tactical/Overhead.cc HandleNPCTeamMemberDeath (BeginHandleDeidrannaDeath, BeginHandleQueenBitchDeath),
// @src DoPOWPathChecks. See docs/25 §1, §2.1, §3, §6, §11.5, docs/24 §4, docs/26 §1.6, §3.4, §6.1.

import type { ItemObject } from '../../items/object.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import { type Soldier, Team } from '../soldier.ts';
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
  meanwhileId(): number;
  deidrannaDied(killer: Soldier | null, gridNo: number, level: number): void;
  creatureQueenDied(killer: Soldier | null, gridNo: number, level: number): void;
  powPathChecks(): void;
  queenCanFlee(): boolean;
  palaceBasementSecured(): boolean;
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
  isDealer(profile: number): boolean;
  dealerTakesGive(giver: Soldier, dealer: Soldier, object: ItemObject, slot: number): boolean;
  receivesAsTeamMember(target: Soldier): boolean;
  giveToNpc(giver: Soldier, target: Soldier, object: ItemObject): void;
  triggerDoneGivingItem(profile: number): void;
  isNpcProfile(profile: number): boolean;
  sexEffects(s: Soldier): void;
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
  meanwhileId: () => 0,
  deidrannaDied: () => {},
  creatureQueenDied: () => {},
  powPathChecks: () => {},
  queenCanFlee: () => true,
  palaceBasementSecured: () => false,
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
  isDealer: () => false,
  dealerTakesGive: () => false,
  receivesAsTeamMember: (target) => target.team === Team.OUR,
  giveToNpc: () => {},
  triggerDoneGivingItem: () => {},
  isNpcProfile: () => false,
  sexEffects: () => {},
};
