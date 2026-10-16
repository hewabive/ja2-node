// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Facts.h (fact ids), Quests.h NUM_FACTS, MAX_QUESTS; Quests.cc gubFact, gubQuest, SetFactTrue,
// @src SetFactFalse, CheckFact (the stored part). See docs/21 §5.5, docs/23 §16.1, docs/25.

import { u8 } from '../../../core/int.ts';

export const NUM_FACTS = 500;
export const MAX_QUESTS = 30;

export const Fact = {
  BOBBYRAY_SHIPMENT_IN_TRANSIT: 32,
  NEW_BOBBYRAY_SHIPMENT_WAITING: 33,
  REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING: 34,
  LARGE_SIZED_OLD_SHIPMENT_WAITING: 35,
  PABLOS_BRIBED: 41,
  PABLOS_STOLE_FROM_LATEST_SHIPMENT: 53,
  LAST_SHIPMENT_CRASHED: 54,
  LAST_SHIPMENT_WENT_TO_WRONG_AIRPORT: 55,
  NEXT_PACKAGE_CAN_BE_LOST: 59,
  NEXT_PACKAGE_CAN_BE_DELAYED: 60,
  MEDIUM_SIZED_SHIPMENT_WAITING: 61,
  LARGE_SIZED_SHIPMENT_WAITING: 62,
  FRANK_HAS_BEEN_BRIBED: 105,
  PABLO_WONT_STEAL: 124,
  AGENTS_PREVENTED_SHIPMENT: 125,
  MANNY_IS_BARTENDER: 220,
  FACT_222: 222,
  HILLBILLIES_KILLED: 273,
  ESTONI_REFUELLING_POSSIBLE: 277,
  LARRY_CHANGED: 334,
} as const;

export interface NarrativeState {
  readonly facts: Uint8Array;
  readonly quests: Uint8Array;
}

export function createNarrativeState(): NarrativeState {
  return { facts: new Uint8Array(NUM_FACTS), quests: new Uint8Array(MAX_QUESTS) };
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

export function questStatus(n: NarrativeState, quest: number): number {
  return n.quests[quest] ?? 0;
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
