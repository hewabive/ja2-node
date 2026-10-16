// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc gubFact, gubQuest, SetFactTrue, SetFactFalse, LoadQuestInfoFromSavedGameFile;
// @src Quests.h NUM_FACTS, MAX_QUESTS, QUESTNOTSTARTED, QUESTINPROGRESS, QUESTDONE; Boxing.h NUM_BOXERS; SaveLoadGame.cc
// @src LoadGeneralInfo (gubBoxingMatchesWon, gubBoxersRests, gfBoxersResting, gfBoxerFought, gBoxer, gubCambriaMedicalObjects,
// @src gbHospitalPriceModifier, giHospitalTempBalance, giHospitalRefund, gfPlayerTeamSawJoey, gfMikeShouldSayHi); Tactical/Soldier_Create.cc
// @src gfProfiledEnemyAdded (not saved); Overhead_Types.h fCountingDownForGuideDescription, bGuideDescriptionCountDown,
// @src ubGuideDescriptionToUse, bGuideDescriptionSectorX, bGuideDescriptionSectorY; Tactical/Overhead.h
// @src TacticalStatusType::bBoxingState.
// @src See docs/25 §0, §1.1.

import { u8 } from '../../../core/int.ts';
import { NOBODY } from '../../tactical/soldier.ts';
import { Fact } from './fact-ids.ts';

export const NUM_FACTS = 500;
export const MAX_QUESTS = 30;
export const NUM_BOXERS = 3;
export const NOT_BOXING = 0;

export const QuestStatus = { NOT_STARTED: 0, IN_PROGRESS: 1, DONE: 2 } as const;

export interface BoxingRecord {
  matchesWon: number;
  rests: number;
  resting: boolean;
  lastMatchWonByPlayer: boolean;
  readonly fought: boolean[];
  readonly boxers: number[];
  state: number;
  uiLocked: boolean;
}

export function createBoxingRecord(): BoxingRecord {
  return {
    matchesWon: 0,
    rests: 0,
    resting: false,
    lastMatchWonByPlayer: false,
    fought: new Array<boolean>(NUM_BOXERS).fill(false),
    boxers: new Array<number>(NUM_BOXERS).fill(NOBODY),
    state: NOT_BOXING,
    uiLocked: false,
  };
}

export interface HospitalAccount {
  priceModifier: number;
  tempBalance: number;
  refund: number;
}

export interface NarrativeState {
  readonly facts: Uint8Array;
  readonly quests: Uint8Array;
  readonly boxing: BoxingRecord;
  readonly hospital: HospitalAccount;
  cambriaMedicalObjects: number;
  playerTeamSawJoey: boolean;
  mikeShouldSayHi: number;
  profiledEnemyAdded: boolean;
  readonly guide: GuideDescription;
}

export interface GuideDescription {
  counting: boolean;
  countdown: number;
  quote: number;
  sectorX: number;
  sectorY: number;
}

export interface FactHooks {
  estoniRefuellingPossible(): void;
}

export const NO_FACT_HOOKS: FactHooks = { estoniRefuellingPossible: () => {} };

export function createNarrativeState(boxing: BoxingRecord = createBoxingRecord()): NarrativeState {
  return {
    facts: new Uint8Array(NUM_FACTS),
    quests: new Uint8Array(MAX_QUESTS),
    boxing,
    hospital: { priceModifier: 0, tempBalance: 0, refund: 0 },
    cambriaMedicalObjects: 0,
    playerTeamSawJoey: false,
    mikeShouldSayHi: MikeGreeting.NOT_YET,
    profiledEnemyAdded: false,
    guide: { counting: false, countdown: 0, quote: 0, sectorX: 0, sectorY: 0 },
  };
}

export function fact(n: NarrativeState, id: number): boolean {
  return (n.facts[id] ?? 0) !== 0;
}

export function factValue(n: NarrativeState, id: number): number {
  return n.facts[id] ?? 0;
}

export function setFact(n: NarrativeState, id: number, value: boolean | number = true): void {
  if (id < 0 || id >= NUM_FACTS) return;
  n.facts[id] = typeof value === 'number' ? u8(value) : value ? 1 : 0;
}

export function setFactTrue(n: NarrativeState, id: number, hooks: FactHooks = NO_FACT_HOOKS): void {
  if (id === Fact.ESTONI_REFUELLING_POSSIBLE && !fact(n, id)) hooks.estoniRefuellingPossible();
  setFact(n, id, true);
}

export function setFactFalse(n: NarrativeState, id: number): void {
  setFact(n, id, false);
}

export function questStatus(n: NarrativeState, quest: number): number {
  return n.quests[quest] ?? QuestStatus.NOT_STARTED;
}

export function setQuestStatus(n: NarrativeState, quest: number, status: number): void {
  if (quest < 0 || quest >= MAX_QUESTS) return;
  n.quests[quest] = u8(status);
}

export function importNarrative(n: NarrativeState, facts: readonly number[], quests: readonly number[]): void {
  n.facts.fill(0);
  n.quests.fill(0);
  facts.forEach((v, id) => {
    setFact(n, id, v);
  });
  quests.forEach((v, id) => {
    setQuestStatus(n, id, v);
  });
}

export const MikeGreeting = { NOT_YET: 0, PENDING: 1, DONE: 2 } as const;

export interface SavedNarrativeGlobals {
  readonly boxingMatchesWon: number;
  readonly boxersRests: number;
  readonly boxersResting: boolean;
  readonly lastBoxingMatchWonByPlayer: boolean;
  readonly boxerFought: readonly boolean[];
  readonly boxers?: readonly number[];
  readonly cambriaMedicalObjects: number;
  readonly hospitalPriceModifier: number;
  readonly hospitalTempBalance: number;
  readonly hospitalRefund: number;
  readonly playerTeamSawJoey: boolean;
  readonly mikeShouldSayHi: number;
}

export function importNarrativeGlobals(n: NarrativeState, g: SavedNarrativeGlobals): void {
  n.boxing.matchesWon = g.boxingMatchesWon;
  n.boxing.rests = g.boxersRests;
  n.boxing.resting = g.boxersResting;
  n.boxing.lastMatchWonByPlayer = g.lastBoxingMatchWonByPlayer;
  for (let i = 0; i < NUM_BOXERS; i++) {
    n.boxing.fought[i] = g.boxerFought[i] ?? false;
    n.boxing.boxers[i] = g.boxers?.[i] ?? NOBODY;
  }
  n.cambriaMedicalObjects = g.cambriaMedicalObjects;
  n.hospital.priceModifier = g.hospitalPriceModifier;
  n.hospital.tempBalance = g.hospitalTempBalance;
  n.hospital.refund = g.hospitalRefund;
  n.playerTeamSawJoey = g.playerTeamSawJoey;
  n.mikeShouldSayHi = g.mikeShouldSayHi;
}
