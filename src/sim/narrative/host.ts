import type { QuoteLengths } from '../../content/narrative/dialogue-text.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import type { Soldier } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { NarrativeEventWithoutTick } from './events.ts';
import type { RecordsEnv, SectorRef } from './records.ts';
import type { HospitalBalance, ItemFacts, NpcMoneyMessage } from './select.ts';
import type { GiftObject, TalkContext, TalkState } from './talk-state.ts';

export interface FactSource {
  checkFact(fact: number, npcProfile: number): boolean;
}

export interface QuestPort {
  startQuest(quest: number, sector: SectorRef | null): void;
  endQuest(quest: number, sector: SectorRef | null): void;
}

export interface NpcActionPort {
  handleNpcDoAction(npc: number, code: number, record: number): void;
}

export interface GivePort {
  placeObjectInSoldierProfile(npc: number, object: GiftObject, giver: number): void;
  returnItemToPlayer(merc: number, object: GiftObject): void;
  handleNpcItemGiven(npc: number, slot: number): void;
}

export interface ReceivePort {
  readonly items: ItemFacts;
  readonly hospital: HospitalBalance;
  calcMedicalCost(npc: number): number;
  frankCash(amount: number): void;
  kingpinInHisHouse(): boolean;
  addProfileCost(profile: number, amount: number): void;
  message(m: NpcMoneyMessage): void;
}

export interface CivQuotePort {
  townOfSector(sector: SectorRef): number;
  townUsesLoyalty(town: number): boolean;
  playerControlsMineOf(sector: SectorRef): boolean;
}

export interface MercLinePort {
  sayLater(npc: Soldier, nice: boolean): void;
  mikeSaysHi(): void;
}

export interface NarrativeHost extends RecordsEnv {
  readonly talk: TalkState;
  readonly context: TalkContext;
  readonly facts: FactSource;
  readonly quests: QuestPort;
  readonly actions: NpcActionPort;
  readonly give: GivePort;
  readonly receive: ReceivePort;
  readonly mercLines: MercLinePort;
  readonly civ: CivQuotePort;
  readonly quoteLengths: QuoteLengths;
  tick(): number;
  day(): number;
  random(n: number): number;
  tactical(): TacticalState | null;
  profile(id: number): ProfileProgress | null;
  setFact(fact: number, value: boolean): void;
  questValue(index: number): number;
  townRating(town: number): number;
  threat(merc: number): number;
  voice(profile: number): number;
  worldSector(): SectorRef | null;
  isEpc(s: Soldier): boolean;
  onSquad(s: Soldier): boolean;
  inMeanwhile(): boolean;
  emit(e: NarrativeEventWithoutTick): void;
  setEngaged(on: boolean): void;
  engaged(): boolean;
  pauseForConversation(on: boolean): void;
  selectTalker(s: Soldier): void;
  isDealer(profile: number): boolean;
  openShop(dealer: number): void;
  shopClosedByScript(dealer: number): boolean;
  teleport(s: Soldier, gridNo: number): void;
  releaseEscort?(npc: number): void;
  offSectorPlayerSoldier?(profile: number): Soldier | null;
  dialogueCallback?(name: string): void;
}
