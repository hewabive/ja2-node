// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.h SOLDIERTYPE (the assignment fields); Tactical/Campaign.cc StatChange;
// @src Strategic/Auto_Resolve.cc VirtualSoldierDressWound; Tactical/Morale.cc HandleMoraleEvent; Strategic/Hourly_Update.cc.

import type { ItemTable } from '../../../content/items/items.ts';
import type { EconomyContent } from '../../../content/strategic/economy-content.ts';
import type { Sector } from '../../../content/strategic/sector-ids.ts';
import type { ItemObject } from '../../items/object.ts';
import type { MercPort, StrategicContext, StrategicMerc } from '../forces/ports.ts';
import type { MoraleEvent } from './constants.ts';
import type { EconomyEvent } from './events.ts';
import type { MilitiaContinuePrompt, MilitiaPaymentPrompt } from './state.ts';

export interface MercStats {
  readonly strength: number;
  readonly dexterity: number;
  readonly agility: number;
  readonly wisdom: number;
  readonly leadership: number;
  readonly marksmanship: number;
  readonly mechanical: number;
  readonly medical: number;
  readonly explosives: number;
  readonly expLevel: number;
}

export interface StatDamage {
  agility: number;
  dexterity: number;
  strength: number;
  wisdom: number;
}

export interface CrewMember extends StrategicMerc {
  life: number;
  lifeMax: number;
  fractLife: number;
  bleeding: number;
  breath: number;
  breathMax: number;
  asleep: boolean;
  collapsed: boolean;
  forcedToStayAwake: boolean;
  complainedThatTired: boolean;
  nothingToDo: boolean;
  doneQuoteSaid: boolean;
  trainStat: number;
  lastAssignmentChangeMin: number;
  hospitalPriceModifier: number;
  fixingRobot: boolean;
  vehicleUnderRepair: number;
  readonly inSector: boolean;
  readonly stats: MercStats;
  readonly effective: MercStats;
  readonly statDamage: StatDamage;
  readonly skillTraits: readonly number[];
  readonly profileTraits: readonly number[];
  readonly needForSleep: number;
  readonly inv: ItemObject[];
}

export interface CrewPort extends MercPort {
  get(id: number): CrewMember | undefined;
  byProfile(profile: number): CrewMember | undefined;
  all(): readonly CrewMember[];
  statChange(id: number, stat: number, chances: number, cause: number): void;
  healStat(id: number, stat: keyof StatDamage, points: number): void;
  opinion(profile: number, aboutProfile: number): number;
  dressWound(doctor: number, patient: number, kit: ItemObject, kitPoints: number, kitStatus: number): number;
}

export interface EconomyHooks {
  moraleEvent(kind: MoraleEvent, sector: Sector): void;
  removeRandomItemsInSector(sector: Sector, chance: number): void;
  mineClearOfMonsters(mine: number): boolean;
  startCreatureQuest(sector: Sector): void;
  checkConditionsForTriggeringCreatureQuest(): void;
  queenMineRanOut(sector: Sector): void;
  rebelsHostile(): boolean;
  meanwhile(kind: string, param: number): void;
  headMinerAlive(profile: number): boolean;
  headMinerTown(profile: number): number;
  placeHeadMiner(profile: number, sector: Sector, town: number): void;
  vehicleNeedsRepair(vehicle: number, mercId: number): boolean;
  repairVehicle(vehicle: number, points: number): number;
  history(code: number, secondCode: number, sector: Sector): void;
}

export type DecisionAnswer = 'yes' | 'no' | 'defer';

export interface EconomyDecisions {
  militiaPayment(prompt: MilitiaPaymentPrompt): DecisionAnswer;
  militiaContinue(prompt: MilitiaContinuePrompt): DecisionAnswer;
}

export interface PeriodicSlots {
  readonly updateBuddyAndHatedCounters?: () => void;
  readonly hourlyMoraleUpdate?: () => void;
  readonly hourlyCamouflageUpdate?: () => void;
  readonly hourlyProgressUpdate?: () => void;
  readonly hourlyQuestUpdate?: () => void;
  readonly hourlyLarryUpdate?: () => void;
  readonly hourlyCheckIfSlayAloneSoHeCanLeave?: () => void;
  readonly payOffSkyriderDebtIfAny?: () => void;
  readonly updateRegenCounters?: () => void;
  readonly decayTacticalMoraleModifiers?: () => void;
}

export interface EconomyContext extends StrategicContext {
  readonly crew: CrewPort;
  readonly economy: EconomyContent;
  readonly items: ItemTable;
  readonly hooks: EconomyHooks;
  readonly decisions: EconomyDecisions;
  readonly slots: PeriodicSlots;
  readonly townSectors: readonly TownSector[];
  readonly events: EconomyEvent[];
}

export interface TownSector {
  readonly town: number;
  readonly sector: number;
}

export const defaultEconomyHooks: EconomyHooks = {
  moraleEvent: () => {},
  removeRandomItemsInSector: () => {},
  mineClearOfMonsters: () => true,
  startCreatureQuest: () => {},
  checkConditionsForTriggeringCreatureQuest: () => {},
  queenMineRanOut: () => {},
  rebelsHostile: () => false,
  meanwhile: () => {},
  headMinerAlive: () => true,
  headMinerTown: () => 0,
  placeHeadMiner: () => {},
  vehicleNeedsRepair: () => false,
  repairVehicle: () => 0,
  history: () => {},
};

export const deferringDecisions: EconomyDecisions = {
  militiaPayment: () => 'defer',
  militiaContinue: () => 'defer',
};
