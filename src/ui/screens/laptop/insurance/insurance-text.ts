// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Insurance_Text.cc GetInsuranceText (insurancesingle.edt below INS_MULTI_LINE_BEGINS, insurancemulti.edt
// @src at n - INS_MULTI_LINE_BEGINS - 1); src/game/Laptop/Insurance_Text.h (the text numbers); src/game/Laptop/Insurance_Contract.cc
// @src DisplayOrderGrid (the contract status text and its colour), SetNumberOfDisplayedInsuranceMercs,
// @src DisableInsuranceContractNextPreviousbuttons, BtnInsContractPrevButtonCallback, BtnInsContractNextButtonCallBack.

import type { InsuranceOfferView } from '../../../../protocol/view.ts';

export const INSURANCE_SINGLE_FILE = 'binarydata/insurancesingle.edt';
export const INSURANCE_MULTI_FILE = 'binarydata/insurancemulti.edt';
export const INSURANCE_TEXT_FILES: readonly string[] = [INSURANCE_SINGLE_FILE, INSURANCE_MULTI_FILE];
export const INS_MULTI_LINE_BEGINS = 30;

export const InsuranceText = {
  COMMENTSFROM_CLIENTS: 3,
  HOW_DOES_INS_WORK: 4,
  TO_ENTER_REVIEW: 5,
  GUS_TARBALLS: 6,
  ALI_HUSSEAN: 7,
  LANCE_ALLOT: 8,
  FRED_COUSTEAU: 9,
  WE_CAN_OFFER_U: 10,
  PREMIUMS: 11,
  RENEWL_PREMIUMS: 12,
  LOWER_PREMIUMS_4_RENEWING: 13,
  POLICY_CANCELATIONS: 14,
  SUBMITTING_CLAIM: 15,
  FRAUD: 16,
  CONTRACT: 25,
  NOCONTRACT: 26,
  DEAD_WITH_CONTRACT: 27,
  DEAD_NO_CONTRACT: 28,
  PARTIALLY_INSURED: 29,
  GUS_SPEECH: 35,
  ALI_HUSSEAN_SPEECH: 36,
  LANCE_ALLOT_SPEECH: 37,
  FRED_COUSTEAU_SPEECH: 38,
  HIRING_4_SHORT_TERM_HIGH_RISK_1: 39,
  HIRING_4_SHORT_TERM_HIGH_RISK_2: 40,
  REASONABLE_AND_FLEXIBLE: 41,
  QUICKLY_AND_EFFICIENT: 44,
  EACH_TIME_U_COME_TO_US: 45,
  LENGTH_OF_EMPLOYMENT_CONTRACT: 46,
  EMPLOYEES_AGE_AND_HEALTH: 47,
  EMPLOOYEES_TRAINING_AND_EXP: 48,
  WHEN_IT_COMES_TIME_TO_RENEW: 49,
  SHOULD_THE_PROJECT_BE_GOING_WELL: 50,
  WE_WILL_ACCEPT_INS_CANCELATION: 52,
  U_CAN_REST_ASSURED: 53,
  HAD_U_HIRED_AN_INDIVIDUAL: 54,
  WE_RESERVE_THE_RIGHT: 55,
  SHOULD_THERE_BE_GROUNDS: 56,
  SHOULD_SUCH_A_SITUATION: 57,
  NO_QUALIFIED_MERCS: 62,
  NOT_ENOUGH_FUNDS: 63,
  ALL_AIM_MERCS_ON_SHORT_CONTRACT: 64,
  ONE_HOUR_EXCLUSION_A: 65,
  ONE_HOUR_EXCLUSION_B: 66,
} as const;

export const INSURANCE_GRIDS_PER_PAGE = 3;

export interface InsuranceTextRow {
  readonly file: string;
  readonly row: number;
}

export function insuranceTextRow(text: number): InsuranceTextRow {
  if (text < INS_MULTI_LINE_BEGINS) return { file: INSURANCE_SINGLE_FILE, row: text };
  return { file: INSURANCE_MULTI_FILE, row: text - INS_MULTI_LINE_BEGINS - 1 };
}

export interface ContractStatus {
  readonly text: number;
  readonly red: boolean;
}

export function contractStatus(offer: Pick<InsuranceOfferView, 'dead' | 'insured' | 'offeredLength'>): ContractStatus {
  if (offer.dead) return { text: offer.insured ? InsuranceText.DEAD_WITH_CONTRACT : InsuranceText.DEAD_NO_CONTRACT, red: true };
  if (!offer.insured) return { text: InsuranceText.NOCONTRACT, red: true };
  return offer.offeredLength !== 0 ? { text: InsuranceText.PARTIALLY_INSURED, red: true } : { text: InsuranceText.CONTRACT, red: false };
}

export function displayedGrids(insurable: number, index: number): number {
  return Math.max(0, Math.min(insurable - index, INSURANCE_GRIDS_PER_PAGE));
}

export function nextGridsEnabled(insurable: number, index: number): boolean {
  return index + displayedGrids(insurable, index) < insurable;
}

export function previousGridsEnabled(index: number): boolean {
  return index >= INSURANCE_GRIDS_PER_PAGE;
}

export function previousGridIndex(index: number): number {
  return index > INSURANCE_GRIDS_PER_PAGE - 1 ? index - INSURANCE_GRIDS_PER_PAGE : index;
}

export function nextGridIndex(index: number): number {
  return index + INSURANCE_GRIDS_PER_PAGE;
}
