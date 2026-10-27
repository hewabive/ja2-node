// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc CheckFact (fact), SetFactTrue, SetFactFalse, gubQuest; Tactical/Interface_Dialogue.cc
// @src HandleNPCDoAction (npcAction); TacticalAI/NPC.cc TriggerNPCWithGivenApproach; Tactical/Handle_Items.cc
// @src SoldierGiveItemFromAnimation (the dealer, team member and NPC branches); TileEngine/Explosion_Control.cc
// @src PerformItemAction (ACTION_ITEM_SEX: HandleMoraleEvent, FatigueCharacter); Tactical/Soldier_Control.cc
// @src CanRobotBeControlled, ControllingRobot, robot_remote_holder; Tactical/Items.cc PlaceObject (the remote control);
// @src Tactical/Soldier_Profile.cc ChangeSoldierTeam (side changes of Overhead.cc); Civ_Quotes.cc StartCivQuote, BeginCivQuote;
// @src TacticalAI/NPC.cc PCsNearNPC, PCDoesFirstAidOnNPC, NPCConsiderInitiatingConv, TriggerFriendWithHostileQuote,
// @src NPCHasUnusedRecordWithGivenApproach; OppList.cc ManSeesMan (first-sighting records, MIKE and JOEY quotes).
// @src Strategic/Meanwhile.cc AreInMeanwhile, GetMeanwhileID; Tactical/Overhead.cc HandleNPCTeamMemberDeath
// @src (BeginHandleDeidrannaDeath, BeginHandleQueenBitchDeath), DoPOWPathChecks.
// @src Tactical/Boxing.cc (PauseGame, UnPauseGame, AddHistoryToPlayersLog, DeleteTalkingMenu); Tactical/Overhead.cc
// @src SetSoldierNeutral; TileEngine/Interactive_Tiles.cc HandleStructChangeFromGridNo (the Drassen shipment check);
// @src Dialogue_Control.cc TacticalCharacterDialogue, DelayedTacticalCharacterDialogue (sayQuote).
// @src See docs/25 §1, §2.1, §3, §6, §7, §9.4, §11.5, docs/24 §4, §5.4, §8, docs/26 §1.6, §3.4, §6.1.

import type { ItemObject } from '../../items/object.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { SectorRef } from '../state.ts';

const NO_INITIATING_TARGET = -1;

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
  hasUnusedRecordWithApproach(profile: number, approach: number): boolean;
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
  mercSeesProfile(merc: Soldier, profile: number): void;
  beginCivQuote(s: Soldier, quote: number, entry: number): void;
  offerSurrender(s: Soldier): boolean;
  pcsNearNpc(profile: number): void;
  pcDoesFirstAidOnNpc(profile: number): boolean;
  npcConsiderInitiatingConv(s: Soldier): number;
  triggerFriendWithHostileQuote(profile: number): void;
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
  isNpcOrRpcProfile(profile: number): boolean;
  sexEffects(s: Soldier): void;
  robotCanBeControlled(robot: Soldier): boolean;
  robotController(robot: Soldier): Soldier | null;
  controllingRobot(s: Soldier): boolean;
  robotRemotePlaced(s: Soldier): void;
  changeSoldierTeam(s: Soldier, team: number): Soldier | null;
  pauseGame(): void;
  unPauseGame(): void;
  addHistory(code: number, secondCode: number): void;
  deleteTalkingMenu(): void;
  setSoldierNeutral(s: Soldier): void;
  stuffMissingFromShipment(gridNo: number): boolean;
  sayQuote(s: Soldier, quote: number, delayed?: boolean): void;
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
  hasUnusedRecordWithApproach: () => false,
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
  mercSeesProfile: () => {},
  beginCivQuote: () => {},
  offerSurrender: () => false,
  pcsNearNpc: () => {},
  pcDoesFirstAidOnNpc: () => false,
  npcConsiderInitiatingConv: () => NO_INITIATING_TARGET,
  triggerFriendWithHostileQuote: () => {},
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
  isNpcOrRpcProfile: () => false,
  sexEffects: () => {},
  robotCanBeControlled: () => true,
  robotController: () => null,
  controllingRobot: () => false,
  robotRemotePlaced: () => {},
  changeSoldierTeam: () => null,
  pauseGame: () => {},
  unPauseGame: () => {},
  addHistory: () => {},
  deleteTalkingMenu: () => {},
  setSoldierNeutral: (s) => {
    s.neutral = true;
  },
  stuffMissingFromShipment: () => false,
  sayQuote: () => {},
};
