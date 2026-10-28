// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.h SOLDIERTYPE contract fields, SOLDIER_CONTRACT_RENEW_QUOTE_*, SOLDIER_QUOTE_SAID_*;
// @src Strategic/Merc_Contract.h CONTRACT_EXTEND_*; Merc_Contract.cc ContractRenewalList, ubNumContractRenewals and the
// @src sequence flags; Strategic/Map_Screen_Interface.cc gpLeaveListHead, guiLeaveListOwnerProfileId.

import type { ItemObject } from '../../items/object.ts';
import { NO_PROFILE } from '../../tactical/soldier.ts';

export const ContractLength = { EXTEND_1_DAY: 0, EXTEND_1_WEEK: 1, EXTEND_2_WEEK: 2 } as const;
export const RenewalQuoteCode = { NOT_USED: 0, CONTRACTS_OVER_USED: 1, LEAVING_SOON_USED: 2 } as const;
export const QuoteSaidFlag = {
  LOW_MORAL: 0x0010,
  ANNOYING_MERC: 0x0040,
  LIKESGUN: 0x0080,
  PERSONALITY: 0x4000,
  FOUND_SOMETHING_NICE: 0x8000,
} as const;

export const MAX_CONTRACT_RENEWALS = 20;
export const NUM_LEAVE_LIST_SLOTS = 20;

export interface MercContract {
  totalContractLength: number;
  contractEnd: number;
  contractStartDay: number;
  typeOfLastContract: number;
  timeCanSignElsewhere: number;
  signedAnotherContract: boolean;
  lastContractUpdate: number;
  timeWillArrive: number;
  useLandingZone: boolean;
  renewalQuoteCode: number;
  leaveHistoryCode: number;
  medicalDeposit: number;
  contractPriceIncreased: boolean;
  lifeInsurance: number;
  startOfInsuranceContract: number;
  totalLengthOfInsuranceContract: number;
  startTimeOfInsuranceContract: number;
}

export function createMercContract(init: Partial<MercContract> = {}): MercContract {
  return {
    totalContractLength: 0,
    contractEnd: 0,
    contractStartDay: 0,
    typeOfLastContract: 0,
    timeCanSignElsewhere: 0,
    signedAnotherContract: false,
    lastContractUpdate: 0,
    timeWillArrive: 0,
    useLandingZone: false,
    renewalQuoteCode: RenewalQuoteCode.NOT_USED,
    leaveHistoryCode: 0,
    medicalDeposit: 0,
    contractPriceIncreased: false,
    lifeInsurance: 0,
    startOfInsuranceContract: 0,
    totalLengthOfInsuranceContract: 0,
    startTimeOfInsuranceContract: 0,
    ...init,
  };
}

export interface RenewalSequence {
  readonly list: number[];
  on: boolean;
  current: number;
  inProgress: boolean;
  fromSequence: boolean;
}

export interface LeaveSlot {
  items: ItemObject[] | null;
  owner: number;
}

export type PendingEnding =
  | { readonly kind: 'departure'; readonly soldier: number; readonly rehire: boolean }
  | { readonly kind: 'withoutEquipment'; readonly soldier: number }
  | { readonly kind: 'enterMapScreen'; readonly soldier: number };

export interface ContractState {
  readonly renewal: RenewalSequence;
  readonly leaveList: LeaveSlot[];
  readonly pendingEndings: PendingEnding[];
}

export function createContractState(): ContractState {
  return {
    renewal: { list: [], on: false, current: 0, inProgress: false, fromSequence: false },
    leaveList: Array.from({ length: NUM_LEAVE_LIST_SLOTS }, () => ({ items: null, owner: NO_PROFILE })),
    pendingEndings: [],
  };
}
