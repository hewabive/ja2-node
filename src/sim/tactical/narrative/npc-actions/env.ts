// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (what the actions read and write outside the dialogue
// @src code); src/externalized/content/NpcActionParamsModel.cc getGridNo, getAmount.

import type { NarrativeHost } from '../../../narrative/host.ts';
import type { HospitalAccount } from '../../../strategic/narrative/facts.ts';
import type { SectorPosition } from '../../../strategic/state.ts';
import type { Soldier } from '../../soldier.ts';

export interface NpcActionParams {
  gridNo(code: number, fallback: number): number;
  amount(code: number, fallback: number): number;
}

export const DEFAULT_NPC_ACTION_PARAMS: NpcActionParams = {
  gridNo: (_code, fallback) => fallback,
  amount: (_code, fallback) => fallback,
};

export interface NpcRequestOpening {
  readonly code: number;
  readonly npc: number;
  readonly record: number;
}

export interface MineActions {
  headMinersMine(npc: number): number;
  playerSpokeToHeadMiner(npc: number): void;
  isMineShutDown(mine: number): boolean;
  restartMineProduction(mine: number): void;
  shutOffMineProduction(mine: number): void;
  resetQueenRetookMine(npc: number): void;
}

export const NO_MINE_ACTIONS: MineActions = {
  headMinersMine: () => -1,
  playerSpokeToHeadMiner: () => {},
  isMineShutDown: () => false,
  restartMineProduction: () => {},
  shutOffMineProduction: () => {},
  resetQueenRetookMine: () => {},
};

export interface BoxingActions {
  checkOnBoxers(): boolean;
  startMatch(): void;
  exitBoxing(): void;
  boxerAvailable(): boolean;
  lastMatchWonByPlayer(): boolean;
  inMatch(): boolean;
}

export const NO_BOXING_ACTIONS: BoxingActions = {
  checkOnBoxers: () => false,
  startMatch: () => {},
  exitBoxing: () => {},
  boxerAvailable: () => false,
  lastMatchWonByPlayer: () => false,
  inMatch: () => false,
};

export interface RecruitActions {
  recruitRpc(npc: number): void;
  recruitEpc(npc: number): void;
  unRecruitEpc(npc: number): void;
  handleStuffForNpcEscorted(npc: number): void;
  turnIntoAnonymousCivilian(s: Soldier): void;
  addToOtherList(profile: number): void;
  updateDarrelScriptToGoTo(merc: Soldier): void;
}

export const NO_RECRUIT_ACTIONS: RecruitActions = {
  recruitRpc: () => {},
  recruitEpc: () => {},
  unRecruitEpc: () => {},
  handleStuffForNpcEscorted: () => {},
  turnIntoAnonymousCivilian: () => {},
  addToOtherList: () => {},
  updateDarrelScriptToGoTo: () => {},
};

export type QueenAnimation = 'slap' | 'frustratedSlap';

export interface MeanwhileActions {
  endMeanwhile(): void;
  queenAnimation(npc: number, kind: QueenAnimation): void;
  punch(npc: number, gridNo: number | null, approach: number): void;
  shootElliot(npc: number): void;
  endgame(state: 1 | 2): void;
  endDemo(): void;
  wholeTownsUnderControlExceptOmerta(): number;
  samSitesUnderPlayerControl(): number;
  lastBattleWon(): boolean;
  functionalSamSiteInLastBattleSector(): boolean;
  firstBattleInTown(town: number): boolean;
}

export const NO_MEANWHILE_ACTIONS: MeanwhileActions = {
  endMeanwhile: () => {},
  queenAnimation: () => {},
  punch: () => {},
  shootElliot: () => {},
  endgame: () => {},
  endDemo: () => {},
  wholeTownsUnderControlExceptOmerta: () => 0,
  samSitesUnderPlayerControl: () => 0,
  lastBattleWon: () => false,
  functionalSamSiteInLastBattleSector: () => false,
  firstBattleInTown: () => false,
};

export interface ExitGridTarget {
  readonly sector: SectorPosition;
  readonly gridNo: number;
}

export interface HideoutActions {
  addExitGrid(gridNo: number, target: ExitGridTarget): void;
  moveMercs(sector: SectorPosition, insertionGridNos: readonly number[], currentSquadOnly: boolean): void;
  loadSector(sector: SectorPosition): void;
  uncoverTrapdoor(sector: SectorPosition): void;
  leavingSector(): boolean;
}

export const NO_HIDEOUT_ACTIONS: HideoutActions = {
  addExitGrid: () => {},
  moveMercs: () => {},
  loadSector: () => {},
  uncoverTrapdoor: () => {},
  leavingSector: () => false,
};

export interface LaptopActions {
  addTerroristFiles(): void;
  addJohnsGunShipment(): void;
}

export const NO_LAPTOP_ACTIONS: LaptopActions = {
  addTerroristFiles: () => {},
  addJohnsGunShipment: () => {},
};

export interface NpcActionEnv {
  readonly host: NarrativeHost;
  readonly params: NpcActionParams;
  readonly hospital: HospitalAccount;
  readonly mines: MineActions;
  readonly boxing: BoxingActions;
  readonly recruit: RecruitActions;
  readonly meanwhile: MeanwhileActions;
  readonly hideout: HideoutActions;
  readonly laptop: LaptopActions;
  random(n: number): number;
  preRandom(n: number): number;
  sciFi(): boolean;
  worldSector(): SectorPosition | null;
  minutesInDay(): number;
  totalMinutes(): number;
  day(): number;
  checkFact(id: number, npc: number): boolean;
  setFactTrue(id: number): void;
  setFactFalse(id: number): void;
  questStatus(quest: number): number;
  startQuest(quest: number, sector: SectorPosition | null): void;
  history(code: number, sector: SectorPosition | null, secondCode?: number): void;
  awardExperience(bonus: number): void;
  loyaltyForNpcAction(npc: number): void;
  incrementTownLoyalty(town: number, amount: number): void;
  incrementTownLoyaltyEverywhere(amount: number): void;
  loyaltyAmount(name: string): number;
  setTownAsFound(town: number): void;
  addFutureDayNpcEvent(minuteOfDay: number, param: number, days: number): void;
  addSameDayNpcEvent(minuteOfDay: number, param: number): void;
  addStrategicEvent(kind: number, minute: number, param: number): void;
  updateRefuelSiteAvailability(): void;
  calcMedicalCost(npc: number): number;
  assignment(s: Soldier): number;
  setHospitalAssignment(s: Soldier, priceModifier: number): void;
  playerTeamFull(): boolean;
  mercsOnPlayerTeam(): number;
  setCurrentSquad(s: Soldier): void;
  openShop(npc: number): void;
  shopKeeperShutDown(npc: number): boolean;
  giveItem(giver: Soldier, receiver: Soldier, slot: number): void;
  moraleEvent(s: Soldier, kind: string): void;
  openRequest(opening: NpcRequestOpening): void;
  startCarmenTimer(ms: number): void;
  setSoldierNeutral(s: Soldier): void;
  message(kind: string, profile?: number, amount?: number): void;
  profileName(npc: number): string;
  kickOutOfWheelchair(s: Soldier): void;
  leatherJacketPrice(): number;
  removeObjectFromProfile(npc: number, item: number): void;
  presentation(kind: string, profile?: number): void;
  warpTimeWithoutEvents(seconds: number): void;
}
