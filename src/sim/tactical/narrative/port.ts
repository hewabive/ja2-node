// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.h QUESTNOTSTARTED, QUESTINPROGRESS, QUESTDONE. See docs/25 §2.1, §6.

import type { Soldier } from '../soldier.ts';

export interface NarrativePort {
  fact(id: number): boolean;
  setFactTrue(id: number): void;
  setFactFalse(id: number): void;
  questStatus(quest: number): number;
  setNpcData(profile: number, value: number): void;
  triggerNpcRecord(profile: number, record: number): void;
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
}

export const QuestStatus = { NOT_STARTED: 0, IN_PROGRESS: 1, DONE: 2 } as const;

export const NO_NARRATIVE_PORT: NarrativePort = {
  fact: () => false,
  setFactTrue: () => {},
  setFactFalse: () => {},
  questStatus: () => QuestStatus.NOT_STARTED,
  setNpcData: () => {},
  triggerNpcRecord: () => {},
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
};
