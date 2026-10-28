// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/History.cc AddHistoryToPlayersLog, ProcessAndEnterAHistoryRecord, GetTimeQuestWasStarted;
// @src Laptop/Files.cc AddFilesToPlayersLog, ProcessAndEnterAFilesRecord, GameInitFiles; Laptop/Personnel.cc
// @src AddCharacterToDeadList, AddCharacterToFiredList, AddCharacterToOtherList,
// @src RemoveNewlyHiredMercFromPersonnelDepartedList; Laptop/History.h (the codes this module writes, checked against
// @src data/tables/merc-contracts.json).

import { u8, u32 } from '../../../core/int.ts';
import { type LaptopState, NO_PERSONNEL_ENTRY, type PersonnelLists } from './laptop-state.ts';

export const ENRICO_BACKGROUND_FILE = 0;
const NO_SECTOR = -1;

export const History = {
  HIRED_MERC_FROM_AIM: 1,
  HIRED_MERC_FROM_MERC: 2,
  SETTLED_ACCOUNTS_AT_MERC: 4,
  CHARACTER_GENERATED: 6,
  PURCHASED_INSURANCE: 7,
  INSURANCE_CLAIM_PAYOUT: 9,
  QUEST_STARTED: 15,
  TALKED_TO_MINER: 17,
  LIBERATED_TOWN: 18,
  ENRICO_COMPLAINED: 24,
  WONBATTLE: 25,
  MINE_RUNNING_OUT: 26,
  MINE_RAN_OUT: 27,
  MINE_SHUTDOWN: 28,
  MINE_REOPENED: 29,
  LOSTTOWNSECTOR: 64,
  DEFENDEDTOWNSECTOR: 65,
  LOSTBATTLE: 66,
  FATALAMBUSH: 67,
  WIPEDOUTENEMYAMBUSH: 68,
  UNSUCCESSFULATTACK: 69,
  SUCCESSFULATTACK: 70,
  CREATURESATTACKED: 71,
  KILLEDBYBLOODCATS: 72,
  SLAUGHTEREDBLOODCATS: 73,
} as const;

export interface HistorySector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function addHistory(l: LaptopState, code: number, secondCode: number, date: number, sector: HistorySector | null): void {
  l.history.push({
    code: u8(code),
    secondCode: u8(secondCode),
    date: u32(date),
    x: sector?.x ?? NO_SECTOR,
    y: sector?.y ?? NO_SECTOR,
    z: sector?.z ?? 0,
  });
}

export function timeQuestWasStarted(l: LaptopState, quest: number): number {
  return l.history.find((h) => h.code === History.QUEST_STARTED && h.secondCode === quest)?.date ?? 0;
}

export function addFile(l: LaptopState, code: number, read = false): void {
  if (l.files.some((f) => f.code === code)) return;
  l.files.push({ code: u8(code), read });
}

export type PersonnelListName = keyof PersonnelLists;

export function addToPersonnelList(l: LaptopState, list: PersonnelListName, profile: number): void {
  const entries = l.personnel[list];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i] === NO_PERSONNEL_ENTRY) {
      entries[i] = profile;
      return;
    }
    if (entries[i] === profile) return;
  }
}

export function removeNewlyHiredMercFromPersonnelDepartedList(l: LaptopState, profile: number): boolean {
  const { dead, left, other } = l.personnel;
  for (let i = 0; i < dead.length; i++) {
    for (const list of [dead, left, other]) {
      if (list[i] !== profile) continue;
      list[i] = NO_PERSONNEL_ENTRY;
      return true;
    }
  }
  return false;
}
